"""Other ways to sign in (passkeys, Google, Telegram, kitchen tablet PIN) and the sign-in record."""

import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient

from app import passkeys, sso
from app.main import app
from conftest import PASSWORD, sign_in

ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"


def browser(user_agent=ANDROID):
    return TestClient(app, headers={"user-agent": user_agent})


def login(username, user_agent=ANDROID):
    c = browser(user_agent)
    resp = c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return c, resp.json()


def sign_in_notes(client):
    return [n for n in client.get("/api/inbox").json()["items"] if n["kind"] == "sign_in"]


# ---- the sign-in record ---------------------------------------------------------------------------


def test_me_shows_the_sign_in_before_this_one(client):
    c, me = login("olive", ANDROID)
    # The fixture registered from the test client; this is the second sign-in.
    assert me["previous_sign_in"]["method"] == "register"
    _, me = login("olive", IPHONE)
    assert me["previous_sign_in"]["method"] == "password"
    assert me["previous_sign_in"]["device"] == "Chrome on Android"
    # The first browser's session still sees the sign-in before its own.
    assert c.get("/api/auth/me").json()["previous_sign_in"]["method"] == "register"


def test_a_new_device_or_method_lands_in_the_inbox_but_a_familiar_one_does_not(client):
    c, _ = login("olive", ANDROID)
    first = sign_in_notes(c)
    assert len(first) == 1 and "password on Chrome on Android" in first[0]["body"]
    login("olive", ANDROID)
    assert len(sign_in_notes(c)) == 1
    login("olive", IPHONE)
    assert "Safari on iPhone" in sign_in_notes(c)[0]["body"]


def test_the_owner_sees_each_persons_last_sign_in(client, make_user):
    make_user("staff", "sam", "Sam")
    rows = {r["username"]: r for r in client.get("/api/team/accountability").json()}
    assert rows["sam"]["last_sign_in"] is not None


# ---- kitchen tablet PIN ---------------------------------------------------------------------------


def kitchen_tablet(manager):
    """A signed-out browser that a manager marked as a kitchen tablet."""
    resp = manager.post("/api/kitchen-devices", json={"name": "Prep tablet"})
    assert resp.status_code == 201, resp.text
    manager.post("/api/auth/logout")
    return manager


def test_a_kitchen_tablet_lists_people_with_a_pin_and_signs_them_in(client, make_user):
    staff = make_user("staff", "sam", "Sam")
    assert staff.put("/api/auth/pin", json={"pin": "2468"}).status_code == 204
    make_user("staff", "nopin", "No Pin")
    tablet = kitchen_tablet(make_user("manager", "mia", "Mia"))

    screen = tablet.get("/api/auth/kitchen").json()
    assert screen["device_name"] == "Prep tablet"
    assert [p["display_name"] for p in screen["people"]] == ["Sam"]
    sam_id = screen["people"][0]["id"]

    assert tablet.post("/api/auth/kitchen/login", json={"user_id": sam_id, "pin": "1111"}).status_code == 401
    resp = tablet.post("/api/auth/kitchen/login", json={"user_id": sam_id, "pin": "2468"})
    assert resp.status_code == 200 and resp.json()["username"] == "sam"
    methods = [s["method"] for s in tablet.get("/api/auth/security").json()["recent_sign_ins"]]
    assert methods[0] == "kitchen_pin"


def test_a_pin_only_works_on_a_kitchen_tablet(client, make_user):
    staff = make_user("staff", "sam", "Sam")
    staff.put("/api/auth/pin", json={"pin": "2468"})
    sam_id = {m["username"]: m["id"] for m in client.get("/api/team").json()}["sam"]
    other = browser()
    assert other.get("/api/auth/kitchen").json() is None
    assert other.post("/api/auth/kitchen/login", json={"user_id": sam_id, "pin": "2468"}).status_code == 401


def test_pin_guessing_locks_the_person_out(client, make_user):
    staff = make_user("staff", "sam", "Sam")
    staff.put("/api/auth/pin", json={"pin": "2468"})
    tablet = kitchen_tablet(make_user("manager", "mia", "Mia"))
    sam_id = tablet.get("/api/auth/kitchen").json()["people"][0]["id"]
    for guess in ("0000", "1111", "2222", "3333", "4444"):
        tablet.post("/api/auth/kitchen/login", json={"user_id": sam_id, "pin": guess})
    assert tablet.post("/api/auth/kitchen/login", json={"user_id": sam_id, "pin": "2468"}).status_code == 429


