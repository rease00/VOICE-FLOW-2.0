from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any

import pytest

from services import razorpay_billing as rb


@dataclass
class _FakeResponse:
    status_code: int
    payload: Any = None
    text: str = ""
    reason: str = "OK"

    def json(self) -> Any:
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class _FakeSession:
    def __init__(self, responses: list[_FakeResponse]):
        self.responses = responses
        self.requests: list[dict[str, Any]] = []
        self.closed = False

    def request(self, method: str, url: str, **kwargs: Any) -> _FakeResponse:
        if not self.responses:
            raise AssertionError("No fake response configured for request")
        self.requests.append({"method": method, "url": url, **kwargs})
        return self.responses.pop(0)

    def close(self) -> None:
        self.closed = True


def _patch_session(monkeypatch: pytest.MonkeyPatch, *responses: _FakeResponse) -> _FakeSession:
    session = _FakeSession(list(responses))
    monkeypatch.setattr(rb.requests, "Session", lambda: session)
    return session


def test_create_customer_and_fetch_customer_use_expected_payload_and_normalize(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch_session(
        monkeypatch,
        _FakeResponse(
            200,
            {
                "id": "cust_123",
                "name": "Ava",
                "email": "ava@example.com",
                "contact": "9999999999",
                "gstin": "GSTIN-1",
                "notes": {"uid": "user_1"},
                "created_at": 111,
            },
        ),
        _FakeResponse(
            200,
            {
                "id": "cust_123",
                "name": "Ava",
                "email": "ava@example.com",
                "contact": "9999999999",
                "notes": {"uid": "user_1"},
                "created_at": 111,
            },
        ),
    )

    created = rb.create_customer(
        "Ava",
        "ava@example.com",
        "9999999999",
        {"uid": "user_1"},
        base_url="https://api.razorpay.com",
        auth=("key_id", "key_secret"),
    )
    fetched = rb.fetch_customer(customer_id="cust_123", base_url="https://api.razorpay.com", auth=("key_id", "key_secret"))

    assert fake.closed is True
    assert len(fake.requests) == 2
    first = fake.requests[0]
    assert first["method"] == "POST"
    assert first["url"] == "https://api.razorpay.com/v1/customers"
    assert first["auth"] == ("key_id", "key_secret")
    assert first["json"] == {
        "name": "Ava",
        "email": "ava@example.com",
        "contact": "9999999999",
        "notes": {"uid": "user_1"},
    }
    second = fake.requests[1]
    assert second["method"] == "GET"
    assert second["url"] == "https://api.razorpay.com/v1/customers/cust_123"

    assert created["provider"] == "razorpay"
    assert created["customer_id"] == "cust_123"
    assert created["email"] == "ava@example.com"
    assert fetched["customer_id"] == "cust_123"
    assert fetched["notes"] == {"uid": "user_1"}


def test_create_one_time_order_posts_expected_payload_and_normalizes_response(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch_session(
        monkeypatch,
        _FakeResponse(
            200,
            {
                "id": "order_123",
                "entity": "order",
                "amount": 5500,
                "amount_due": 5500,
                "amount_paid": 0,
                "currency": "INR",
                "receipt": "receipt#1",
                "status": "created",
                "notes": {"uid": "user_1"},
                "created_at": 1234567890,
            },
        ),
    )

    result = rb.create_one_time_order(
        5500,
        "inr",
        "receipt#1",
        {"uid": "user_1"},
        base_url="https://api.razorpay.com",
        auth=("key_id", "key_secret"),
    )

    assert fake.closed is True
    assert len(fake.requests) == 1
    sent = fake.requests[0]
    assert sent["method"] == "POST"
    assert sent["url"] == "https://api.razorpay.com/v1/orders"
    assert sent["auth"] == ("key_id", "key_secret")
    assert sent["json"] == {
        "amount": 5500,
        "currency": "INR",
        "receipt": "receipt#1",
        "payment_capture": 1,
        "notes": {"uid": "user_1"},
    }
    assert result["provider"] == "razorpay"
    assert result["resource"] == "order"
    assert result["order_id"] == "order_123"
    assert result["amount_minor"] == 5500
    assert result["notes"] == {"uid": "user_1"}


def test_create_subscription_cancel_resume_and_lists(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch_session(
        monkeypatch,
        _FakeResponse(
            200,
            {
                "id": "sub_123",
                "entity": "subscription",
                "plan_id": "plan_abc",
                "customer_id": "cust_abc",
                "status": "created",
                "quantity": 1,
                "total_count": 12,
                "start_at": 1234,
                "charge_at": 5678,
                "current_start": 0,
                "current_end": 0,
                "paid_count": 0,
                "remaining_count": 12,
                "customer_notify": True,
                "offer_id": "offer_1",
                "notes": {"uid": "user_2"},
            },
        ),
        _FakeResponse(
            200,
            {
                "items": [
                    {
                        "id": "pay_1",
                        "entity": "payment",
                        "status": "captured",
                        "amount": 12900,
                        "currency": "INR",
                        "order_id": "order_1",
                        "subscription_id": "sub_123",
                        "captured": True,
                        "method": "card",
                        "notes": {"uid": "user_2"},
                    }
                ]
            },
        ),
        _FakeResponse(
            200,
            {
                "items": [
                    {
                        "id": "sub_123",
                        "entity": "subscription",
                        "plan_id": "plan_abc",
                        "customer_id": "cust_abc",
                        "status": "active",
                        "total_count": 12,
                        "paid_count": 1,
                        "remaining_count": 11,
                    }
                ]
            },
        ),
        _FakeResponse(200, {"id": "sub_123", "entity": "subscription", "status": "cancelled", "plan_id": "plan_abc", "customer_id": "cust_abc"}),
        _FakeResponse(200, {"id": "sub_123", "entity": "subscription", "status": "active", "plan_id": "plan_abc", "customer_id": "cust_abc"}),
    )

    created = rb.create_subscription(
        {"id": "plan_abc"},
        {"customer_id": "cust_abc"},
        {"uid": "user_2"},
        start_at=1234,
        total_count=12,
        offer_id="offer_1",
        base_url="https://api.razorpay.com/v1",
        auth=("key_id", "key_secret"),
    )
    payments = rb.list_customer_payments("cust_abc", base_url="https://api.razorpay.com", auth=("key_id", "key_secret"), count=5)
    subscriptions = rb.list_customer_subscriptions("cust_abc", base_url="https://api.razorpay.com", auth=("key_id", "key_secret"), count=7)
    cancelled = rb.cancel_subscription("sub_123", base_url="https://api.razorpay.com", auth=("key_id", "key_secret"))
    resumed = rb.resume_subscription("sub_123", base_url="https://api.razorpay.com", auth=("key_id", "key_secret"))

    assert fake.closed is True
    assert len(fake.requests) == 5
    assert fake.requests[0]["url"] == "https://api.razorpay.com/v1/subscriptions"
    assert fake.requests[0]["json"]["plan_id"] == "plan_abc"
    assert fake.requests[0]["json"]["customer_id"] == "cust_abc"
    assert fake.requests[0]["json"]["total_count"] == 12
    assert fake.requests[0]["json"]["start_at"] == 1234
    assert fake.requests[0]["json"]["offer_id"] == "offer_1"
    assert fake.requests[1]["url"] == "https://api.razorpay.com/v1/customers/cust_abc/payments"
    assert fake.requests[1]["params"] == {"count": 5}
    assert fake.requests[2]["url"] == "https://api.razorpay.com/v1/subscriptions"
    assert fake.requests[2]["params"] == {"customer_id": "cust_abc", "count": 7}
    assert fake.requests[3]["url"] == "https://api.razorpay.com/v1/subscriptions/sub_123/cancel"
    assert fake.requests[3]["json"] == {"cancel_at_cycle_end": 1}
    assert fake.requests[4]["url"] == "https://api.razorpay.com/v1/subscriptions/sub_123/resume"

    assert created["provider"] == "razorpay"
    assert created["subscription_id"] == "sub_123"
    assert payments["resource"] == "payment_list"
    assert payments["items"][0]["payment_id"] == "pay_1"
    assert subscriptions["resource"] == "subscription_list"
    assert subscriptions["items"][0]["subscription_id"] == "sub_123"
    assert cancelled["status"] == "cancelled"
    assert resumed["status"] == "active"


def test_fetch_payment_and_normalize_invoice_and_order(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch_session(
        monkeypatch,
        _FakeResponse(
            200,
            {
                "id": "pay_1",
                "entity": "payment",
                "status": "captured",
                "amount": 12900,
                "currency": "inr",
                "order_id": "order_1",
                "subscription_id": "sub_1",
                "invoice_id": "in_1",
                "customer_id": "cust_1",
                "captured": True,
                "method": "card",
                "email": "user@example.com",
                "contact": "9999999999",
                "created_at": 123,
                "notes": {"uid": "user_1"},
            },
        ),
    )

    payment = rb.fetch_payment(payment_id="pay_1", base_url="https://api.razorpay.com", auth=("key_id", "key_secret"))
    invoice = rb.normalize_invoice_response(
        {
            "id": "in_1",
            "entity": "invoice",
            "order_id": "order_1",
            "payment_id": "pay_1",
            "subscription_id": "sub_1",
            "customer_id": "cust_1",
            "status": "paid",
            "amount": 12900,
            "amount_paid": 12900,
            "amount_due": 0,
            "currency": "inr",
            "attempts": 1,
            "notes": {"uid": "user_1"},
            "line_items": [{"name": "Pack"}],
            "created_at": 1,
            "issued_at": 2,
            "due_at": 3,
            "paid_at": 4,
        }
    )
    order = rb.normalize_order_response(
        {
            "id": "order_1",
            "entity": "order",
            "amount": 12900,
            "amount_paid": 12900,
            "amount_due": 0,
            "currency": "inr",
            "receipt": "receipt-1",
            "status": "paid",
            "notes": {"uid": "user_1"},
            "created_at": 123,
        }
    )

    assert fake.closed is True
    assert fake.requests[0]["url"] == "https://api.razorpay.com/v1/payments/pay_1"
    assert payment["payment_id"] == "pay_1"
    assert payment["captured"] is True
    assert invoice["invoice_id"] == "in_1"
    assert invoice["amount_paid_minor"] == 12900
    assert invoice["line_items"] == [{"name": "Pack"}]
    assert order["order_id"] == "order_1"
    assert order["amount_due_minor"] == 0


def test_api_error_translates_json_message(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _patch_session(
        monkeypatch,
        _FakeResponse(400, {"error": {"code": "BAD_REQUEST_ERROR", "description": "plan not found"}}, text="bad request", reason="Bad Request"),
    )

    with pytest.raises(rb.RazorpayAPIError) as exc:
        rb.create_one_time_order(
            1000,
            "INR",
            "receipt-1",
            {},
            base_url="https://api.razorpay.com",
            auth=("key_id", "key_secret"),
        )

    assert fake.closed is True
    assert exc.value.status_code == 400
    assert exc.value.code == "BAD_REQUEST_ERROR"
    assert "plan not found" in exc.value.message


def test_verify_checkout_signature_uses_order_and_payment_ids() -> None:
    secret = "whsec_test_secret"
    order_id = "order_IEIaMR65cu6nz3"
    payment_id = "pay_IH4NVgf4Dreq1l"
    message = f"{order_id}|{payment_id}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()

    assert rb.verify_checkout_signature(order_id, payment_id, signature, secret) is True
    assert rb.verify_checkout_signature(order_id, payment_id, "deadbeef", secret) is False
    assert rb.verify_subscription_signature(order_id, payment_id, signature, secret) is True


def test_verify_webhook_signature_uses_raw_body() -> None:
    secret = "whsec_webhook_secret"
    body = b'{"event":"order.paid","id":"evt_123"}'
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()

    assert rb.verify_webhook_signature(body, signature, secret) is True
    assert rb.verify_webhook_signature(body + b"\n", signature, secret) is False


def test_normalize_payment_customer_and_webhook_event() -> None:
    payment = rb.normalize_payment_response(
        {
            "id": "pay_1",
            "entity": "payment",
            "status": "captured",
            "amount": 12900,
            "currency": "inr",
            "order_id": "order_1",
            "subscription_id": "sub_1",
            "invoice_id": "in_1",
            "customer_id": "cust_1",
            "captured": True,
            "method": "card",
            "email": "user@example.com",
            "contact": "9999999999",
            "created_at": 123,
            "notes": {"uid": "user_1"},
        }
    )
    customer = rb.normalize_customer_response(
        {
            "id": "cust_1",
            "name": "Ava",
            "email": "user@example.com",
            "contact": "9999999999",
            "notes": {"uid": "user_1"},
            "created_at": 123,
        }
    )
    webhook = rb.normalize_webhook_event(json.dumps(
        {
            "id": "evt_1",
            "event": "payment.captured",
            "entity": "event",
            "account_id": "acc_1",
            "created_at": 123,
            "contains": "payment",
            "payload": {"payment": {"entity": {"id": "pay_1"}}},
        }
    ).encode("utf-8"))

    assert payment["provider"] == "razorpay"
    assert payment["payment_id"] == "pay_1"
    assert payment["order_id"] == "order_1"
    assert payment["captured"] is True
    assert payment["notes"] == {"uid": "user_1"}
    assert customer["customer_id"] == "cust_1"
    assert customer["name"] == "Ava"
    assert webhook["provider"] == "razorpay"
    assert webhook["event_id"] == "evt_1"
    assert webhook["event_type"] == "payment.captured"
    assert webhook["account_id"] == "acc_1"
    assert webhook["payload"] == {"payment": {"entity": {"id": "pay_1"}}}

