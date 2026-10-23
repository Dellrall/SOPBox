import secrets

from fastapi import Header, HTTPException

from app.config import get_settings


def require_manager(x_manager_pin: str | None = Header(default=None)) -> None:
    """Gate for routes that change rules or decide deliveries.

    Staff can receive deliveries and read the catalogue. Only a manager can edit the catalogue
    (it holds the temperature rules) or approve a failed delivery. The PIN is shared, so the
    names in the audit log are self-reported until Orbyte login replaces this.
    """
    pin = get_settings().manager_pin
    if not pin:
        raise HTTPException(status_code=503, detail="MANAGER_PIN is not configured on the server")
    if x_manager_pin is None or not secrets.compare_digest(x_manager_pin.encode(), pin.encode()):
        raise HTTPException(status_code=401, detail="invalid manager PIN")
