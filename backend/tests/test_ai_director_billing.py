from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

import app as backend_app


client = TestClient(backend_app.app)


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, object]) -> None:
        self.status_code = int(status_code)
        self.ok = 200 <= self.status_code < 300
        self._payload = dict(payload)
        self.text = str(payload)

    def json(self) -> dict[str, object]:
        return dict(self._payload)


@pytest.fixture(autouse=True)
def _reset_ai_director_state(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_NOTIFICATION_INBOX.clear()
    backend_app._EXPENSIVE_REQUEST_LIMITER.clear_all_local_state()
    yield
    backend_app._EXPENSIVE_REQUEST_LIMITER.clear_all_local_state()


def test_ai_generate_text_bills_platform_usage_from_gemini_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = "director_platform_user"

    def _fake_post(url: str, **kwargs):
        _ = kwargs
        assert url.endswith("/v1/generate-text")
        return _FakeResponse(
            200,
            {
                "ok": True,
                "text": "Director response ready.",
                "model": "gemini-2.5-flash",
                "trace_id": "trace_ai_platform_1",
                "usageMetadata": {
                    "promptTokens": 1000,
                    "outputTokens": 500,
                    "totalTokens": 1500,
                    "providerReported": True,
                },
            },
        )

    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    response = client.post(
        "/ai/generate-text",
        headers={"x-dev-uid": uid},
        json={
            "systemPrompt": "You are a director.",
            "userPrompt": "Draft a narration outline.",
            "jsonMode": False,
            "temperature": 0.3,
            "modelCandidates": ["gemini-2.5-flash"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    request_id = str(payload.get("requestId") or "").strip()
    assert request_id
    billing = payload.get("billing") or {}
    expected_billing = backend_app._build_ai_director_billing_payload(
        prompt_tokens=1000,
        output_tokens=500,
        total_tokens=1500,
        model="gemini-2.5-flash",
        billed_chars=len("Director response ready."),
        user_key_billed=False,
    )
    assert billing.get("pricingSource") == "catalog"
    assert abs(float(billing.get("billedVfCost") or 0.0) - float(expected_billing.get("billedVfCost") or 0.0)) < 1e-9
    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_{request_id}") or {}
    assert str(event.get("feature") or "") == "ai_director"
    assert str(event.get("status") or "") == "committed"
    assert str(event.get("model") or "") == "gemini-2.5-flash"
    assert str(event.get("traceId") or "") == "trace_ai_platform_1"
    assert int(((event.get("runtimeUsage") or {}).get("totalTokens")) or 0) == 1500


def test_ai_generate_text_marks_user_key_requests_unbilled(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = "director_user_key_user"

    def _fake_post(url: str, **kwargs):
        _ = kwargs
        assert url.endswith("/v1/generate-text")
        return _FakeResponse(
            200,
            {
                "ok": True,
                "text": "User-key text.",
                "model": "gemini-2.5-flash-lite",
                "trace_id": "trace_ai_user_key_1",
                "usageMetadata": {
                    "promptTokens": 120,
                    "outputTokens": 45,
                    "totalTokens": 165,
                    "providerReported": True,
                },
            },
        )

    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    response = client.post(
        "/ai/generate-text",
        headers={"x-dev-uid": uid},
        json={
            "systemPrompt": "You are a director.",
            "userPrompt": "Suggest a hook.",
            "apiKey": "user-owned-gemini-key",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    request_id = str(payload.get("requestId") or "").strip()
    billing = payload.get("billing") or {}
    assert billing.get("userKeyBilled") is True
    assert float(billing.get("billedVfCost") or 0.0) == 0.0
    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_{request_id}") or {}
    assert event.get("userKeyBilled") is True
    assert float(event.get("billedVfCost") or 0.0) == 0.0


def test_ai_generate_text_settles_zero_and_alerts_when_usage_and_recount_are_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uid = "director_missing_usage_user"
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", ("admin_cost_watch",))

    def _fake_post(url: str, **kwargs):
        _ = kwargs
        if url.endswith("/v1/generate-text"):
            return _FakeResponse(
                200,
                {
                    "ok": True,
                    "text": "Missing usage response.",
                    "model": "gemini-2.5-flash",
                    "trace_id": "trace_ai_missing_usage_1",
                    "usageMetadata": {},
                },
            )
        if url.endswith("/v1/count-tokens"):
            return _FakeResponse(502, {"detail": "countTokens unavailable"})
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    response = client.post(
        "/ai/generate-text",
        headers={"x-dev-uid": uid},
        json={
            "systemPrompt": "You are a director.",
            "userPrompt": "Suggest a tagline.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    billing = payload.get("billing") or {}
    assert billing.get("pricingSource") == "missing_usage"
    assert float(billing.get("billedVfCost") or 0.0) == 0.0
    inbox = backend_app._INMEMORY_NOTIFICATION_INBOX.get("admin_cost_watch") or {}
    assert any(str(item.get("eventCode") or "") == "admin.billing.ai_director.usage_missing" for item in inbox.values())
