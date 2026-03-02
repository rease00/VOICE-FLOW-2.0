from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

POOL_NAMES: tuple[str, ...] = ("free", "pro", "pro_plus")
DEFAULT_FALLBACK_CHAINS: dict[str, list[str]] = {
    "free": ["free"],
    "pro": ["pro", "free"],
    "pro_plus": ["pro_plus", "pro", "free"],
}
SOURCE_POLICY_MODE_API_FILE = "api_file_authoritative"
SOURCE_POLICY_MODE_CONFIG = "config_managed"
SOURCE_POLICY_FAILURE_KEEP_LAST = "keep_last_good"


def normalize_pool_name(value: Any) -> str:
    token = str(value or "").strip().lower()
    if token in {"pro_plus", "pro-plus", "proplus", "plus"}:
        return "pro_plus"
    if token in {"pro", "free"}:
        return token
    return "free"


def normalize_plan_key(value: Any) -> str:
    token = str(value or "").strip().lower()
    if token in {"pro_plus", "pro-plus", "proplus", "plus"}:
        return "plus"
    if token in {"pro", "free"}:
        return token
    return "free"


def plan_key_to_pool_hint(plan_key: Any) -> str:
    normalized = normalize_plan_key(plan_key)
    if normalized == "plus":
        return "pro_plus"
    return normalized


def default_pool_config() -> dict[str, Any]:
    return {
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "pools": {
            "free": {"keys": []},
            "pro": {"keys": []},
            "pro_plus": {"keys": []},
        },
        "fallbackChains": {
            "free": ["free"],
            "pro": ["pro", "free"],
            "pro_plus": ["pro_plus", "pro", "free"],
        },
        "constraints": {
            "uniqueKeyMembership": True,
        },
        "sourcePolicy": {
            "freePoolMode": SOURCE_POLICY_MODE_CONFIG,
            "freePoolFilePath": "",
            "freePoolLocked": False,
            "failureMode": SOURCE_POLICY_FAILURE_KEEP_LAST,
            "lastSyncAt": "",
            "lastSyncStatus": "uninitialized",
            "lastSyncHash": "",
            "fileKeyCount": 0,
        },
    }


