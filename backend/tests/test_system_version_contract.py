from fastapi.testclient import TestClient

from backend.app import app


def test_system_version_contract() -> None:
    client = TestClient(app)
    response = client.get("/system/version")
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("ok") is True
    assert isinstance(payload.get("apiVersion"), str)
    assert isinstance(payload.get("buildTime"), str)
    assert "gitSha" in payload
    assert isinstance(payload.get("features"), dict)
    assert "dubbingPrepare" in payload["features"]
    assert payload["features"].get("aiOpsGuardian") is True
