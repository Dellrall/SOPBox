"""The Telegram team group: only the workspace's own active people get in, and the owner can remove them."""

import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app import team_group
from app.main import app
from test_sign_in_methods import BOT_TOKEN, telegram_answer

GROUP = -1001234567890
STRANGER = 999


class FakeTelegram:
    """Records every Bot API call and answers like Telegram does."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.chat_type = "supergroup"
        self.bot_rights = {"status": "administrator", "can_invite_users": True, "can_restrict_members": True}

    def post(self, url, json=None, timeout=None, **_):
        method = url.rsplit("/", 1)[1]
        self.calls.append((method, json or {}))
        result = {
            "getChat": {"id": GROUP, "type": self.chat_type, "title": "Kopi Corner crew"},
            "getChatMember": self.bot_rights,
            "createChatInviteLink": {"invite_link": "https://t.me/+join-kopi"},
        }.get(method, True)
        return httpx.Response(200, json={"ok": True, "result": result}, request=httpx.Request("POST", url))

    def made(self, method):
        return [params for m, params in self.calls if m == method]


@pytest.fixture
def tg(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    fake = FakeTelegram()
    monkeypatch.setattr(httpx, "post", fake.post)
    return fake


def linked_staff(make_user, username="sam", telegram_id=777):
    staff = make_user("staff", username, username.title())
    assert staff.post("/api/auth/telegram/link", json=telegram_answer(telegram_id)).status_code == 204
    return staff


def user_id(client, username):
    return {u["username"]: u["id"] for u in client.get("/api/users").json()}[username]


def join_request(telegram_id, secret=None, chat=GROUP):
    update = {"update_id": 1, "chat_join_request": {"chat": {"id": chat, "type": "supergroup"}, "from": {"id": telegram_id}, "date": 0}}
    headers = {"x-telegram-bot-api-secret-token": secret or team_group.webhook_secret()}
    return TestClient(app).post("/api/telegram/webhook", json=update, headers=headers)


def connect(client):
    resp = client.put("/api/workspace/team-group", json={"chat_id": str(GROUP)})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_connecting_checks_the_group_and_sends_everyone_the_link(client, make_user, tg):
    linked_staff(make_user)
    ws = connect(client)
    assert ws["telegram_team_title"] == "Kopi Corner crew"
    assert ws["telegram_team_invite_link"] == "https://t.me/+join-kopi"
    assert tg.made("createChatInviteLink")[0]["creates_join_request"] is True
    hook = tg.made("setWebhook")[0]
    assert hook["url"] == "http://testserver/api/telegram/webhook" and hook["secret_token"] == team_group.webhook_secret()
    dms = [m for m in tg.made("sendMessage") if m["chat_id"] == "777"]
    assert dms and "https://t.me/+join-kopi" in dms[-1]["text"]


def test_a_basic_group_or_a_bot_without_rights_is_refused(client, tg):
    tg.chat_type = "group"
    assert "supergroup" in client.put("/api/workspace/team-group", json={"chat_id": str(GROUP)}).json()["detail"]
    tg.chat_type = "supergroup"
    tg.bot_rights = {"status": "administrator", "can_invite_users": True, "can_restrict_members": False}
    assert "Ban users" in client.put("/api/workspace/team-group", json={"chat_id": str(GROUP)}).json()["detail"]
    assert client.get("/api/workspace").json()["telegram_team_chat_id"] == ""


def test_connecting_telegram_later_sends_the_link_and_shows_it_in_settings(client, make_user, tg):
    connect(client)
    staff = linked_staff(make_user)
    assert any("https://t.me/+join-kopi" in m["text"] for m in tg.made("sendMessage") if m["chat_id"] == "777")
    security = staff.get("/api/auth/security").json()
    assert security["team_group_link"] == "https://t.me/+join-kopi"
    assert security["team_group_title"] == "Kopi Corner crew"


def test_only_the_workspaces_own_people_are_let_in(client, make_user, tg):
    connect(client)
    linked_staff(make_user)
    assert join_request(777).status_code == 200
    assert join_request(STRANGER).status_code == 200
    assert tg.made("approveChatJoinRequest") == [{"chat_id": GROUP, "user_id": 777}]
    assert tg.made("declineChatJoinRequest") == [{"chat_id": GROUP, "user_id": STRANGER}]


def test_someone_from_another_workspace_is_not_let_in(client, make_user, tg):
    connect(client)
    other = TestClient(app)
    other.post("/api/auth/register", json={"workspace_name": "Other", "display_name": "Ota", "email": "o@example.com", "username": "ota", "password": "correct horse battery"})
    other.post("/api/auth/telegram/link", json=telegram_answer(555))
    join_request(555)
    assert tg.made("declineChatJoinRequest") == [{"chat_id": GROUP, "user_id": 555}]


def test_the_webhook_needs_telegrams_secret(client, tg):
    connect(client)
    assert join_request(777, secret="guess").status_code == 401
    assert tg.made("declineChatJoinRequest") == []


def test_the_owner_removes_someone_for_a_day_and_lets_them_back(client, make_user, tg):
    connect(client)
    staff = linked_staff(make_user)
    sam = user_id(client, "sam")
    resp = client.post(f"/api/users/{sam}/team-group/remove", json={"hours": 24})
    assert resp.status_code == 200 and resp.json()["team_group_removed_until"]
    ban = tg.made("banChatMember")[-1]
    assert ban["user_id"] == 777 and abs(ban["until_date"] - (time.time() + 86400)) < 60
    join_request(777)
    assert tg.made("declineChatJoinRequest")[-1]["user_id"] == 777
    assert staff.get("/api/auth/security").json()["team_group_link"] is None

    resp = client.post(f"/api/users/{sam}/team-group/let-back")
    assert resp.json()["team_group_removed_until"] is None
    assert tg.made("unbanChatMember")[-1]["user_id"] == 777
    assert "https://t.me/+join-kopi" in tg.made("sendMessage")[-1]["text"]
    join_request(777)
    assert tg.made("approveChatJoinRequest")[-1]["user_id"] == 777
    details = [e["detail"] for e in client.get("/api/audit").json() if e["action"] == "team_group.member"]
    assert "Removed Sam from the team group for 1 day" in details and "Let Sam back into the team group" in details


def test_removal_until_let_back_in_bans_without_an_end(client, make_user, tg):
    connect(client)
    linked_staff(make_user)
    client.post(f"/api/users/{user_id(client, 'sam')}/team-group/remove", json={"hours": None})
    assert tg.made("banChatMember")[-1]["until_date"] == 0
    assert client.get("/api/users").json()[1]["team_group_removed_until"] == team_group.FOREVER


def test_a_removal_that_has_run_out_lets_them_in_again(client, make_user, tg, _database):
    import psycopg

    connect(client)
    linked_staff(make_user)
    client.post(f"/api/users/{user_id(client, 'sam')}/team-group/remove", json={"hours": 1})
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE users SET team_group_removed_until = '2000-01-01T00:00:00+00:00' WHERE username = 'sam'")
    join_request(777)
    assert tg.made("approveChatJoinRequest")[-1]["user_id"] == 777


def test_disabling_an_account_takes_the_person_out(client, make_user, tg):
    connect(client)
    linked_staff(make_user)
    sam = user_id(client, "sam")
    client.patch(f"/api/users/{sam}", json={"active": False})
    assert tg.made("banChatMember")[-1] == {"chat_id": str(GROUP), "user_id": 777, "until_date": 0}
    join_request(777)
    assert tg.made("declineChatJoinRequest")[-1]["user_id"] == 777

    client.patch(f"/api/users/{sam}", json={"active": True})
    assert tg.made("unbanChatMember")[-1]["user_id"] == 777
    assert "https://t.me/+join-kopi" in tg.made("sendMessage")[-1]["text"]


def test_disconnecting_telegram_takes_the_person_out(client, make_user, tg):
    connect(client)
    staff = linked_staff(make_user)
    assert staff.delete("/api/auth/telegram").status_code == 204
    assert tg.made("banChatMember")[-1]["user_id"] == 777
    assert tg.made("unbanChatMember")[-1]["user_id"] == 777  # out, but not blocked
    join_request(777)
    assert tg.made("declineChatJoinRequest")[-1]["user_id"] == 777


def test_only_the_owner_manages_the_group(client, make_user, tg):
    connect(client)
    manager = make_user("manager", "mia", "Mia")
    staff = linked_staff(make_user)
    sam = user_id(client, "sam")
    for who in (manager, staff):
        assert who.put("/api/workspace/team-group", json={"chat_id": "-100"}).status_code == 403
        assert who.post(f"/api/users/{sam}/team-group/remove", json={"hours": 1}).status_code == 403
    owner_id = user_id(client, "olive")
    assert client.post(f"/api/users/{owner_id}/team-group/remove", json={"hours": 1}).status_code == 422


def test_disconnecting_the_group_revokes_the_link(client, tg):
    connect(client)
    ws = client.delete("/api/workspace/team-group").json()
    assert ws["telegram_team_chat_id"] == "" and tg.made("revokeChatInviteLink")
