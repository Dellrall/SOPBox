"""Telegram alerts. A failed alert must never fail the delivery, so nothing here raises."""

import logging

import httpx

from app.config import get_settings
from app.models import Delivery

logger = logging.getLogger(__name__)

# httpx logs each request URL at INFO, and a Telegram URL contains the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)

_STATUS_LABEL = {
    "accepted": "accepted",
    "rejected": "rejected",
    "returned": "returned to the supplier",
}


def send_telegram(chat_id: str, text: str) -> None:
    token = get_settings().telegram_bot_token
    if not token or not chat_id:
        logger.info("telegram not configured; skipping alert")
        return
    try:
        resp = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text[:4000]},
            timeout=10,
        )
        resp.raise_for_status()
    except httpx.HTTPError as err:
        # Log the class only: an httpx error message can contain the URL, and so the token.
        logger.warning("telegram alert failed: %s", type(err).__name__)


def approval_needed_message(d: Delivery) -> str:
    lines = [
        f"Delivery #{d.id} needs approval",
        f"From: {d.supplier or 'unknown supplier'}. Received by: {d.received_by}.",
    ]
    for line in d.lines:
        if not line.passed:
            lines.append(f"- {line.name}: {'; '.join(line.issues)}")
    return "\n".join(lines)


def decision_message(d: Delivery) -> str:
    text = f"Delivery #{d.id} {_STATUS_LABEL.get(d.status, d.status)} by {d.decided_by}."
    if d.decision_reason:
        text += f"\nReason: {d.decision_reason}"
    return text
