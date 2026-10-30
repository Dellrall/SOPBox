"""The SOPBox bot answering people, in a direct chat or in the workspace's team group.

Who is talking comes from Telegram's own sender id, matched to an account that connected Telegram;
nobody else is answered. Commands (/take PO-0003, /pic PO-0003 @sam) are read by code. A plain
message to the bot is read by the model, which may only pick a job and names from the lists it is
given; code checks both, then the same PIC rules as the app apply: a manager assigns or removes
anyone, staff only themselves or ask to take over. Every change is in the activity log.
"""

import logging
import re
from datetime import date
from functools import lru_cache
from typing import Any

import psycopg

from app import assignments, extraction, team_group
from app.auth import get_me
from app.db import scope_to_user
from app.errors import ExtractionError, ForbiddenError, InvalidRequestError, NotFoundError
from app.models import AssignIn, Job

logger = logging.getLogger(__name__)

HELP = (
    "SOPBox bot\n"
    "/jobs: open jobs and their PICs\n"
    "/take PO-0003: be PIC of a job\n"
    "/drop PO-0003: stop being PIC\n"
    "/pic PO-0003 @sam: make someone PIC (managers)\n"
    "/unpic PO-0003 @sam: take someone off (managers)\n"
    "Or just tell me, for example: @bot make Sam PIC of the Dairy Farm order"
)
LINK_FIRST = "I do not know this Telegram account yet. In SOPBox, open Settings and connect Telegram, then message me again."


@lru_cache(maxsize=1)
def _bot() -> tuple[int, str]:
    """The bot's own id and @name, to know when a group message is meant for it."""
    try:
        me = team_group._call("getMe")
        return int(me["id"]), str(me.get("username", "")).lower()
    except team_group.TelegramError:
        return 0, ""


def _reply(chat_id: int, text: str, to: int | None) -> None:
    params: dict[str, Any] = {"chat_id": chat_id, "text": text[:4000]}
    if to:
        params["reply_parameters"] = {"message_id": to, "allow_sending_without_reply": True}
    team_group._quietly("sendMessage", **params)


def _part(text: str, e: dict) -> str:
    """The text an entity covers. Telegram counts in UTF-16 units, so an emoji before it is two."""
    raw = text.encode("utf-16-le")
    return raw[e["offset"] * 2 : (e["offset"] + e["length"]) * 2].decode("utf-16-le", errors="ignore")


def _mentions(conn: psycopg.Connection, ws: int, text: str, entities: list[dict]) -> tuple[list[tuple[int, str]], list[str], str]:
    """The people @mentioned, the @names nobody here matches, and the text with the mentions taken out."""
    bot_name = _bot()[1]
    found: list[tuple[int, str]] = []
    unknown: list[str] = []
    rest = text
    for e in entities:
        if e.get("type") == "text_mention" and isinstance((e.get("user") or {}).get("id"), int):
            row = conn.execute(
                "SELECT id, display_name FROM users WHERE workspace_id = %s AND active AND telegram_id = %s", (ws, e["user"]["id"])
            ).fetchone()
            label = _part(text, e)
        elif e.get("type") == "mention":
            label = _part(text, e)
            name = label.lstrip("@").lower()
            if name == bot_name:
                rest = rest.replace(label, " ")
                continue
            row = conn.execute(
                "SELECT id, display_name FROM users WHERE workspace_id = %s AND active "
                "AND (lower(telegram_username) = %s OR lower(username) = %s) ORDER BY telegram_username IS NULL LIMIT 1",
                (ws, name, name),
            ).fetchone()
        else:
            continue
        rest = rest.replace(label, " ")
        if row is None:
            unknown.append(label)
        elif (row["id"], row["display_name"]) not in found:
            found.append((row["id"], row["display_name"]))
    return found, unknown, rest


def _find(jobs: list[Job], words: str) -> Job | str:
    """The one open job these words name (a reference, delivery number or supplier), or what to say."""
    words = words.strip().lower()
    if not words:
        return "Which job? For example: /take PO-0003. Send /jobs to see them."
    exact = [j for j in jobs if words.lstrip("#") in {t.strip("#").lower() for t in j.title.split()}]
    hits = exact or [j for j in jobs if words in j.title.lower()]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        return f"No open job matches “{words}”. Send /jobs to see them."
    return "That matches more than one job:\n" + "\n".join(f"• {j.title}" for j in hits[:6])


def _list(jobs: list[Job], me: int) -> str:
    if not jobs:
        return "No open jobs."
    lines = []
    for j in jobs[:15]:
        pics = ", ".join("you" if p.user_id == me else p.name for p in j.pics) or "nobody yet"
        lines.append(f"• {j.title}: {j.when}. PIC: {pics}")
    return "\n".join(lines)


