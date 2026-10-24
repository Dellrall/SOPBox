"""Writing an SOP from the manager's notes: one model pass writes, a second checks. Nothing is saved."""

import pytest

from app import extraction
from app.errors import ExtractionError

NOTES = "keep frozen, reject if thawed or wet box, check expiry date"


def replies(*texts):
    """A fake model: each call returns the next reply, and records the prompt it was given."""
    prompts = []

    def ask(image, prompt, max_tokens, sleep, system=extraction.SYSTEM):
        assert image is None and system == extraction.SOP_SYSTEM
        prompts.append(prompt)
        reply = texts[len(prompts) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply

    return ask, prompts


def body(ids, **overrides):
    return {
        "name": "Frozen sausage",
        "category_id": ids["frozen_category"],
        "base_unit": "pcs",
        "pack_units": [{"unit": "box", "base_qty": 50}],
        "notes": NOTES,
        **overrides,
    }


def test_the_writer_drafts_and_the_checker_flags(client, catalogue_ids, monkeypatch):
    ask, prompts = replies(
        '{"steps": ["1. Probe the core temperature.", "Reject the box if thawed or wet.", "Store at -25 C."]}',
        '{"issues": [{"step": 3, "problem": "-25 C is not in the notes or the category range."}]}',
    )
    monkeypatch.setattr(extraction, "_ask_model", ask)
    resp = client.post("/api/products/sop-draft", json=body(catalogue_ids))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "sop": "1. Probe the core temperature.\n2. Reject the box if thawed or wet.\n3. Store at -25 C.",
        "issues": [{"step": 3, "problem": "-25 C is not in the notes or the category range."}],
        "checked": True,
    }
    # The writer got the product's real rules: the category range, since the product has none.
    assert '"arrival_temperature_c": "-20 to -10"' in prompts[0] and "1 box = 50 pcs" in prompts[0]
    assert NOTES in prompts[0]
    # The checker saw the numbered draft and the same facts.
    assert "3. Store at -25 C." in prompts[1] and NOTES in prompts[1]
    # Nothing was saved.
    assert all(p["sop"] == "" for p in client.get("/api/products").json())


def test_a_draft_survives_a_checker_that_fails(client, catalogue_ids, monkeypatch):
    ask, _ = replies('{"steps": ["Check the expiry date."]}', ExtractionError("the model job did not finish"))
    monkeypatch.setattr(extraction, "_ask_model", ask)
    resp = client.post("/api/products/sop-draft", json=body(catalogue_ids))
    assert resp.json() == {"sop": "1. Check the expiry date.", "issues": [], "checked": False}


@pytest.mark.parametrize("reply", ['{"steps": []}', '{"steps": [1, 2]}', "I cannot help with that."])
def test_a_writer_reply_without_steps_is_a_502(client, catalogue_ids, monkeypatch, reply):
    ask, _ = replies(reply)
    monkeypatch.setattr(extraction, "_ask_model", ask)
    assert client.post("/api/products/sop-draft", json=body(catalogue_ids)).status_code == 502


def test_steps_are_capped_and_issue_numbers_kept_in_range(monkeypatch):
    ask, _ = replies(
        '{"steps": [' + ", ".join(f'"Step {i}: do thing {i}."' for i in range(1, 15)) + "]}",
        '{"issues": [{"step": 40, "problem": "No such step."}]}',
    )
    monkeypatch.setattr(extraction, "_ask_model", ask)
    draft = extraction.write_sop({"name": "X"}, "notes")
    assert draft.sop.splitlines()[0] == "1. do thing 1." and len(draft.sop.splitlines()) == extraction.MAX_SOP_STEPS
    assert draft.issues[0].step is None


@pytest.mark.parametrize("change", [{"notes": ""}, {"notes": "x" * 2001}, {"temp_min_c": -20}])
def test_the_request_is_checked(client, catalogue_ids, change):
    assert client.post("/api/products/sop-draft", json=body(catalogue_ids, **change)).status_code == 422


def test_staff_cannot_draft_sops(make_user, catalogue_ids):
    staff = make_user("staff")
    assert staff.post("/api/products/sop-draft", json=body(catalogue_ids)).status_code == 403
