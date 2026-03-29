from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from typing import Any, Mapping, Optional

import requests

RAZORPAY_PROVIDER = "razorpay"
RAZORPAY_DEFAULT_API_ROOT = "https://api.razorpay.com/v1"
RAZORPAY_JSON_HEADERS = {"Content-Type": "application/json"}


@dataclass(frozen=True)
class RazorpayAuth:
    key_id: str
    key_secret: str

    @property
    def enabled(self) -> bool:
        return bool(self.key_id and self.key_secret)


class RazorpayBillingError(RuntimeError):
    pass


class RazorpayAPIError(RazorpayBillingError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        code: str | None = None,
        field: str | None = None,
        payload: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = int(status_code)
        self.code = code
        self.field = field
        self.payload = payload


def read_razorpay_auth(*, key_id: str = "", key_secret: str = "") -> RazorpayAuth:
    return RazorpayAuth(
        key_id=str(key_id or os.getenv("RAZORPAY_KEY_ID") or "").strip(),
        key_secret=str(key_secret or os.getenv("RAZORPAY_KEY_SECRET") or "").strip(),
    )


def _as_mapping(payload: Any) -> dict[str, Any]:
    return payload if isinstance(payload, dict) else {}


def _normalize_str(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional_str(value: Any) -> str | None:
    normalized = _normalize_str(value)
    return normalized or None


def _normalize_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def _normalize_bool(value: Any) -> bool:
    return bool(value)


def _normalize_notes(payload: Any) -> dict[str, Any]:
    return dict(payload) if isinstance(payload, Mapping) else {}


def _normalize_list_items(items: Any, normalizer: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    return [normalizer(item) for item in items if isinstance(item, Mapping)]


def _normalize_id(value: Any) -> str | None:
    return _normalize_optional_str(value)


def _resolve_api_root(base_url: str | None) -> str:
    root = _normalize_str(base_url or RAZORPAY_DEFAULT_API_ROOT).rstrip("/")
    if not root:
        root = RAZORPAY_DEFAULT_API_ROOT
    if root.endswith("/v1"):
        return root
    return f"{root}/v1"


def _build_url(base_url: str | None, path: str) -> str:
    suffix = path if path.startswith("/") else f"/{path}"
    return f"{_resolve_api_root(base_url)}{suffix}"


def _coerce_auth(auth: Any) -> Any:
    if isinstance(auth, RazorpayAuth):
        return (auth.key_id, auth.key_secret)
    return auth


def _response_json(response: Any) -> dict[str, Any]:
    try:
        data = response.json()
    except Exception:
        text = _normalize_str(getattr(response, "text", ""))
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except Exception:
            return {"detail": text}
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    return data if isinstance(data, dict) else {"value": data}


def _error_details_from_response(response: Any, payload: dict[str, Any]) -> tuple[str, str | None, str | None]:
    error_payload = payload.get("error") if isinstance(payload, dict) else None
    status_text = _normalize_str(getattr(response, "reason", ""))
    body_text = _normalize_str(getattr(response, "text", ""))

    if isinstance(error_payload, dict):
        code = _normalize_optional_str(error_payload.get("code"))
        field = _normalize_optional_str(error_payload.get("field"))
        message = (
            _normalize_optional_str(error_payload.get("description"))
            or _normalize_optional_str(error_payload.get("reason"))
            or _normalize_optional_str(error_payload.get("message"))
            or body_text
            or status_text
            or "Razorpay request failed."
        )
        return message, code, field

    message = (
        _normalize_optional_str(payload.get("message"))
        or _normalize_optional_str(payload.get("detail"))
        or body_text
        or status_text
        or "Razorpay request failed."
    )
    code = _normalize_optional_str(payload.get("code"))
    field = _normalize_optional_str(payload.get("field"))
    return message, code, field


def _request_json(
    method: str,
    path: str,
    *,
    base_url: str | None,
    auth: Any,
    payload: Optional[dict[str, Any]] = None,
    params: Optional[dict[str, Any]] = None,
    timeout_sec: float = 30.0,
) -> dict[str, Any]:
    auth_value = _coerce_auth(auth)
    if not auth_value:
        raise RazorpayBillingError("Razorpay auth is required.")

    session = requests.Session()
    try:
        response = session.request(
            method.upper(),
            _build_url(base_url, path),
            auth=auth_value,
            json=payload if payload is not None and method.upper() not in {"GET", "HEAD"} else None,
            params=params or None,
            headers=RAZORPAY_JSON_HEADERS,
            timeout=max(3.0, float(timeout_sec or 30.0)),
        )
        data = _response_json(response)
        if 200 <= int(getattr(response, "status_code", 0) or 0) < 300:
            return data
        message, code, field = _error_details_from_response(response, data)
        raise RazorpayAPIError(
            message,
            status_code=int(getattr(response, "status_code", 0) or 0),
            code=code,
            field=field,
            payload=data,
        )
    finally:
        session.close()


def _resolve_entity_id(value: Any, *, keys: tuple[str, ...]) -> str:
    if isinstance(value, Mapping):
        for key in keys:
            candidate = _normalize_optional_str(value.get(key))
            if candidate:
                return candidate
        return ""
    return _normalize_str(value)


def _resolve_customer_id(customer: Any) -> str:
    resolved = _resolve_entity_id(customer, keys=("customer_id", "id"))
    if not resolved:
        raise ValueError("customer_id is required for the Razorpay customer/subscription flow.")
    return resolved


def _resolve_plan_id(plan: Any) -> str:
    resolved = _resolve_entity_id(plan, keys=("plan_id", "id"))
    if not resolved:
        raise ValueError("plan_id is required for the Razorpay subscription flow.")
    return resolved


def normalize_customer_response(payload: Any) -> dict[str, Any]:
    data = _as_mapping(payload)
    customer_id = _normalize_id(data.get("id") or data.get("customer_id"))
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "customer",
        "id": customer_id,
        "customer_id": customer_id,
        "name": _normalize_optional_str(data.get("name")),
        "email": _normalize_optional_str(data.get("email")),
        "contact": _normalize_optional_str(data.get("contact")),
        "gstin": _normalize_optional_str(data.get("gstin")),
        "notes": _normalize_notes(data.get("notes")),
        "created_at": _normalize_int(data.get("created_at"), 0) or None,
        "raw": data,
    }


def normalize_order_response(payload: Any) -> dict[str, Any]:
    data = _as_mapping(payload)
    order_id = _normalize_id(data.get("id") or data.get("order_id"))
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "order",
        "id": order_id,
        "order_id": order_id,
        "amount_minor": _normalize_int(data.get("amount"), 0),
        "amount_paid_minor": _normalize_int(data.get("amount_paid"), 0),
        "amount_due_minor": _normalize_int(data.get("amount_due"), 0),
        "currency": (_normalize_optional_str(data.get("currency")) or "INR").upper(),
        "status": _normalize_optional_str(data.get("status")),
        "receipt": _normalize_optional_str(data.get("receipt")),
        "attempts": _normalize_int(data.get("attempts"), 0),
        "payment_capture": _normalize_bool(data.get("payment_capture")) if "payment_capture" in data else None,
        "notes": _normalize_notes(data.get("notes")),
        "created_at": _normalize_int(data.get("created_at"), 0) or None,
        "raw": data,
    }


def normalize_payment_response(payload: Any) -> dict[str, Any]:
    data = _as_mapping(payload)
    payment_id = _normalize_id(data.get("id") or data.get("payment_id"))
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "payment",
        "id": payment_id,
        "payment_id": payment_id,
        "order_id": _normalize_optional_str(data.get("order_id")),
        "subscription_id": _normalize_optional_str(data.get("subscription_id")),
        "invoice_id": _normalize_optional_str(data.get("invoice_id")),
        "customer_id": _normalize_optional_str(data.get("customer_id")),
        "status": _normalize_optional_str(data.get("status")),
        "amount_minor": _normalize_int(data.get("amount"), 0),
        "currency": (_normalize_optional_str(data.get("currency")) or "INR").upper(),
        "method": _normalize_optional_str(data.get("method")),
        "captured": _normalize_bool(data.get("captured")),
        "email": _normalize_optional_str(data.get("email")),
        "contact": _normalize_optional_str(data.get("contact")),
        "notes": _normalize_notes(data.get("notes")),
        "created_at": _normalize_int(data.get("created_at"), 0) or None,
        "raw": data,
    }