def _normalize_key_list(raw: Any) -> list[str]:
    if isinstance(raw, dict):
        values = raw.get("keys")
    else:
        values = raw
    if not isinstance(values, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _normalize_fallback_chain(raw: Any, *, default_name: str) -> list[str]:
    values = raw if isinstance(raw, list) else []
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        pool = normalize_pool_name(item)
        if pool in seen:
            continue
        seen.add(pool)
        out.append(pool)
    if not out:
        out = list(DEFAULT_FALLBACK_CHAINS.get(default_name) or [default_name])
    if default_name not in out:
        out.insert(0, default_name)
    return out


def _normalize_source_policy(raw: Any) -> dict[str, Any]:
    values = dict(raw) if isinstance(raw, dict) else {}
    mode = str(values.get("freePoolMode") or SOURCE_POLICY_MODE_CONFIG).strip().lower()
    if mode not in {SOURCE_POLICY_MODE_API_FILE, SOURCE_POLICY_MODE_CONFIG}:
        mode = SOURCE_POLICY_MODE_CONFIG
    failure_mode = str(values.get("failureMode") or SOURCE_POLICY_FAILURE_KEEP_LAST).strip().lower()
    if failure_mode != SOURCE_POLICY_FAILURE_KEEP_LAST:
        failure_mode = SOURCE_POLICY_FAILURE_KEEP_LAST
    return {
        "freePoolMode": mode,
        "freePoolFilePath": str(values.get("freePoolFilePath") or "").strip(),
        "freePoolLocked": bool(values.get("freePoolLocked", False)),
        "failureMode": failure_mode,
        "lastSyncAt": str(values.get("lastSyncAt") or "").strip(),
        "lastSyncStatus": str(values.get("lastSyncStatus") or "uninitialized").strip() or "uninitialized",
        "lastSyncHash": str(values.get("lastSyncHash") or "").strip(),
        "fileKeyCount": max(0, int(values.get("fileKeyCount") or 0)),
    }


def normalize_pool_config(raw: Any) -> dict[str, Any]:
    defaults = default_pool_config()
    source = dict(raw) if isinstance(raw, dict) else {}
    source_pools = source.get("pools") if isinstance(source.get("pools"), dict) else {}
    source_chains = source.get("fallbackChains") if isinstance(source.get("fallbackChains"), dict) else {}
    source_constraints = source.get("constraints") if isinstance(source.get("constraints"), dict) else {}
    source_policy = source.get("sourcePolicy") if isinstance(source.get("sourcePolicy"), dict) else {}

    pools: dict[str, dict[str, list[str]]] = {}
    fallback_chains: dict[str, list[str]] = {}
    for pool_name in POOL_NAMES:
        pools[pool_name] = {"keys": _normalize_key_list(source_pools.get(pool_name))}
        fallback_chains[pool_name] = _normalize_fallback_chain(
            source_chains.get(pool_name),
            default_name=pool_name,
        )

    normalized = {
        "version": max(1, int(source.get("version") or defaults["version"])),
        "updatedAt": str(source.get("updatedAt") or defaults["updatedAt"]),
        "pools": pools,
        "fallbackChains": fallback_chains,
        "constraints": {
            "uniqueKeyMembership": bool(source_constraints.get("uniqueKeyMembership", True)),
        },
        "sourcePolicy": _normalize_source_policy(source_policy or defaults.get("sourcePolicy")),
    }
    return normalized


def duplicate_key_memberships(config: dict[str, Any]) -> dict[str, list[str]]:
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    key_memberships: dict[str, list[str]] = {}
    for pool_name in POOL_NAMES:
        keys = _normalize_key_list((pools.get(pool_name) or {}).get("keys"))
        for key in keys:
            key_memberships.setdefault(key, []).append(pool_name)
    duplicates: dict[str, list[str]] = {}
    for key, members in key_memberships.items():
        if len(members) > 1:
            duplicates[key] = members
    return duplicates


def ensure_unique_membership(config: dict[str, Any]) -> None:
    constraints = config.get("constraints") if isinstance(config.get("constraints"), dict) else {}
    if not bool(constraints.get("uniqueKeyMembership", True)):
        return
    duplicates = duplicate_key_memberships(config)
    if not duplicates:
        return
    first = next(iter(duplicates.items()))
    key, pools = first
    raise ValueError(
        f"API key appears in multiple pools: key={key[:12]}..., pools={','.join(pools)}"
    )


def flatten_pool_keys(config: dict[str, Any]) -> list[str]:
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    out: list[str] = []
    seen: set[str] = set()
    for pool_name in POOL_NAMES:
        for key in _normalize_key_list((pools.get(pool_name) or {}).get("keys")):
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


def resolve_pool_chain(config: dict[str, Any], pool_hint: Any) -> list[str]:
    normalized_hint = normalize_pool_name(pool_hint)
    fallback_chains = (
        config.get("fallbackChains")
        if isinstance(config.get("fallbackChains"), dict)
        else {}
    )
    chain = _normalize_fallback_chain(
        fallback_chains.get(normalized_hint),
        default_name=normalized_hint,
    )
    out: list[str] = []
    seen: set[str] = set()
    for pool_name in chain:
        normalized = normalize_pool_name(pool_name)
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    if normalized_hint not in out:
        out.insert(0, normalized_hint)
    return out


def resolve_effective_keys(config: dict[str, Any], pool_hint: Any) -> list[str]:
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    chain = resolve_pool_chain(config, pool_hint)
    out: list[str] = []
    seen: set[str] = set()
    for pool_name in chain:
        keys = _normalize_key_list((pools.get(pool_name) or {}).get("keys"))
        for key in keys:
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


def _keys_digest(keys: list[str]) -> str:
    payload = "\n".join(str(item or "").strip() for item in keys)
    return hashlib.sha256(payload.encode("utf-8", errors="ignore")).hexdigest()


def sync_authoritative_free_pool(
    config: dict[str, Any],
    file_keys: list[str],
    file_path: str | Path,
    *,
    file_exists: Optional[bool] = None,
    failure_mode: str = SOURCE_POLICY_FAILURE_KEEP_LAST,
) -> tuple[dict[str, Any], bool, list[str]]:
    normalized = normalize_pool_config(config)
    warnings: list[str] = []
    changed = False

    pools = normalized.get("pools") if isinstance(normalized.get("pools"), dict) else {}
    free_pool = pools.get("free") if isinstance(pools.get("free"), dict) else {"keys": []}
    current_free = _normalize_key_list(free_pool.get("keys"))
    next_file_keys = _normalize_key_list(file_keys)

    source_policy = _normalize_source_policy(normalized.get("sourcePolicy"))
    next_policy = dict(source_policy)
    next_policy["freePoolMode"] = SOURCE_POLICY_MODE_API_FILE
    next_policy["freePoolFilePath"] = str(file_path or "").strip()
    next_policy["freePoolLocked"] = True
    next_policy["failureMode"] = SOURCE_POLICY_FAILURE_KEEP_LAST

    has_valid_file_keys = bool(next_file_keys)
    should_keep_last = (
        str(failure_mode or SOURCE_POLICY_FAILURE_KEEP_LAST).strip().lower()
        == SOURCE_POLICY_FAILURE_KEEP_LAST
    )
    if has_valid_file_keys:
        file_hash = _keys_digest(next_file_keys)
        if current_free != next_file_keys:
            free_pool["keys"] = list(next_file_keys)
            changed = True
        if (
            next_policy.get("lastSyncHash") != file_hash
            or int(next_policy.get("fileKeyCount") or 0) != len(next_file_keys)
            or str(next_policy.get("lastSyncStatus") or "").strip().lower() != "success"
        ):
            next_policy["lastSyncAt"] = datetime.now(timezone.utc).isoformat()
            next_policy["lastSyncStatus"] = "success"
            next_policy["lastSyncHash"] = file_hash
            next_policy["fileKeyCount"] = len(next_file_keys)
    else:
        missing_file = file_exists is False
        warning = (
            "Authoritative free-pool key file is missing; keeping last good free pool."
            if missing_file
            else "Authoritative free-pool key file is empty or invalid; keeping last good free pool."
        )
        warnings.append(warning)
        next_policy["fileKeyCount"] = 0
        status_token = "warning_missing_file" if missing_file else "warning_empty_or_invalid"
        if str(next_policy.get("lastSyncStatus") or "").strip().lower() != status_token:
            next_policy["lastSyncAt"] = datetime.now(timezone.utc).isoformat()
            next_policy["lastSyncStatus"] = status_token
        if not should_keep_last and current_free:
            free_pool["keys"] = []
            changed = True
            next_policy["lastSyncHash"] = ""

    if next_policy != source_policy:
        normalized["sourcePolicy"] = next_policy
        changed = True

    return normalized, changed, warnings


def _read_json_file(path: Path) -> Optional[dict[str, Any]]:
    try:
        if not path.exists() or not path.is_file():
            return None
        payload = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


def _write_json_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )


def load_pool_config(
    *,
    file_path: Path,
    firestore_db: Any = None,
    prefer_firestore: bool = True,
    bootstrap_free_keys: Optional[list[str]] = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    source = "default"
    raw_config: Optional[dict[str, Any]] = None
    firestore_error = ""

    if prefer_firestore and firestore_db is not None:
        try:
            doc = firestore_db.collection("gemini_api_pools").document("config").get()
            if bool(getattr(doc, "exists", False)):
                payload = doc.to_dict() or {}
                if isinstance(payload, dict):
                    raw_config = payload
                    source = "firestore"
        except Exception as exc:  # noqa: BLE001
            firestore_error = str(exc)

    if raw_config is None:
        file_payload = _read_json_file(file_path)
        if file_payload is not None:
            raw_config = file_payload
            source = "file"

    config = normalize_pool_config(raw_config or default_pool_config())

    if source in {"default", "file"}:
        fallback_keys = list(bootstrap_free_keys or [])
        if fallback_keys and not flatten_pool_keys(config):
            config["pools"]["free"]["keys"] = fallback_keys
            config["updatedAt"] = datetime.now(timezone.utc).isoformat()
            source = "bootstrap"

    return config, {
        "source": source,
        "filePath": str(file_path),
        "fileExists": bool(file_path.exists() and file_path.is_file()),
        "firestoreError": firestore_error,
    }


def save_pool_config(
    *,
    file_path: Path,
    config: dict[str, Any],
    firestore_db: Any = None,
) -> dict[str, Any]:
    normalized = normalize_pool_config(config)
    normalized["updatedAt"] = datetime.now(timezone.utc).isoformat()
    ensure_unique_membership(normalized)

    if firestore_db is not None:
        firestore_db.collection("gemini_api_pools").document("config").set(
            normalized,
            merge=True,
        )

    _write_json_file(file_path, normalized)
    return normalized