def test_removing_a_tablet_stops_it_and_staff_cannot_add_one(client, make_user):
    assert make_user("staff", "sam", "Sam").post("/api/kitchen-devices", json={}).status_code == 403
    tablet = kitchen_tablet(make_user("manager", "mia", "Mia"))
    device = client.get("/api/kitchen-devices").json()[0]
    assert client.delete(f"/api/kitchen-devices/{device['id']}").status_code == 204
    assert tablet.get("/api/auth/kitchen").json() is None


def test_a_pin_must_be_4_to_8_digits(client):
    assert client.put("/api/auth/pin", json={"pin": "12a4"}).status_code == 422
    assert client.put("/api/auth/pin", json={"pin": "123"}).status_code == 422
    assert client.put("/api/auth/pin", json={"pin": None}).status_code == 204


# ---- Telegram -------------------------------------------------------------------------------------

BOT_TOKEN = "123456:secret-token"


def telegram_answer(telegram_id=777, token=BOT_TOKEN, age=0, **extra):
    data = {"id": telegram_id, "first_name": "Sam", "auth_date": int(time.time()) - age, **extra}
    check = "\n".join(f"{k}={data[k]}" for k in sorted(data))
    data["hash"] = hmac.new(hashlib.sha256(token.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    return data


def test_telegram_signs_in_once_connected(client, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    assert client.get("/api/auth/methods").json()["telegram_bot_id"] == "123456"
    assert browser().post("/api/auth/telegram/login", json=telegram_answer()).status_code == 401  # not connected

    assert client.post("/api/auth/telegram/link", json=telegram_answer(username="sam_k")).status_code == 204
    assert client.get("/api/auth/security").json()["telegram_linked"] is True
    resp = browser().post("/api/auth/telegram/login", json=telegram_answer())
    assert resp.status_code == 200 and resp.json()["username"] == "olive"


def test_telegram_answers_must_be_signed_for_our_bot_and_recent(client, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    client.post("/api/auth/telegram/link", json=telegram_answer())
    forged = {**telegram_answer(), "id": 778}
    for answer in (telegram_answer(token="999:other-bot"), telegram_answer(age=2 * 3600), forged):
        assert browser().post("/api/auth/telegram/login", json=answer).status_code == 401


def test_one_telegram_account_connects_to_one_sopbox_account(client, make_user, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    client.post("/api/auth/telegram/link", json=telegram_answer())
    staff = make_user("staff", "sam", "Sam")
    assert staff.post("/api/auth/telegram/link", json=telegram_answer()).status_code == 409
    assert client.delete("/api/auth/telegram").status_code == 204
    assert browser().post("/api/auth/telegram/login", json=telegram_answer()).status_code == 401


# ---- Google ---------------------------------------------------------------------------------------


def fake_google(monkeypatch, sub="google-123", **claims):
    """Google's token endpoint, answering with an ID token for `sub` and whatever nonce was asked for."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-1")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "s3cret")
    asked = {}

    def post(url, data, timeout):
        assert url == sso.GOOGLE_TOKEN_URL and data["code_verifier"]
        body = {"iss": "https://accounts.google.com", "aud": "client-1", "exp": time.time() + 600,
                "nonce": asked["nonce"], "sub": sub, **claims}
        token = "x." + base64.urlsafe_b64encode(json.dumps(body).encode()).decode().rstrip("=") + ".sig"
        return httpx.Response(200, json={"id_token": token}, request=httpx.Request("POST", url))

    monkeypatch.setattr(sso.httpx, "post", post)
    return asked


def google_round_trip(c, asked, mode="login", state=None):
    start = c.get(f"/api/auth/google/start?mode={mode}", follow_redirects=False)
    assert start.status_code == 303
    query = parse_qs(urlparse(start.headers["location"]).query)
    asked["nonce"] = query["nonce"][0]
    return c.get(
        f"/api/auth/google/callback?code=abc&state={state or query['state'][0]}", follow_redirects=False
    ).headers["location"]


def test_google_connects_then_signs_in(client, monkeypatch):
    asked = fake_google(monkeypatch)
    assert browser().get("/api/auth/methods").json()["google"] is True
    stranger = browser()
    assert google_round_trip(stranger, asked) == "/signin?auth_error=google_not_linked"

    assert google_round_trip(client, asked, "link") == "/settings?linked=google"
    c = browser()
    assert google_round_trip(c, asked) == "/"
    assert c.get("/api/auth/me").json()["username"] == "olive"


def test_google_rejects_a_wrong_state_nonce_or_audience(client, monkeypatch):
    asked = fake_google(monkeypatch)
    google_round_trip(client, asked, "link")
    assert google_round_trip(browser(), asked, state="forged") == "/signin?auth_error=google_failed"

    fake_google(monkeypatch, aud="someone-else")
    assert google_round_trip(browser(), asked) == "/signin?auth_error=google_failed"


def test_google_needs_the_browser_that_started_it(client, monkeypatch):
    fake_google(monkeypatch)
    resp = browser().get("/api/auth/google/callback?code=abc&state=x", follow_redirects=False)
    assert resp.headers["location"] == "/signin?auth_error=google_expired"


def test_connecting_google_needs_a_signed_in_person(monkeypatch):
    fake_google(monkeypatch)
    resp = browser().get("/api/auth/google/start?mode=link", follow_redirects=False)
    assert resp.headers["location"] == "/settings?auth_error=unavailable"


# ---- passkeys -------------------------------------------------------------------------------------


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def add_passkey(client, monkeypatch, credential_id=b"cred-1"):
    options = client.post("/api/auth/passkeys/register-options").json()
    assert options["rp"]["id"] == "testserver"
    assert options["authenticatorSelection"]["residentKey"] == "required"
    monkeypatch.setattr(
        passkeys, "verify_registration_response",
        lambda **kw: SimpleNamespace(credential_id=credential_id, credential_public_key=b"pk", sign_count=0),
    )
    return client.post("/api/auth/passkeys", json={"credential": {"rawId": b64url(credential_id)}, "name": "Sam's phone"})


def test_a_passkey_added_in_settings_signs_in_without_a_username(client, monkeypatch):
    assert add_passkey(client, monkeypatch).status_code == 201
    assert [p["name"] for p in client.get("/api/auth/security").json()["passkeys"]] == ["Sam's phone"]

    c = browser()
    options = c.post("/api/auth/passkeys/login-options").json()
    assert options["userVerification"] == "required" and options.get("allowCredentials") in (None, [])
    seen = {}

    def verify(**kw):
        seen.update(kw)
        return SimpleNamespace(new_sign_count=5)

    monkeypatch.setattr(passkeys, "verify_authentication_response", verify)
    resp = c.post("/api/auth/passkeys/login", json={"credential": {"rawId": b64url(b"cred-1")}})
    assert resp.status_code == 200 and resp.json()["username"] == "olive"
    assert seen["expected_origin"] == "http://testserver" and seen["require_user_verification"] is True
    assert client.get("/api/auth/security").json()["passkeys"][0]["last_used_at"]


def test_an_unknown_passkey_or_a_reused_challenge_is_refused(client, monkeypatch):
    add_passkey(client, monkeypatch)
    monkeypatch.setattr(passkeys, "verify_authentication_response", lambda **kw: SimpleNamespace(new_sign_count=1))
    c = browser()
    c.post("/api/auth/passkeys/login-options")
    assert c.post("/api/auth/passkeys/login", json={"credential": {"rawId": b64url(b"nope")}}).status_code == 401
    # That attempt used up the challenge.
    assert c.post("/api/auth/passkeys/login", json={"credential": {"rawId": b64url(b"cred-1")}}).status_code == 401


def test_a_removed_passkey_no_longer_works(client, monkeypatch):
    added = add_passkey(client, monkeypatch).json()
    assert client.delete(f"/api/auth/passkeys/{added['id']}").status_code == 204
    monkeypatch.setattr(passkeys, "verify_authentication_response", lambda **kw: SimpleNamespace(new_sign_count=1))
    c = browser()
    c.post("/api/auth/passkeys/login-options")
    assert c.post("/api/auth/passkeys/login", json={"credential": {"rawId": b64url(b"cred-1")}}).status_code == 401


def test_sign_in_method_changes_are_in_the_activity_log(client, monkeypatch):
    client.put("/api/auth/pin", json={"pin": "2468"})
    add_passkey(client, monkeypatch)
    details = [e["detail"] for e in client.get("/api/audit").json() if e["action"] == "user.sign_in_method"]
    assert details == ["Added a passkey for Sam's phone", "Set a kitchen tablet PIN"]


def test_sign_in_still_works_with_a_password_after_all_this(client):
    sign_in("olive")
