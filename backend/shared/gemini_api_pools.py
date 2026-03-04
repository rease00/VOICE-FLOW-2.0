from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Legacy canonical pool names retained for backward compatibility and migration defaults.
POOL_NAMES: tuple[str, ...] = ("free", "pro", "pro_plus")
DEFAULT_PLAN_POOLS: dict[str, str] = {
    "free": "free",
    "pro": "pro",
    "plus": "pro_plus",
}
DEFAULT_FALLBACK_CHAINS: dict[str, list[str]] = {
    "free": ["free"],
    "pro": ["pro", "free"],
    "pro_plus": ["pro_plus", "pro", "free"],
}
DEFAULT_GLOBAL_FALLBACK_CHAIN: list[str] = ["pro_plus", "pro", "free"]

SOURCE_POLICY_MODE_API_FILE = "api_file_authoritative"
SOURCE_POLICY_MODE_CONFIG = "config_managed"
SOURCE_POLICY_FAILURE_KEEP_LAST = "keep_last_good"
SOURCE_POLICY_PROVIDER_GEMINI_API = "gemini_api"
SOURCE_POLICY_PROVIDER_VERTEX = "vertex"

_POOL_ID_INVALID_RE = re.compile(r"[^a-z0-9_-]+")
_MAX_POOL_ID_LENGTH = 48


def _normalize_pool_id(value: Any, *, default: str = "") -> str:
    token = str(value or "").strip().lower()
    if token in {"pro_plus", "pro-plus", "proplus", "plus"}:
        return "pro_plus"
    if token in {"pro", "free"}:
        return token
    if not token:
        return str(default or "").strip().lower()
    token = token.replace(" ", "_")
    token = _POOL_ID_INVALID_RE.sub("", token)
    token = token[:_MAX_POOL_ID_LENGTH].strip("_-")
    if not token:
        return str(default or "").strip().lower()
    return token


