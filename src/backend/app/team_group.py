"""The workspace's Telegram team group, which only the workspace's own people can join.

A bot cannot create a group, so the owner makes one and adds the SOPBox bot as an admin that may
invite and ban members. Connecting it here makes one invite link that asks to join: Telegram sends
each request to /api/telegram/webhook, and the bot approves only a Telegram account linked to an
active person in that workspace who has not been removed. A forwarded link lets nobody else in.

People get the link by direct message when they connect Telegram (and when the group is connected
or they are let back in), and in Settings. The owner can remove someone for a while or until let
back in; disabling an account or disconnecting Telegram takes the person out too.
"""

import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import psycopg

from app.accounts import get_workspace
from app.auditlog import audit
from app.auth import CurrentUser, scope_to_workspace
from app.config import get_settings
from app.errors import InvalidRequestError, NotFoundError
from app.models import WorkspaceSettings

logger = logging.getLogger(__name__)

FOREVER = "9999-12-31T00:00:00+00:00"  # removed until the owner lets the person back in
_RIGHTS_HINT = (
    "Make the SOPBox bot an admin of the group with \"Invite users via link\" and \"Ban users\" turned on"
)


class TelegramError(Exception):
    def __init__(self, description: str, migrate_to: int | None = None):
        super().__init__(description)
        self.migrate_to = migrate_to


def _call(method: str, **params: Any) -> Any:
    token = get_settings().telegram_bot_token
    if not token:
        raise TelegramError("no Telegram bot is set up (TELEGRAM_BOT_TOKEN)")
    try:
        resp = httpx.post(f"https://api.telegram.org/bot{token}/{method}", json=params, timeout=10)
        body = resp.json()
    except (httpx.HTTPError, ValueError):
        # Never the error text: an httpx error message can contain the URL, and so the token.
        raise TelegramError("Telegram could not be reached") from None
    if not body.get("ok"):
        migrate = (body.get("parameters") or {}).get("migrate_to_chat_id")
        raise TelegramError(str(body.get("description", "Telegram refused the request")), migrate)
    return body["result"]


def _quietly(method: str, **params: Any) -> None:
    """For follow-ups that must never fail the request they come from."""
    try:
        _call(method, **params)
    except TelegramError as err:
        logger.warning("telegram %s failed: %s", method, err)


def webhook_secret() -> str:
    """What Telegram sends back in X-Telegram-Bot-Api-Secret-Token, derived from the bot token."""
    token = get_settings().telegram_bot_token.encode()
    return hmac.new(token, b"sopbox-telegram-webhook", hashlib.sha256).hexdigest()


UPDATES = ["chat_join_request", "message"]  # joining the team group, and people talking to the bot
_webhook_at: str | None = None


def set_webhook(origin: str) -> None:
    global _webhook_at
    _call("setWebhook", url=f"{origin}/api/telegram/webhook", secret_token=webhook_secret(), allowed_updates=UPDATES)
    _webhook_at = origin


def ensure_webhook(origin: str) -> None:
    """Point the bot at this server once per process, so direct messages reach it even before a
    team group is connected. Never fails the request it comes from."""
    if _webhook_at == origin or not get_settings().telegram_bot_token:
        return
    try:
        set_webhook(origin)
    except TelegramError as err:
        logger.warning("telegram setWebhook failed: %s", err)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- connecting the group ------------------------------------------------------------------------


def connect(conn: psycopg.Connection, owner: CurrentUser, chat_id: str, origin: str) -> WorkspaceSettings:
    try:
        try:
            chat = _call("getChat", chat_id=chat_id)
        except TelegramError as err:
            if not err.migrate_to:
                raise
            # A basic group turned into a supergroup and got a new id.
            chat = _call("getChat", chat_id=err.migrate_to)
        if chat.get("type") != "supergroup":
            raise InvalidRequestError(
                "Telegram only lets a bot approve join requests in a supergroup. In the group's settings, "
                "set \"Chat history for new members\" to Visible (this upgrades it), then use the new chat id"
            )
        bot_id = int(get_settings().telegram_bot_token.split(":", 1)[0])
        me = _call("getChatMember", chat_id=chat["id"], user_id=bot_id)
        if me.get("status") != "administrator" or not (me.get("can_invite_users") and me.get("can_restrict_members")):
            raise InvalidRequestError(_RIGHTS_HINT)
        link = _call("createChatInviteLink", chat_id=chat["id"], name="SOPBox team", creates_join_request=True)
        set_webhook(origin)
    except TelegramError as err:
        raise InvalidRequestError(f"Telegram: {err}") from None

    conn.execute(
        "UPDATE workspaces SET telegram_team_chat_id = %s, telegram_team_title = %s, telegram_team_invite_link = %s "
        "WHERE id = %s",
        (str(chat["id"]), chat.get("title", ""), link["invite_link"], owner.workspace_id),
    )
    audit(conn, owner.workspace_id, owner.display_name, "team_group.connected", None, f"Connected {chat.get('title', 'the team group')}")
    return get_workspace(conn, owner.workspace_id)