def _do(conn: psycopg.Connection, user, action: str, job: Job, people: list[tuple[int, str]]) -> str:
    """Apply one action through the app's own rules, and say what happened."""
    if action in ("assign", "remove") and not people:
        action = "take" if action == "assign" else "drop"
    targets = people if action in ("assign", "remove") else [(user.id, user.display_name)]
    said = []
    for uid, name in targets:
        who = "You" if uid == user.id else name
        try:
            if action in ("take", "assign"):
                status = assignments.assign(conn, user, AssignIn(kind=job.kind, ref_id=job.ref_id, user_id=uid)).status
                said.append({
                    "assigned": f"{who} {'are' if who == 'You' else 'is'} now PIC of {job.title}.",
                    "already": f"{who} {'are' if who == 'You' else 'is'} already PIC of {job.title}.",
                    "requested": f"Asked a manager to approve {who.lower() if who == 'You' else who} taking over {job.title}.",
                }[status])
            else:
                if not any(p.user_id == uid for p in job.pics):
                    said.append(f"{who} {'are' if who == 'You' else 'is'} not PIC of {job.title}.")
                    continue
                assignments.unassign(conn, user, job.kind, job.ref_id, uid)
                said.append(f"{who} {'are' if who == 'You' else 'is'} off {job.title}.")
        except (ForbiddenError, InvalidRequestError, NotFoundError) as err:
            said.append(f"{name}: {err}.")
    return "\n".join(said)


def respond(conn: psycopg.Connection, user, text: str, entities: list[dict], today: date | None = None) -> str:
    """What the bot says back to one message from this person."""
    jobs = assignments.jobs(conn, user, today or date.today())
    people, unknown, rest = _mentions(conn, user.workspace_id, text, entities)
    note = (
        f"\nI do not know {', '.join(unknown)} yet: they need to connect Telegram in SOPBox and message me once."
        if unknown else ""
    )
    command = re.match(r"^/(\w+)(?:@\w+)?\s*(.*)$", rest.strip(), re.DOTALL)
    if command:
        name, args = command.group(1).lower(), command.group(2)
        if name in ("start", "help"):
            return f"Hi {user.display_name}.\n{HELP}"
        if name == "jobs":
            return _list(jobs, user.id)
        action = {"take": "take", "drop": "drop", "pic": "assign", "unpic": "remove"}.get(name)
        if action is None:
            return f"I do not know /{name}.\n{HELP}"
        job = _find(jobs, args)
        return (_do(conn, user, action, job, people) if isinstance(job, Job) else job) + note

    # A sentence: the model picks the action, the job from the list and any names from the team.
    team = conn.execute(
        "SELECT id, display_name FROM users WHERE workspace_id = %s AND active ORDER BY id", (user.workspace_id,)
    ).fetchall()
    try:
        action, index, named = extraction.read_command(text, [j.title for j in jobs], [t["display_name"] for t in team])
    except ExtractionError:
        return f"I can only read commands right now.\n{HELP}"
    if action == "none":
        return f"Sorry, I did not get that.\n{HELP}"
    if action == "jobs":
        return _list(jobs, user.id)
    if index is None:
        return "Which job? Name its order number or supplier, or send /jobs to see them."
    # An @mention is exact; a name the model read is used only when nobody was tagged.
    if not people:
        people = [(t["id"], t["display_name"]) for t in team if t["display_name"] in named]
    return _do(conn, user, action, jobs[index], people) + note


def handle_message(conn: psycopg.Connection, msg: dict[str, Any]) -> None:
    """One message to the bot, in a direct chat or the team group."""
    text = (msg.get("text") or "").strip()
    chat, sender = msg.get("chat") or {}, msg.get("from") or {}
    if not text or sender.get("is_bot") or not isinstance(sender.get("id"), int) or not isinstance(chat.get("id"), int):
        return
    private = chat.get("type") == "private"
    bot_id, bot_name = _bot()
    replied_to = ((msg.get("reply_to_message") or {}).get("from") or {}).get("id")
    other_bot = re.match(r"^/\w+@(\w+)", text)
    if other_bot and other_bot.group(1).lower() != bot_name:
        return  # a command for another bot in the group
    if not private and not (text.startswith("/") or (bot_name and f"@{bot_name}" in text.lower()) or (bot_id and replied_to == bot_id)):
        return  # group chatter that is not for the bot
    person = conn.execute("SELECT id, workspace_id FROM users WHERE telegram_id = %s AND active", (sender["id"],)).fetchone()
    if not private:
        ws = conn.execute("SELECT id FROM workspaces WHERE telegram_team_chat_id = %s", (str(chat["id"]),)).fetchone()
        if ws is None:
            return
        if person is not None and person["workspace_id"] != ws["id"]:
            person = None
    if person is None:
        _reply(chat["id"], LINK_FIRST, msg.get("message_id"))
        return
    scope_to_user(conn, person["workspace_id"], person["id"])
    if sender.get("username"):
        conn.execute("UPDATE users SET telegram_username = %s WHERE id = %s", (str(sender["username"])[:64], person["id"]))
    _reply(chat["id"], respond(conn, get_me(conn, person["id"]), text, msg.get("entities") or []), msg.get("message_id"))
