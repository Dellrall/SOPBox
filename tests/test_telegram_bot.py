"""The bot: who it answers, the PIC commands with @mentions, and sentences read by the model."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app import extraction, team_group, telegram_bot
from app.main import app
from test_purchasing import issued_order, supplier_id  # noqa: F401 - fixture
from test_sign_in_methods import BOT_TOKEN, telegram_answer
from test_team_group import GROUP, FakeTelegram, connect

OWNER_TG, SAM_TG = 555, 777


class Bot(FakeTelegram):
    def post(self, url, json=None, timeout=None, **kw):
        if url.endswith("/getMe"):
            self.calls.append(("getMe", {}))
            return httpx.Response(200, json={"ok": True, "result": {"id": 42, "username": "sopbox_bot"}}, request=httpx.Request("POST", url))
        return super().post(url, json=json, timeout=timeout, **kw)

    def said(self):
        return [p["text"] for m, p in self.calls if m == "sendMessage" and "reply_parameters" in p]


@pytest.fixture
def tg(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    telegram_bot._bot.cache_clear()
    team_group._webhook_at = None
    fake = Bot()
    monkeypatch.setattr(httpx, "post", fake.post)
    yield fake
    telegram_bot._bot.cache_clear()


def say(text, sender, chat=None, username=None):
    entities = []
    for word in text.split():
        if word.startswith("@"):
            entities.append({"type": "mention", "offset": text.index(word), "length": len(word)})
        elif word.startswith("/") and not entities:
            entities.append({"type": "bot_command", "offset": 0, "length": len(word)})
    chat = chat or {"id": sender, "type": "private"}
    message = {"message_id": 9, "chat": chat, "text": text, "entities": entities,
               "from": {"id": sender, "is_bot": False, "first_name": "X", **({"username": username} if username else {})}}
    resp = TestClient(app).post("/api/telegram/webhook", json={"update_id": 1, "message": message},
                                headers={"x-telegram-bot-api-secret-token": team_group.webhook_secret()})
    assert resp.status_code == 200, resp.text


def pics(client, order_id):
    return [p["name"] for p in next(j for j in client.get("/api/jobs", params={"day": "2026-01-01"}).json() if j["ref_id"] == order_id)["pics"]]


def test_a_stranger_is_told_to_connect_and_nothing_changes(client, tg):
    say("/jobs", 12345)
    assert tg.said() == [telegram_bot.LINK_FIRST]


def test_staff_take_and_drop_by_command_but_cannot_assign_others(client, catalogue_ids, supplier_id, make_user, tg):  # noqa: F811
    order = issued_order(client, catalogue_ids, supplier_id)
    sam = make_user("staff", "sam", "Sam")
    assert sam.post("/api/auth/telegram/link", json=telegram_answer(SAM_TG, username="sam_tg")).status_code == 204
    say(f"/take {order['reference']}", SAM_TG)
    say(f"/take {order['reference']}", SAM_TG)  # idempotent
    assert tg.said()[-2:] == [f"You are now PIC of {order['reference']} from Fresh Mart.", f"You are already PIC of {order['reference']} from Fresh Mart."]
    say(f"/pic {order['reference']} @olive", SAM_TG)
    assert "only a manager" in tg.said()[-1]
    say("/drop fresh mart", SAM_TG)
    assert tg.said()[-1] == f"You are off {order['reference']} from Fresh Mart." and pics(client, order["id"]) == []
    assert "assignment.removed" in [e["action"] for e in client.get("/api/audit").json()]


def test_a_manager_tags_people_in_the_group_and_they_hear_about_it(client, catalogue_ids, supplier_id, make_user, tg):  # noqa: F811
    order = issued_order(client, catalogue_ids, supplier_id)
    sam = make_user("staff", "sam", "Sam")
    assert sam.post("/api/auth/telegram/link", json=telegram_answer(SAM_TG)).status_code == 204
    assert client.post("/api/auth/telegram/link", json=telegram_answer(OWNER_TG)).status_code == 204
    connect(client)
    group = {"id": GROUP, "type": "supergroup"}
    say("hello team", SAM_TG, group, username="SamTG")  # not for the bot: no reply
    assert tg.said() == []
    say("/jobs@sopbox_bot", SAM_TG, group, username="SamTG")  # Sam's @name is learnt from his message
    say(f"/pic {order['reference']} @samtg", OWNER_TG, group)
    assert tg.said()[-1] == f"Sam is now PIC of {order['reference']} from Fresh Mart."
    assert pics(client, order["id"]) == ["Sam"]
    told = [p["text"] for m, p in tg.calls if m == "sendMessage" and p["chat_id"] == str(SAM_TG)]
    assert any("made you PIC" in t for t in told)
    say(f"/unpic {order['reference']} @nobody", OWNER_TG, group)
    assert "I do not know @nobody" in tg.said()[-1]


def test_a_sentence_is_read_by_the_model_but_checked_by_code(client, catalogue_ids, supplier_id, make_user, tg, monkeypatch):  # noqa: F811
    order = issued_order(client, catalogue_ids, supplier_id)
    make_user("staff", "sam", "Sam")
    assert client.post("/api/auth/telegram/link", json=telegram_answer(OWNER_TG)).status_code == 204
    monkeypatch.setattr(extraction, "_ask_model", lambda *a, **k: '{"action": "assign", "job": 0, "people": ["Sam", "Mallory"]}')
    say("@sopbox_bot make sam pic of the fresh mart order", OWNER_TG)
    assert tg.said()[-1] == f"Sam is now PIC of {order['reference']} from Fresh Mart."
    monkeypatch.setattr(extraction, "_ask_model", lambda *a, **k: '{"action": "delete_everything", "job": 7}')
    say("@sopbox_bot drop all tables", OWNER_TG)
    assert tg.said()[-1].startswith("Sorry, I did not get that.") and pics(client, order["id"]) == ["Sam"]