def invites_for_everyone(conn: psycopg.Connection, workspace_id: int) -> list[tuple[str, str]]:
    """Direct messages with the link for everyone who already connected Telegram."""
    ws = get_workspace(conn, workspace_id)
    rows = conn.execute(
        "SELECT telegram_id FROM users WHERE workspace_id = %s AND active AND telegram_id IS NOT NULL "
        "AND role <> 'owner' AND (team_group_removed_until IS NULL OR team_group_removed_until < %s)",
        (workspace_id, _now()),
    ).fetchall()
    return [(str(r["telegram_id"]), _invite_text(ws)) for r in rows]


def disconnect(conn: psycopg.Connection, owner: CurrentUser) -> WorkspaceSettings:
    ws = get_workspace(conn, owner.workspace_id)
    if ws.telegram_team_invite_link:
        _quietly("revokeChatInviteLink", chat_id=ws.telegram_team_chat_id, invite_link=ws.telegram_team_invite_link)
    conn.execute(
        "UPDATE workspaces SET telegram_team_chat_id = '', telegram_team_title = '', telegram_team_invite_link = '' "
        "WHERE id = %s",
        (owner.workspace_id,),
    )
    audit(conn, owner.workspace_id, owner.display_name, "team_group.connected", None, "Disconnected the team group")
    return get_workspace(conn, owner.workspace_id)


def _invite_text(ws: WorkspaceSettings) -> str:
    return (
        f"You're invited to the {ws.name} team group on Telegram: {ws.telegram_team_title}.\n"
        f"Tap to ask to join; SOPBox lets you in straight away.\n{ws.telegram_team_invite_link}"
    )


# ---- who may join --------------------------------------------------------------------------------


def _member(conn: psycopg.Connection, workspace_id: int, user_id: int) -> dict:
    row = conn.execute(
        "SELECT id, username, display_name, role, active, telegram_id, team_group_removed_until FROM users "
        "WHERE id = %s AND workspace_id = %s",
        (user_id, workspace_id),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"user {user_id} not found")
    return row


def _may_join(person: dict) -> bool:
    until = person["team_group_removed_until"]
    return bool(person["active"] and person["telegram_id"] and (until is None or until < _now()))


def link_for(conn: psycopg.Connection, user_id: int) -> tuple[str, str] | None:
    """(group title, invite link) when this person may join their workspace's group."""
    row = conn.execute(
        "SELECT u.active, u.telegram_id, u.team_group_removed_until, w.telegram_team_title, w.telegram_team_invite_link "
        "FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.id = %s",
        (user_id,),
    ).fetchone()
    if row is None or not row["telegram_team_invite_link"] or not _may_join(row):
        return None
    return row["telegram_team_title"], row["telegram_team_invite_link"]


def invite(conn: psycopg.Connection, user_id: int) -> tuple[str, str] | None:
    """The direct message with the link, for sending after the request (BackgroundTasks)."""
    row = conn.execute(
        "SELECT u.workspace_id, u.telegram_id FROM users u WHERE u.id = %s", (user_id,)
    ).fetchone()
    if row is None or link_for(conn, user_id) is None:
        return None
    return str(row["telegram_id"]), _invite_text(get_workspace(conn, row["workspace_id"]))


