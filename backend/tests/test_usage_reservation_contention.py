from __future__ import annotations

import pytest
from fastapi import HTTPException

import app as backend_app


class _FakeDocSnapshot:
    def __init__(self, payload: dict | None) -> None:
        self._payload = dict(payload or {})
        self.exists = payload is not None

    def to_dict(self) -> dict:
        return dict(self._payload)


class _FakeDocRef:
    def __init__(self, store: dict[str, dict], doc_id: str) -> None:
        self._store = store
        self._doc_id = doc_id

    def get(self, transaction=None) -> _FakeDocSnapshot:
        _ = transaction
        return _FakeDocSnapshot(self._store.get(self._doc_id))

    def set(self, payload: dict, merge: bool = False) -> None:
        if merge and self._doc_id in self._store:
            merged = dict(self._store.get(self._doc_id) or {})
            merged.update(dict(payload or {}))
            self._store[self._doc_id] = merged
            return
        self._store[self._doc_id] = dict(payload or {})


class _FakeCollection:
    def __init__(self, store: dict[str, dict]) -> None:
        self._store = store

    def document(self, doc_id: str) -> _FakeDocRef:
        return _FakeDocRef(self._store, str(doc_id))


class _FakeTransaction:
    def set(self, doc_ref: _FakeDocRef, payload: dict, merge: bool = False) -> None:
        doc_ref.set(payload, merge=merge)


class _FakeFirestoreDb:
    def __init__(self, initial: dict[str, dict[str, dict]] | None = None) -> None:
        self._collections = dict(initial or {})

    def collection(self, name: str) -> _FakeCollection:
        bucket = self._collections.setdefault(str(name), {})
        return _FakeCollection(bucket)

    def transaction(self) -> _FakeTransaction:
        return _FakeTransaction()


def _configure_firestore_usage_path(monkeypatch: pytest.MonkeyPatch, fake_db: _FakeFirestoreDb) -> None:
    monkeypatch.setattr(backend_app, "_FIRESTORE_DB", fake_db)
    monkeypatch.setattr(backend_app, "_prefer_inmemory_entitlement_store", lambda: False)
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda name: fake_db.collection(str(name)))


def _seed_entitlement(uid: str) -> dict:
    entitlement = backend_app._default_entitlement(uid)
    entitlement["paidVfBalance"] = 1_000.0
    entitlement["vffBalance"] = 0.0
    entitlement["paidVfLots"] = []
    return entitlement


def test_reserve_usage_retries_firestore_contention_and_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = "reservation_retry_user"
    request_id = "reservation_retry_req_01"
    fake_db = _FakeFirestoreDb(
        {
            "entitlements": {
                uid: _seed_entitlement(uid),
            }
        }
    )
    _configure_firestore_usage_path(monkeypatch, fake_db)

    attempt_state = {"count": 0}

    class _TxContentionThenSuccess:
        @staticmethod
        def transactional(func):
            def _wrapped(transaction_obj):
                attempt_state["count"] += 1
                if attempt_state["count"] < 3:
                    raise RuntimeError("Aborted: Too much contention on these documents. Please try again.")
                return func(transaction_obj)

            return _wrapped

    monkeypatch.setattr(backend_app, "firebase_firestore", _TxContentionThenSuccess)

    reserved = backend_app._reserve_usage(uid, request_id, "PRIME", 10)
    assert bool(reserved.get("ok")) is True
    assert bool(reserved.get("alreadyReserved")) is False
    assert attempt_state["count"] == 3


def test_reserve_usage_contention_exhaustion_returns_503_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = "reservation_contention_user"
    request_id = "reservation_contention_req_01"
    fake_db = _FakeFirestoreDb(
        {
            "entitlements": {
                uid: _seed_entitlement(uid),
            }
        }
    )
    _configure_firestore_usage_path(monkeypatch, fake_db)

    class _TxAlwaysContention:
        @staticmethod
        def transactional(func):
            _ = func

            def _wrapped(_transaction_obj):
                raise RuntimeError("Aborted: Too much contention on these documents. Please try again.")

            return _wrapped

    monkeypatch.setattr(backend_app, "firebase_firestore", _TxAlwaysContention)

    with pytest.raises(HTTPException) as exc_info:
        backend_app._reserve_usage(uid, request_id, "PRIME", 10)
    assert exc_info.value.status_code == 503
    detail = exc_info.value.detail if isinstance(exc_info.value.detail, dict) else {}
    assert str(detail.get("errorCode") or "") == "VF_USAGE_RESERVATION_CONTENTION"
    assert bool(detail.get("retryable")) is True
    assert str((exc_info.value.headers or {}).get("Retry-After") or "") == "1"


def test_reserve_usage_precheck_returns_existing_event_without_transaction(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = "reservation_precheck_user"
    request_id = "reservation_precheck_req_01"
    event_doc_id = f"{uid}_{request_id}"
    now = backend_app._utc_now()
    month_doc_id = backend_app._inmemory_usage_month_doc_id(uid, now)
    day_doc_id = backend_app._inmemory_usage_day_doc_id(uid, now)
    default_monthly, default_daily = backend_app._usage_defaults(uid, now)
    fake_db = _FakeFirestoreDb(
        {
            "entitlements": {
                uid: _seed_entitlement(uid),
            },
            "usage_monthly": {
                month_doc_id: default_monthly,
            },
            "usage_daily": {
                day_doc_id: default_daily,
            },
            "usage_events": {
                event_doc_id: {
                    "uid": uid,
                    "requestId": request_id,
                    "status": "reserved",
                    "engine": "PRIME",
                    "chars": 10,
                    "vfCost": 1.0,
                    "monthDocId": month_doc_id,
                    "dayDocId": day_doc_id,
                }
            },
        }
    )
    _configure_firestore_usage_path(monkeypatch, fake_db)

    class _TxShouldNotRun:
        @staticmethod
        def transactional(func):
            _ = func

            def _wrapped(_transaction_obj):
                raise AssertionError("transaction should not run for prechecked reserved usage events")

            return _wrapped

    monkeypatch.setattr(backend_app, "firebase_firestore", _TxShouldNotRun)

    result = backend_app._reserve_usage(uid, request_id, "PRIME", 10)
    assert bool(result.get("ok")) is True
    assert bool(result.get("alreadyReserved")) is True
