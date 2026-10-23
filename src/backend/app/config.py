import os
from dataclasses import dataclass
from pathlib import Path

_DEFAULT_DB = Path(__file__).resolve().parents[1] / "receiving.db"


@dataclass(frozen=True)
class Settings:
    db_path: str
    # Shared PIN that managers send as the X-Manager-Pin header. Empty disables manager routes.
    manager_pin: str
    # "mock" returns fixed lines; "runpod" calls the RunPod serverless endpoint.
    extraction_mode: str
    runpod_endpoint_url: str
    runpod_api_key: str
    telegram_bot_token: str
    telegram_manager_chat_id: str
    telegram_staff_chat_id: str


def get_settings() -> Settings:
    """Read the environment on every call, so tests and Replit Secrets changes take effect."""
    env = os.environ.get
    return Settings(
        # `or` rather than a default argument: a copied .env leaves these set but empty.
        db_path=env("DB_PATH") or str(_DEFAULT_DB),
        manager_pin=env("MANAGER_PIN", ""),
        extraction_mode=env("EXTRACTION_MODE") or "mock",
        runpod_endpoint_url=env("RUNPOD_ENDPOINT_URL", ""),
        runpod_api_key=env("RUNPOD_API_KEY", ""),
        telegram_bot_token=env("TELEGRAM_BOT_TOKEN", ""),
        telegram_manager_chat_id=env("TELEGRAM_MANAGER_CHAT_ID", ""),
        telegram_staff_chat_id=env("TELEGRAM_STAFF_CHAT_ID", ""),
    )
