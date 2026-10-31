"""The assistant: tools answer from the records with the asker's access; it only offers buttons. No paid AI is called."""

import json
from types import SimpleNamespace

from app import assistant


def _fake_model(monkeypatch, replies):
    """Each model turn returns the next reply; the messages it was sent are kept."""
    sent = []

    def call(messages, tools):
        sent.append(([m.copy() for m in messages], [t["function"]["name"] for t in tools]))
        return replies.pop(0)

    monkeypatch.setattr(assistant, "get_settings", lambda: SimpleNamespace(ai_api_key="test"))
    monkeypatch.setattr(assistant, "_call", call)
    return sent


def _tool_call(tool, **args):
    return {"id": f"c-{tool}", "type": "function", "function": {"name": tool, "arguments": json.dumps(args)}}


def test_assistant_answers_from_tools_and_offers_a_button(client, monkeypatch):
    sent = _fake_model(monkeypatch, [
        {"content": None, "tool_calls": [_tool_call("records", topic="approvals"),
                                         _tool_call("open_page", page="approvals", label="Check them")]},
        {"content": "No delivery is waiting."},
    ])
    resp = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "anything to approve?"}]})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"text": "No delivery is waiting.", "links": [{"page": "approvals", "label": "Check them"}]}
    tool_results = [m["content"] for m in sent[1][0] if m["role"] == "tool"]
    assert tool_results == ["No delivery is waiting for a manager.", "button shown"]
    assert "report" in sent[0][1]  # an owner may run reports
    assert client.get("/api/plan").json()["ai_used"] == 1


def test_staff_get_only_what_their_access_allows(client, make_user, monkeypatch):
    staff = make_user("staff")
    sent = _fake_model(monkeypatch, [
        {"content": None, "tool_calls": [_tool_call("stock", name="fries"), _tool_call("open_page", page="reports")]},
        {"content": "Ask a manager."},
    ])
    resp = staff.post("/api/assistant", json={"messages": [{"role": "user", "content": "stock of fries?"}]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["links"] == []
    assert [m["content"] for m in sent[1][0] if m["role"] == "tool"] == [
        "no product found", "the person cannot open that page"]  # staff see stock, but not Reports
    assert "report" not in sent[0][1]


def test_without_the_ai_service_the_fixed_questions_answer(client):
    resp = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "what is waiting for approval?"}]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "No delivery is waiting for a manager."
    assert resp.json()["links"] == [{"page": "approvals", "label": "See the details"}]