def handle_update(conn: psycopg.Connection, update: dict[str, Any]) -> None:
    """A Telegram webhook update. Join requests are approved only for the workspace's own people."""
    request = update.get("chat_join_request")
    if not isinstance(request, dict):
        return
    chat_id = (request.get("chat") or {}).get("id")
    telegram_id = (request.get("from") or {}).get("id")
    if not isinstance(chat_id, int) or not isinstance(telegram_id, int):
        return
    ws = conn.execute("SELECT id FROM workspaces WHERE telegram_team_chat_id = %s", (str(chat_id),)).fetchone()
    person = None
    if ws:
        person = conn.execute(
            "SELECT id, display_name, active, telegram_id, team_group_removed_until FROM users "
            "WHERE workspace_id = %s AND telegram_id = %s",
            (ws["id"], telegram_id),
        ).fetchone()
    if person and _may_join(person):
        _quietly("approveChatJoinRequest", chat_id=chat_id, user_id=telegram_id)
        scope_to_workspace(conn, ws["id"])  # no one is signed in on a webhook
        audit(conn, ws["id"], "SOPBox", "team_group.member", None, f"Let {person['display_name']} into the team group")
    else:
        _quietly("declineChatJoinRequest", chat_id=chat_id, user_id=telegram_id)


# ---- the owner's controls ------------------------------------------------------------------------


def remove(conn: psycopg.Connection, owner: CurrentUser, user_id: int, hours: int | None) -> str:
    """Take someone out of the group and keep them out for `hours`, or until let back in."""
    person = _member(conn, owner.workspace_id, user_id)
    if person["role"] == "owner":
        raise InvalidRequestError("the owner cannot be removed from the team group")
    ws = get_workspace(conn, owner.workspace_id)
    if not ws.telegram_team_chat_id:
        raise InvalidRequestError("connect a Telegram team group in Settings first")
    until_dt = datetime.now(timezone.utc) + timedelta(hours=hours) if hours else None
    if person["telegram_id"]:
        try:
            # until_date 0 bans until unbanned; Telegram lifts a dated ban by itself.
            _call(
                "banChatMember", chat_id=ws.telegram_team_chat_id, user_id=person["telegram_id"],
                until_date=int(until_dt.timestamp()) if until_dt else 0,
            )
        except TelegramError as err:
            raise InvalidRequestError(f"Telegram: {err}. {_RIGHTS_HINT}") from None
    until = until_dt.isoformat(timespec="seconds") if until_dt else FOREVER
    conn.execute("UPDATE users SET team_group_removed_until = %s WHERE id = %s", (until, user_id))
    span = {1: "for 1 hour", 24: "for 1 day", 168: "for 1 week"}.get(hours or 0, "until let back in")
    audit(conn, owner.workspace_id, owner.display_name, "team_group.member", None,
          f"Removed {person['display_name']} from the team group {span}")
    return until


def let_back(conn: psycopg.Connection, owner: CurrentUser, user_id: int) -> tuple[str, str] | None:
    """Lift a removal. Returns the invite message to send them, if they can join now."""
    person = _member(conn, owner.workspace_id, user_id)
    ws = get_workspace(conn, owner.workspace_id)
    if ws.telegram_team_chat_id and person["telegram_id"]:
        _quietly("unbanChatMember", chat_id=ws.telegram_team_chat_id, user_id=person["telegram_id"], only_if_banned=True)
    conn.execute("UPDATE users SET team_group_removed_until = NULL WHERE id = %s", (user_id,))
    audit(conn, owner.workspace_id, owner.display_name, "team_group.member", None,
          f"Let {person['display_name']} back into the team group")
    return invite(conn, user_id)


def kick_quietly(chat_id: str, telegram_id: int, *, keep_out: bool) -> None:
    """Take someone out after their account was disabled (keep_out) or Telegram disconnected."""
    if not chat_id:
        return
    _quietly("banChatMember", chat_id=chat_id, user_id=telegram_id, until_date=0)
    if not keep_out:
        # Ban then unban removes without blocking: a new account link can join again.
        _quietly("unbanChatMember", chat_id=chat_id, user_id=telegram_id, only_if_banned=True)


def unban_quietly(chat_id: str, telegram_id: int) -> None:
    if chat_id:
        _quietly("unbanChatMember", chat_id=chat_id, user_id=telegram_id, only_if_banned=True)
