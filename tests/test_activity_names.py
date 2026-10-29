"""Every action the backend writes to the activity log has a name on the Activity page, so people
never see "storage.created" style codes."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_every_logged_action_has_a_name_on_the_activity_page():
    backend = "\n".join(p.read_text() for p in (ROOT / "src/backend/app").glob("*.py"))
    # The action is the first "word.word" string within a few lines of an audit call.
    calls = re.findall(r"audit(?:_entry)?\((.{0,200}?)\)", backend, re.S)
    actions = {m for call in calls for m in re.findall(r'"([a-z_]+\.[a-z_]+)"', call)}
    # Delivery decisions are logged as f"delivery.{status}".
    actions |= {"delivery.accepted", "delivery.rejected", "delivery.returned", "delivery.partly_accepted"}
    assert len(actions) > 30
    page = (ROOT / "src/frontend/src/Activity.tsx").read_text()
    missing = sorted(a for a in actions if f'"{a}":' not in page)
    assert not missing, f"name these in Activity.tsx ACTIONS: {missing}"
