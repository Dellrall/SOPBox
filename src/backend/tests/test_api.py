from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_products_lists_seed_catalogue():
    names = [p["name"] for p in client.get("/api/products").json()]
    assert "Frozen sausage" in names


def test_extract_mock_returns_lines():
    resp = client.post("/api/extract", json={"image_b64": "ZmFrZQ=="})
    assert resp.status_code == 200
    assert resp.json()[0]["name"] == "Fries tray"


def test_check_flags_bad_temperature_for_approval():
    body = {"lines": [{"product_id": "frozen-sausage", "quantity": 40, "unit": "pcs", "temp_c": -5}]}
    data = client.post("/api/deliveries/check", json=body).json()
    assert data["needs_approval"] is True
    assert data["checks"][0]["passed"] is False
