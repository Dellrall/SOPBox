"""Telegram alerts: sent when configured, skipped when not, and never able to break a delivery."""

import logging

import httpx
import pytest

from app import notifications

TOKEN = "123:secret-token"


@pytest.fixture
def telegram(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setenv("TELEGRAM_MANAGER_CHAT_ID", "111")
    monkeypatch.setenv("TELEGRAM_STAFF_CHAT_ID", "222")


def test_send_posts_the_message_to_the_chat(telegram, monkeypatch):
    sent = {}

    class Ok:
        def raise_for_status(self):
            pass

    def fake_post(url, json, timeout):
        sent.update(url=url, json=json)
        return Ok()

    monkeypatch.setattr(notifications.httpx, "post", fake_post)
    notifications.send_telegram("111", "hello")

    assert sent["url"] == f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    assert sent["json"] == {"chat_id": "111", "text": "hello"}


def test_long_messages_are_cut_to_fit_telegram(telegram, monkeypatch):
    sent = {}

    class Ok:
        def raise_for_status(self):
            pass

    monkeypatch.setattr(
        notifications.httpx, "post", lambda url, json, timeout: sent.update(json=json) or Ok()
    )
    notifications.send_telegram("111", "x" * 9000)
    assert len(sent["json"]["text"]) == 4000


@pytest.mark.parametrize(("token", "chat"), [("", "111"), (TOKEN, "")])
def test_nothing_is_sent_when_telegram_is_not_configured(monkeypatch, token, chat):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", token)

    def must_not_call(*args, **kwargs):
        raise AssertionError("httpx.post should not be called")

    monkeypatch.setattr(notifications.httpx, "post", must_not_call)
    notifications.send_telegram(chat, "hello")


def test_a_failed_send_is_swallowed_and_never_logs_the_token(telegram, monkeypatch, caplog):
    def fail(*args, **kwargs):
        raise httpx.ConnectError(f"cannot reach https://api.telegram.org/bot{TOKEN}/sendMessage")

    monkeypatch.setattr(notifications.httpx, "post", fail)
    with caplog.at_level(logging.DEBUG):
        notifications.send_telegram("111", "hello")  # must not raise

    assert "ConnectError" in caplog.text
    assert TOKEN not in caplog.text


def test_httpx_request_logging_is_kept_quiet_because_urls_hold_the_token():
    assert logging.getLogger("httpx").level >= logging.WARNING


# ---- when the API sends them ------------------------------------------------------------------


@pytest.fixture
def alerts(telegram, monkeypatch):
    from app import main

    sent = []
    monkeypatch.setattr(main, "send_telegram", lambda chat_id, text: sent.append((chat_id, text)))
    return sent


def test_a_held_delivery_alerts_the_managers_with_the_reasons(client, catalogue_ids, alerts):
    ids = catalogue_ids
    line = {"product_id": ids["sausage"], "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -2}
    client.post("/api/deliveries", json={"received_by": "Aina", "supplier": "Fresh Foods", "lines": [line]})

    ((chat_id, text),) = alerts
    assert chat_id == "111"
    assert "Delivery #1 needs approval" in text
    assert "Fresh Foods" in text and "Aina" in text
    assert "Frozen sausage: temperature -2 C outside -20 to -10 C" in text


def test_a_clean_delivery_sends_no_alert(client, catalogue_ids, alerts):
    ids = catalogue_ids
    line = {"product_id": ids["sausage"], "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -15}
    client.post("/api/deliveries", json={"received_by": "Aina", "lines": [line]})
    assert alerts == []


def test_a_decision_alerts_the_staff_with_the_reason(client, manager, catalogue_ids, alerts):
    ids = catalogue_ids
    line = {"product_id": ids["sausage"], "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -2}
    client.post("/api/deliveries", json={"received_by": "Aina", "lines": [line]})
    alerts.clear()

    client.post(
        "/api/deliveries/1/decision",
        json={"decision": "return", "decided_by": "Mr Tan", "reason": "Too warm"},
        headers=manager,
    )
    ((chat_id, text),) = alerts
    assert chat_id == "222"
    assert text == "Delivery #1 returned to the supplier by Mr Tan.\nReason: Too warm"


def test_a_failed_decision_sends_no_alert(client, manager, alerts):
    resp = client.post(
        "/api/deliveries/9999/decision",
        json={"decision": "accept", "decided_by": "Mr Tan"},
        headers=manager,
    )
    assert resp.status_code == 404
    assert alerts == []


def test_the_delivery_still_succeeds_when_telegram_is_down(client, catalogue_ids, telegram, monkeypatch):
    def down(*args, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(notifications.httpx, "post", down)
    ids = catalogue_ids
    line = {"product_id": ids["sausage"], "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -2}
    resp = client.post("/api/deliveries", json={"received_by": "Aina", "lines": [line]})
    assert resp.status_code == 201
    assert resp.json()["status"] == "pending_approval"