def normalize_subscription_response(payload: Any) -> dict[str, Any]:
    data = _as_mapping(payload)
    subscription_id = _normalize_id(data.get("id") or data.get("subscription_id"))
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "subscription",
        "id": subscription_id,
        "subscription_id": subscription_id,
        "plan_id": _normalize_optional_str(data.get("plan_id")),
        "customer_id": _normalize_optional_str(data.get("customer_id")),
        "status": _normalize_optional_str(data.get("status")),
        "total_count": _normalize_int(data.get("total_count"), 0),
        "paid_count": _normalize_int(data.get("paid_count"), 0),
        "remaining_count": _normalize_int(data.get("remaining_count"), 0),
        "quantity": _normalize_int(data.get("quantity"), 0) or None,
        "customer_notify": _normalize_bool(data.get("customer_notify")) if "customer_notify" in data else None,
        "start_at": _normalize_int(data.get("start_at"), 0) or None,
        "charge_at": _normalize_int(data.get("charge_at"), 0) or None,
        "current_start": _normalize_int(data.get("current_start"), 0) or None,
        "current_end": _normalize_int(data.get("current_end"), 0) or None,
        "ended_at": _normalize_int(data.get("ended_at"), 0) or None,
        "offer_id": _normalize_optional_str(data.get("offer_id")),
        "short_url": _normalize_optional_str(data.get("short_url")),
        "notes": _normalize_notes(data.get("notes")),
        "raw": data,
    }


