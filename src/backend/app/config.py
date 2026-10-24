import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # PostgreSQL connection string. On Replit, the Database tool sets this for you.
    database_url: str
    # Send the session cookie over HTTPS only. Turn off (COOKIE_SECURE=0) for plain-http local runs.
    cookie_secure: bool
    runpod_endpoint_id: str
    runpod_api_key: str
    # One bot for the whole app. Each workspace sets its own chat ids in Settings.
    telegram_bot_token: str
    # "Continue with Google" appears only when both are set (Google Cloud console, OAuth client).
    google_client_id: str
    google_client_secret: str


def get_settings() -> Settings:
    """Read the environment on every call, so tests and Replit Secrets changes take effect."""
    env = os.environ.get
    return Settings(
        database_url=env("DATABASE_URL", ""),
        cookie_secure=(env("COOKIE_SECURE") or "1") != "0",
        runpod_endpoint_id=env("RUNPOD_ENDPOINT_ID", ""),
        runpod_api_key=env("RUNPOD_API_KEY", ""),
        telegram_bot_token=env("TELEGRAM_BOT_TOKEN", ""),
        google_client_id=env("GOOGLE_CLIENT_ID", ""),
        google_client_secret=env("GOOGLE_CLIENT_SECRET", ""),
    )