def _ordered_unique_pools(values: list[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        pool_name = _normalize_pool_id(item, default="")
        if not pool_name or pool_name in seen:
            continue
        seen.add(pool_name)
        out.append(pool_name)
    return out


def normalize_pool_name(value: Any) -> str:
    return _normalize_pool_id(value, default="free")


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


def resolve_default_pool_hint(config: dict[str, Any]) -> str:
    plan_pools = config.get("planPools") if isinstance(config.get("planPools"), dict) else {}
    mapped_plus = _normalize_pool_id(plan_pools.get("plus"), default="")
    if mapped_plus:
        return mapped_plus
    default_chain = _ordered_unique_pools(list(config.get("defaultFallbackChain") or []))
    if default_chain:
        return default_chain[0]
    pool_names = list_pool_names(config)
    if pool_names:
        return pool_names[0]
    return "free"


def resolve_plan_pool_hint(config: dict[str, Any], plan_key: Any) -> str:
    normalized_plan = normalize_plan_key(plan_key)
    plan_pools = config.get("planPools") if isinstance(config.get("planPools"), dict) else {}
    mapped = _normalize_pool_id(plan_pools.get(normalized_plan), default="")
    if mapped:
        return mapped
    return plan_key_to_pool_hint(normalized_plan)


def list_pool_names(config: dict[str, Any]) -> list[str]:
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    return _ordered_unique_pools(list(pools.keys()))


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
        "planPools": {
            "free": "free",
            "pro": "pro",
            "plus": "pro_plus",
        },
        "defaultFallbackChain": ["pro_plus", "pro", "free"],
        "constraints": {
            "uniqueKeyMembership": True,
        },
        "sourcePolicy": {
            "provider": SOURCE_POLICY_PROVIDER_GEMINI_API,
            "freePoolMode": SOURCE_POLICY_MODE_CONFIG,
            "freePoolFilePath": "",
            "freePoolLocked": False,
            "failureMode": SOURCE_POLICY_FAILURE_KEEP_LAST,
            "lastSyncAt": "",
            "lastSyncStatus": "uninitialized",
            "lastSyncHash": "",
            "fileKeyCount": 0,
            "vertexProject": "",
            "vertexLocation": "",
            "vertexServiceAccountRef": "",
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


def _default_fallback_chain_for(pool_name: str, default_fallback_chain: list[str]) -> list[str]:
    if pool_name in DEFAULT_FALLBACK_CHAINS:
        return list(DEFAULT_FALLBACK_CHAINS[pool_name])
    return [pool_name, *[item for item in default_fallback_chain if item != pool_name]]


def _normalize_fallback_chain(
    raw: Any,
    *,
    default_name: str,
    default_fallback_chain: list[str],
) -> list[str]:
    values = _ordered_unique_pools(list(raw or [])) if isinstance(raw, list) else []
    if not values:
        values = _default_fallback_chain_for(default_name, default_fallback_chain)
    if default_name:
        values = [default_name, *[item for item in values if item != default_name]]
    return _ordered_unique_pools(values)


def _normalize_source_policy(raw: Any) -> dict[str, Any]:
    values = dict(raw) if isinstance(raw, dict) else {}
    provider = str(values.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower()
    if provider not in {SOURCE_POLICY_PROVIDER_GEMINI_API, SOURCE_POLICY_PROVIDER_VERTEX}:
        provider = SOURCE_POLICY_PROVIDER_GEMINI_API
    mode = str(values.get("freePoolMode") or SOURCE_POLICY_MODE_CONFIG).strip().lower()
    if mode not in {SOURCE_POLICY_MODE_API_FILE, SOURCE_POLICY_MODE_CONFIG}:
        mode = SOURCE_POLICY_MODE_CONFIG
    failure_mode = str(values.get("failureMode") or SOURCE_POLICY_FAILURE_KEEP_LAST).strip().lower()
    if failure_mode != SOURCE_POLICY_FAILURE_KEEP_LAST:
        failure_mode = SOURCE_POLICY_FAILURE_KEEP_LAST
    return {
        "provider": provider,
        "freePoolMode": mode,
        "freePoolFilePath": str(values.get("freePoolFilePath") or "").strip(),
        "freePoolLocked": bool(values.get("freePoolLocked", False)),
        "failureMode": failure_mode,
        "lastSyncAt": str(values.get("lastSyncAt") or "").strip(),
        "lastSyncStatus": str(values.get("lastSyncStatus") or "uninitialized").strip() or "uninitialized",
        "lastSyncHash": str(values.get("lastSyncHash") or "").strip(),
        "fileKeyCount": max(0, int(values.get("fileKeyCount") or 0)),
        "vertexProject": str(values.get("vertexProject") or "").strip(),
        "vertexLocation": str(values.get("vertexLocation") or "").strip(),
        "vertexServiceAccountRef": str(values.get("vertexServiceAccountRef") or "").strip(),
    }


def _derive_default_fallback_chain(
    source_default_chain: Any,
    source_chains: dict[str, Any],
    pool_names: list[str],
) -> list[str]:
    if isinstance(source_default_chain, list):
        chain = _ordered_unique_pools(source_default_chain)
        if chain:
            return chain

    # Legacy config often used the pro_plus chain as global fallback signal.
    if isinstance(source_chains.get("pro_plus"), list):
        chain = _ordered_unique_pools(list(source_chains.get("pro_plus") or []))
        if chain:
            return chain

    preferred: list[str] = []
    for candidate in DEFAULT_GLOBAL_FALLBACK_CHAIN:
        if candidate in pool_names:
            preferred.append(candidate)
    if preferred:
        return preferred
    return _ordered_unique_pools(pool_names)


def _normalize_plan_pools(raw: Any) -> dict[str, str]:
    values = dict(raw) if isinstance(raw, dict) else {}
    out: dict[str, str] = {}
    for plan_key, default_pool in DEFAULT_PLAN_POOLS.items():
        mapped = _normalize_pool_id(values.get(plan_key), default="")
        out[plan_key] = mapped or default_pool
    return out


def normalize_pool_config(raw: Any) -> dict[str, Any]:
    defaults = default_pool_config()
    source = dict(raw) if isinstance(raw, dict) else {}
    source_pools = source.get("pools") if isinstance(source.get("pools"), dict) else {}
    source_chains = source.get("fallbackChains") if isinstance(source.get("fallbackChains"), dict) else {}
    source_constraints = source.get("constraints") if isinstance(source.get("constraints"), dict) else {}
    source_policy = source.get("sourcePolicy") if isinstance(source.get("sourcePolicy"), dict) else {}

    has_explicit_pools = "pools" in source and isinstance(source.get("pools"), dict)
    pool_names = _ordered_unique_pools(list(source_pools.keys()))
    if not has_explicit_pools:
        pool_names = list(defaults["pools"].keys())

    pools: dict[str, dict[str, list[str]]] = {}
    for pool_name in pool_names:
        pools[pool_name] = {"keys": _normalize_key_list(source_pools.get(pool_name))}

    default_fallback_chain = _derive_default_fallback_chain(
        source.get("defaultFallbackChain"),
        source_chains,
        pool_names,
    )

    fallback_chains: dict[str, list[str]] = {}
    for pool_name in pool_names:
        fallback_chains[pool_name] = _normalize_fallback_chain(
            source_chains.get(pool_name),
            default_name=pool_name,
            default_fallback_chain=default_fallback_chain,
        )

    normalized = {
        "version": max(1, int(source.get("version") or defaults["version"])),
        "updatedAt": str(source.get("updatedAt") or defaults["updatedAt"]),
        "pools": pools,
        "fallbackChains": fallback_chains,
        "planPools": _normalize_plan_pools(source.get("planPools") or defaults.get("planPools")),
        "defaultFallbackChain": list(default_fallback_chain),
        "constraints": {
            "uniqueKeyMembership": bool(source_constraints.get("uniqueKeyMembership", True)),
        },
        "sourcePolicy": _normalize_source_policy(source_policy or defaults.get("sourcePolicy")),
    }
    return normalized


def duplicate_key_memberships(config: dict[str, Any]) -> dict[str, list[str]]:
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    key_memberships: dict[str, list[str]] = {}
    for pool_name in list_pool_names(config):
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
    for pool_name in list_pool_names(config):
        for key in _normalize_key_list((pools.get(pool_name) or {}).get("keys")):
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


def resolve_pool_chain(config: dict[str, Any], pool_hint: Any) -> list[str]:
    normalized_hint = _normalize_pool_id(pool_hint, default="")
    fallback_chains = (
        config.get("fallbackChains")
        if isinstance(config.get("fallbackChains"), dict)
        else {}
    )
    default_fallback_chain = _ordered_unique_pools(list(config.get("defaultFallbackChain") or []))
    if not default_fallback_chain:
        default_fallback_chain = _derive_default_fallback_chain(None, fallback_chains, list_pool_names(config))

    if not normalized_hint:
        normalized_hint = resolve_default_pool_hint(config)

    raw_chain = fallback_chains.get(normalized_hint)
    if isinstance(raw_chain, list):
        chain = _normalize_fallback_chain(
            raw_chain,
            default_name=normalized_hint,
            default_fallback_chain=default_fallback_chain,
        )
    else:
        # Missing/mismatched mapped pool: route through global default fallback chain.
        chain = _ordered_unique_pools([normalized_hint, *default_fallback_chain]) if normalized_hint else list(default_fallback_chain)

    if normalized_hint and normalized_hint not in chain:
        chain.insert(0, normalized_hint)
    return _ordered_unique_pools(chain)


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
    if str(source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower() == SOURCE_POLICY_PROVIDER_VERTEX:
        next_policy = dict(source_policy)
        next_policy["freePoolMode"] = SOURCE_POLICY_MODE_CONFIG
        next_policy["freePoolLocked"] = False
        if next_policy != source_policy:
            normalized["sourcePolicy"] = next_policy
            changed = True
        return normalized, changed, warnings

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
            pools.setdefault("free", {"keys": []})
            pools["free"]["keys"] = list(next_file_keys)
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
            if "free" in pools:
                pools["free"]["keys"] = []
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
            pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
            pools.setdefault("free", {"keys": []})
            pools["free"]["keys"] = fallback_keys
            config["pools"] = pools
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