def normalize_invoice_response(payload: Any) -> dict[str, Any]:
    data = _as_mapping(payload)
    invoice_id = _normalize_id(data.get("id") or data.get("invoice_id"))
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "invoice",
        "id": invoice_id,
        "invoice_id": invoice_id,
        "order_id": _normalize_optional_str(data.get("order_id")),
        "payment_id": _normalize_optional_str(data.get("payment_id")),
        "subscription_id": _normalize_optional_str(data.get("subscription_id")),
        "customer_id": _normalize_optional_str(data.get("customer_id")),
        "status": _normalize_optional_str(data.get("status")),
        "amount_minor": _normalize_int(data.get("amount"), 0),
        "amount_paid_minor": _normalize_int(data.get("amount_paid"), 0),
        "amount_due_minor": _normalize_int(data.get("amount_due"), 0),
        "currency": (_normalize_optional_str(data.get("currency")) or "INR").upper(),
        "attempts": _normalize_int(data.get("attempts"), 0),
        "short_url": _normalize_optional_str(data.get("short_url")),
        "description": _normalize_optional_str(data.get("description")),
        "notes": _normalize_notes(data.get("notes")),
        "line_items": list(data.get("line_items")) if isinstance(data.get("line_items"), list) else [],
        "created_at": _normalize_int(data.get("created_at"), 0) or None,
        "issued_at": _normalize_int(data.get("issued_at"), 0) or None,
        "due_at": _normalize_int(data.get("due_at"), 0) or None,
        "paid_at": _normalize_int(data.get("paid_at"), 0) or None,
        "raw": data,
    }


def normalize_webhook_event(payload: Any) -> dict[str, Any]:
    if isinstance(payload, (bytes, bytearray)):
        raw_body = bytes(payload)
        try:
            data = json.loads(raw_body.decode("utf-8"))
        except Exception:
            data = {}
    elif isinstance(payload, str):
        raw_body = payload.encode("utf-8")
        try:
            data = json.loads(payload)
        except Exception:
            data = {}
    else:
        raw_body = b""
        data = _as_mapping(payload)

    payload_map = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    contains = data.get("contains")
    if isinstance(contains, list):
        normalized_contains = [_normalize_str(item) for item in contains if _normalize_str(item)]
    elif contains is None:
        normalized_contains = []
    else:
        normalized_contains = [_normalize_str(contains)] if _normalize_str(contains) else []

    event_id = _normalize_optional_str(data.get("id") or data.get("event_id") or data.get("webhook_event_id"))
    event_type = _normalize_optional_str(data.get("event") or data.get("type"))
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "webhook_event",
        "id": event_id,
        "event_id": event_id,
        "event_type": event_type,
        "entity": _normalize_optional_str(data.get("entity")),
        "account_id": _normalize_optional_str(data.get("account_id") or data.get("account")),
        "contains": normalized_contains,
        "created_at": _normalize_int(data.get("created_at"), 0) or None,
        "payload": payload_map,
        "raw": data,
        "raw_body": raw_body if raw_body else None,
    }


def create_customer(
    name: str,
    email: str,
    contact: str,
    notes: Optional[dict[str, Any]],
    *,
    base_url: str | None,
    auth: Any,
) -> dict[str, Any]:
    payload = {
        key: value
        for key, value in {
            "name": _normalize_optional_str(name),
            "email": _normalize_optional_str(email),
            "contact": _normalize_optional_str(contact),
            "notes": _normalize_notes(notes),
        }.items()
        if value is not None
    }
    response = _request_json("POST", "/customers", base_url=base_url, auth=auth, payload=payload)
    return normalize_customer_response(response)


