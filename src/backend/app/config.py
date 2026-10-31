import os
from dataclasses import dataclass
from pathlib import Path


def _load_env_file() -> None:
    """Local runs: read the AI_ settings from a git-ignored .env file. Real variables win; the
    other settings still come from the environment only, as before."""
    here = Path(__file__).resolve()
    for path in (here.parents[1] / ".env", here.parents[3] / ".env"):  # src/backend/.env, then the repository's
        if path.is_file():
            _read(path)


def _read(path: Path) -> None:
    for line in path.read_text().splitlines():
        key, eq, value = line.strip().partition("=")
        key = key.strip().removeprefix("export ").strip()
        if eq and key.startswith("AI_"):
            os.environ.setdefault(key, value.strip().strip("'\""))


_load_env_file()


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
    # Encrypts each authenticator secret (mfa.py): 32 random bytes, base64. Make one with
    # python -c "import secrets; print(secrets.token_urlsafe(32))". Keep it: losing or changing it
    # leaves people only their backup codes until their two-step sign-in is reset.
    mfa_encryption_key: str
    # Lets SOPBox support call /api/ops/ (ops.py), e.g. to hand a workspace to a new owner. Unset or
    # shorter than 32 characters: those routes do not exist.
    ops_token: str
    # The text-and-vision model for sales reading (sales_ai.py): any OpenAI-compatible endpoint.
    # Unset AI_API_KEY: sales are matched by code and saved matches only.
    ai_api_key: str
    ai_base_url: str
    ai_model: str


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
        mfa_encryption_key=env("MFA_ENCRYPTION_KEY", ""),
        ops_token=env("OPS_TOKEN", ""),
        ai_api_key=env("AI_API_KEY", ""),
        ai_base_url=env("AI_BASE_URL", "https://litellm.rapidscreen.io/v1").rstrip("/"),
        ai_model=env("AI_MODEL", "gpt-5.4-mini"),
    )