def fetch_customer(*, customer_id: str, base_url: str | None, auth: Any) -> dict[str, Any]:
    response = _request_json("GET", f"/customers/{_normalize_str(customer_id)}", base_url=base_url, auth=auth)
    return normalize_customer_response(response)


def fetch_payment(*, payment_id: str, base_url: str | None, auth: Any) -> dict[str, Any]:
    response = _request_json("GET", f"/payments/{_normalize_str(payment_id)}", base_url=base_url, auth=auth)
    return normalize_payment_response(response)


def fetch_order(*, order_id: str, base_url: str | None, auth: Any) -> dict[str, Any]:
    response = _request_json("GET", f"/orders/{_normalize_str(order_id)}", base_url=base_url, auth=auth)
    return normalize_order_response(response)


def fetch_subscription(*, subscription_id: str, base_url: str | None, auth: Any) -> dict[str, Any]:
    response = _request_json("GET", f"/subscriptions/{_normalize_str(subscription_id)}", base_url=base_url, auth=auth)
    return normalize_subscription_response(response)


def list_customer_payments(
    customer_id: str,
    *,
    base_url: str | None,
    auth: Any,
    count: int = 10,
) -> dict[str, Any]:
    requested_count = max(1, _normalize_int(count, 10))
    response = _request_json(
        "GET",
        f"/customers/{_normalize_str(customer_id)}/payments",
        base_url=base_url,
        auth=auth,
        params={"count": requested_count},
    )
    items = _normalize_list_items(response.get("items"), normalize_payment_response)
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "payment_list",
        "customer_id": _normalize_optional_str(customer_id),
        "count": len(items),
        "requested_count": requested_count,
        "items": items,
        "raw": response,
    }


def list_customer_subscriptions(
    customer_id: str,
    *,
    base_url: str | None,
    auth: Any,
    count: int = 10,
) -> dict[str, Any]:
    requested_count = max(1, _normalize_int(count, 10))
    response = _request_json(
        "GET",
        "/subscriptions",
        base_url=base_url,
        auth=auth,
        params={"customer_id": _normalize_str(customer_id), "count": requested_count},
    )
    items = _normalize_list_items(response.get("items"), normalize_subscription_response)
    return {
        "provider": RAZORPAY_PROVIDER,
        "resource": "subscription_list",
        "customer_id": _normalize_optional_str(customer_id),
        "count": len(items),
        "requested_count": requested_count,
        "items": items,
        "raw": response,
    }


def create_one_time_order(
    amount_minor: int,
    currency: str,
    receipt: str,
    notes: Optional[dict[str, Any]] = None,
    *,
    base_url: str | None,
    auth: Any,
    payment_capture: bool = True,
) -> dict[str, Any]:
    return create_order(
        amount_minor=amount_minor,
        currency=currency,
        receipt=receipt,
        notes=notes,
        base_url=base_url,
        auth=auth,
        payment_capture=payment_capture,
    )


def create_order(
    *,
    amount_minor: int,
    currency: str,
    receipt: str,
    notes: Optional[dict[str, Any]] = None,
    base_url: str | None,
    auth: Any,
    payment_capture: bool = True,
) -> dict[str, Any]:
    payload = {
        "amount": max(1, _normalize_int(amount_minor, 0)),
        "currency": (_normalize_optional_str(currency) or "INR").upper(),
        "receipt": _normalize_str(receipt),
        "payment_capture": 1 if payment_capture else 0,
        "notes": _normalize_notes(notes),
    }
    response = _request_json("POST", "/orders", base_url=base_url, auth=auth, payload=payload)
    return normalize_order_response(response)


def create_subscription(
    plan: Any,
    customer: Any,
    notes: Optional[dict[str, Any]],
    start_at: Optional[int] = None,
    total_count: Optional[int] = None,
    offer_id: Optional[str] = None,
    *,
    base_url: str | None,
    auth: Any,
) -> dict[str, Any]:
    plan_id = _resolve_plan_id(plan)
    customer_id = _resolve_customer_id(customer)
    payload: dict[str, Any] = {
        "plan_id": plan_id,
        "customer_id": customer_id,
        "customer_notify": 1,
        "quantity": 1,
        "notes": _normalize_notes(notes),
    }
    if start_at is not None:
        payload["start_at"] = max(0, _normalize_int(start_at, 0))
    if total_count is not None:
        payload["total_count"] = max(1, _normalize_int(total_count, 1))
    if offer_id is not None and _normalize_optional_str(offer_id):
        payload["offer_id"] = _normalize_optional_str(offer_id)
    response = _request_json("POST", "/subscriptions", base_url=base_url, auth=auth, payload=payload)
    return normalize_subscription_response(response)


def cancel_subscription(
    subscription_id: str,
    *,
    base_url: str | None,
    auth: Any,
    at_cycle_end: bool = True,
) -> dict[str, Any]:
    payload = {"cancel_at_cycle_end": 1 if at_cycle_end else 0}
    response = _request_json(
        "POST",
        f"/subscriptions/{_normalize_str(subscription_id)}/cancel",
        base_url=base_url,
        auth=auth,
        payload=payload,
    )
    return normalize_subscription_response(response)


def resume_subscription(
    subscription_id: str,
    *,
    base_url: str | None,
    auth: Any,
) -> dict[str, Any]:
    response = _request_json(
        "POST",
        f"/subscriptions/{_normalize_str(subscription_id)}/resume",
        base_url=base_url,
        auth=auth,
    )
    return normalize_subscription_response(response)


def verify_checkout_signature(order_id: str, payment_id: str, signature: str, secret: str) -> bool:
    safe_secret = _normalize_str(secret)
    if not safe_secret:
        return False
    message = f"{_normalize_str(order_id)}|{_normalize_str(payment_id)}".encode("utf-8")
    expected = hmac.new(safe_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, _normalize_str(signature))


def verify_subscription_signature(subscription_id: str, payment_id: str, signature: str, secret: str) -> bool:
    return verify_checkout_signature(subscription_id, payment_id, signature, secret)


def verify_webhook_signature(body_bytes: bytes, signature: str, secret: str) -> bool:
    safe_secret = _normalize_str(secret)
    if not safe_secret:
        return False
    payload = bytes(body_bytes or b"")
    expected = hmac.new(safe_secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, _normalize_str(signature))


def build_checkout_payload(
    *,
    entity_type: str,
    key_id: str,
    amount_minor: int = 0,
    currency: str = "INR",
    order_id: str = "",
    subscription_id: str = "",
    name: str = "",
    description: str = "",
    image: str = "",
    prefill: Optional[dict[str, Any]] = None,
    notes: Optional[dict[str, Any]] = None,
    theme: Optional[dict[str, Any]] = None,
    callback_url: str = "",
    success_url: str = "",
    cancel_url: str = "",
    customer_id: str = "",
) -> dict[str, Any]:
    entity = _normalize_str(entity_type).lower()
    payload: dict[str, Any] = {
        "provider": RAZORPAY_PROVIDER,
        "keyId": _normalize_str(key_id),
        "entityType": entity,
        "amountMinor": _normalize_int(amount_minor, 0),
        "currency": (_normalize_optional_str(currency) or "INR").upper(),
        "orderId": _normalize_optional_str(order_id),
        "subscriptionId": _normalize_optional_str(subscription_id),
        "name": _normalize_str(name),
        "description": _normalize_str(description),
        "image": _normalize_optional_str(image),
        "prefill": dict(prefill or {}),
        "notes": _normalize_notes(notes),
        "theme": dict(theme or {}),
        "callbackUrl": _normalize_optional_str(callback_url),
        "successUrl": _normalize_optional_str(success_url),
        "cancelUrl": _normalize_optional_str(cancel_url),
        "customerId": _normalize_optional_str(customer_id),
    }
    return {key: value for key, value in payload.items() if value not in (None, "", {}, [])}


def checkout_payload_to_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


__all__ = [
    "RAZORPAY_PROVIDER",
    "RAZORPAY_DEFAULT_API_ROOT",
    "RazorpayAuth",
    "RazorpayBillingError",
    "RazorpayAPIError",
    "read_razorpay_auth",
    "create_customer",
    "fetch_customer",
    "create_order",
    "create_one_time_order",
    "fetch_order",
    "create_subscription",
    "fetch_subscription",
    "cancel_subscription",
    "resume_subscription",
    "list_customer_payments",
    "list_customer_subscriptions",
    "fetch_payment",
    "verify_checkout_signature",
    "verify_subscription_signature",
    "verify_webhook_signature",
    "normalize_customer_response",
    "normalize_order_response",
    "normalize_payment_response",
    "normalize_subscription_response",
    "normalize_invoice_response",
    "normalize_webhook_event",
    "build_checkout_payload",
    "checkout_payload_to_json",
]
