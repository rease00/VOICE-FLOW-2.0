from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except Exception:  # pragma: no cover - optional dependency at runtime
    AESGCM = None  # type: ignore[assignment]
    PBKDF2HMAC = None  # type: ignore[assignment]
    hashes = None  # type: ignore[assignment]

# Canonical runtime slots. The codebase now treats these as backend-held
# Vertex/service-account slots rather than user-managed API key pools.
POOL_NAMES: tuple[str, ...] = ("slot_1", "slot_2", "slot_3")
DEFAULT_PLAN_POOLS: dict[str, str] = {
    "free": "slot_1",
    "pro": "slot_2",
    "plus": "slot_3",
}
DEFAULT_FALLBACK_CHAINS: dict[str, list[str]] = {
    "slot_1": ["slot_1"],
    "slot_2": ["slot_2", "slot_1"],
    "slot_3": ["slot_3", "slot_2", "slot_1"],
}
DEFAULT_GLOBAL_FALLBACK_CHAIN: list[str] = ["slot_3", "slot_2", "slot_1"]

SOURCE_POLICY_MODE_API_FILE = "api_file_authoritative"
SOURCE_POLICY_MODE_CONFIG = "config_managed"
SOURCE_POLICY_FAILURE_KEEP_LAST = "keep_last_good"
SOURCE_POLICY_PROVIDER_GEMINI_API = "gemini_api"
SOURCE_POLICY_PROVIDER_VERTEX = "vertex"

_POOL_ID_INVALID_RE = re.compile(r"[^a-z0-9_-]+")
_MAX_POOL_ID_LENGTH = 48
_MASKED_KEY_TOKEN_RE = re.compile(r"^__vf_masked_key__:(?P<fp>[0-9a-f]{12})(?::(?P<hint>[a-z0-9]{0,8}))?$")
_ENCRYPTED_KEY_FILE_FORMAT = "vf_gemini_keys_enc_v1"
_ENCRYPTED_KEY_FILE_AAD = b"vf-gemini-keys-v1"
_ENCRYPTED_KEY_FILE_KDF_ITERATIONS = 390_000
_ENCRYPTED_KEY_FILE_ENV_NAMES: tuple[str, ...] = (
    "GEMINI_KEYS_ENCRYPTION_PASSPHRASE",
    "GEMINI_KEYS_PASSPHRASE",
)


def _normalize_slot_token(value: Any, *, default: str = "") -> str:
    token = re.sub(r"\s+", " ", str(value or "")).strip()
    token = token.replace(" ", "_")
    token = _POOL_ID_INVALID_RE.sub("", token)
    token = token[:_MAX_POOL_ID_LENGTH].strip("_-")
    if not token:
        return str(default or "").strip().lower()
    return token.lower()


def _slot_default_rows() -> list[dict[str, Any]]:
    return [
        {
            "memberId": "slot_1",
            "displayName": "Slot 1",
            "vertexProject": "",
            "vertexLocation": "",
            "vertexServiceAccountRef": "",
            "vertexServiceAccountConfigured": False,
            "serviceAccountEmail": "",
        },
        {
            "memberId": "slot_2",
            "displayName": "Slot 2",
            "vertexProject": "",
            "vertexLocation": "",
            "vertexServiceAccountRef": "",
            "vertexServiceAccountConfigured": False,
            "serviceAccountEmail": "",
        },
        {
            "memberId": "slot_3",
            "displayName": "Slot 3",
            "vertexProject": "",
            "vertexLocation": "",
            "vertexServiceAccountRef": "",
            "vertexServiceAccountConfigured": False,
            "serviceAccountEmail": "",
        },
    ]


def _normalize_vertex_account(raw: Any, *, index: int = 0) -> dict[str, Any]:
    source = dict(raw) if isinstance(raw, dict) else {}
    member_id = _normalize_slot_token(
        source.get("memberId") or source.get("slotId") or source.get("id") or f"slot_{index + 1}",
        default=f"slot_{index + 1}",
    )
    display_name = str(source.get("displayName") or source.get("name") or f"Slot {index + 1}").strip() or f"Slot {index + 1}"
    vertex_project = str(source.get("vertexProject") or source.get("projectId") or "").strip()
    vertex_location = str(source.get("vertexLocation") or source.get("location") or "").strip()
    service_account_ref = str(
        source.get("vertexServiceAccountRef")
        or source.get("serviceAccountRef")
        or source.get("credentialRef")
        or ""
    ).strip()
    service_account_email = str(
        source.get("serviceAccountEmail")
        or source.get("vertexServiceAccountEmail")
        or source.get("email")
        or ""
    ).strip()
    return {
        "memberId": member_id,
        "displayName": display_name,
        "vertexProject": vertex_project,
        "vertexLocation": vertex_location,
        "vertexServiceAccountRef": service_account_ref,
        "vertexServiceAccountConfigured": bool(service_account_ref),
        "serviceAccountEmail": service_account_email,
    }


def _vertex_accounts_from_source(source: dict[str, Any]) -> list[dict[str, Any]]:
    source_policy = source.get("sourcePolicy") if isinstance(source.get("sourcePolicy"), dict) else {}
    raw_accounts = []
    if isinstance(source_policy.get("vertexAccounts"), list):
        raw_accounts = list(source_policy.get("vertexAccounts") or [])
    elif isinstance(source.get("vertexAccounts"), list):
        raw_accounts = list(source.get("vertexAccounts") or [])

    normalized_accounts = [
        _normalize_vertex_account(item, index=index)
        for index, item in enumerate(raw_accounts)
        if isinstance(item, dict)
    ]
    if normalized_accounts:
        return normalized_accounts

    return _slot_default_rows()


def _vertex_slot_lookup_tokens(slot: dict[str, Any]) -> set[str]:
    tokens = {
        _normalize_slot_token(slot.get("memberId") or ""),
        _normalize_slot_token(slot.get("displayName") or ""),
        _normalize_slot_token(slot.get("vertexProject") or ""),
        _normalize_slot_token(slot.get("vertexLocation") or ""),
        _normalize_slot_token(slot.get("serviceAccountEmail") or ""),
        _normalize_slot_token(slot.get("vertexServiceAccountRef") or ""),
    }
    return {token for token in tokens if token}


def _normalize_vertex_source_policy(raw: Any) -> dict[str, Any]:
    values = dict(raw) if isinstance(raw, dict) else {}
    accounts = _vertex_accounts_from_source({"sourcePolicy": values})
    provider = str(values.get("provider") or SOURCE_POLICY_PROVIDER_VERTEX).strip().lower()
    if provider not in {SOURCE_POLICY_PROVIDER_GEMINI_API, SOURCE_POLICY_PROVIDER_VERTEX}:
        provider = SOURCE_POLICY_PROVIDER_VERTEX
    vertex_pool_strategy = str(values.get("vertexPoolStrategy") or "round_robin_health").strip().lower() or "round_robin_health"
    selected_region = str(values.get("selectedRegion") or "").strip()
    vertex_project = str(values.get("vertexProject") or accounts[0].get("vertexProject") or "").strip()
    vertex_location = str(values.get("vertexLocation") or accounts[0].get("vertexLocation") or "us-central1").strip() or "us-central1"
    vertex_service_account_ref = str(values.get("vertexServiceAccountRef") or accounts[0].get("vertexServiceAccountRef") or "").strip()
    return {
        "provider": SOURCE_POLICY_PROVIDER_VERTEX if provider != SOURCE_POLICY_PROVIDER_GEMINI_API else provider,
        "vertexPoolStrategy": vertex_pool_strategy,
        "selectedRegion": selected_region,
        "vertexProject": vertex_project,
        "vertexLocation": vertex_location,
        "vertexServiceAccountRef": vertex_service_account_ref,
        "vertexAccounts": accounts,
        "vertexAccountCount": len(accounts),
        "vertexServiceAccountConfigured": bool(vertex_service_account_ref),
    }


def _derive_encrypted_key_file_key(*, passphrase: str, salt: bytes, iterations: int) -> bytes:
    if AESGCM is None or PBKDF2HMAC is None or hashes is None:
        raise RuntimeError("cryptography dependency is required for encrypted Gemini key files.")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=max(100_000, int(iterations or _ENCRYPTED_KEY_FILE_KDF_ITERATIONS)),
    )
    return kdf.derive(passphrase.encode("utf-8"))


def _resolve_key_file_passphrase(explicit_passphrase: Optional[str] = None) -> str:
    explicit = str(explicit_passphrase or "").strip()
    if explicit:
        return explicit
    for env_name in _ENCRYPTED_KEY_FILE_ENV_NAMES:
        candidate = str(os.getenv(env_name) or "").strip()
        if candidate:
            return candidate
    return ""


def _decode_b64_required(payload: dict[str, Any], field_name: str) -> bytes:
    value = str(payload.get(field_name) or "").strip()
    if not value:
        raise RuntimeError(f"Encrypted Gemini key file is missing '{field_name}'.")
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Encrypted Gemini key file has invalid base64 '{field_name}'.") from exc


def _parse_encrypted_key_file_payload(raw_text: str) -> Optional[dict[str, Any]]:
    text = str(raw_text or "").strip()
    if not text or not text.startswith("{"):
        return None
    try:
        payload = json.loads(text)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if str(payload.get("format") or "").strip() != _ENCRYPTED_KEY_FILE_FORMAT:
        return None
    return payload


def is_encrypted_key_file_text(raw_text: str) -> bool:
    return _parse_encrypted_key_file_payload(raw_text) is not None


def read_key_file_text(path: Path, *, passphrase: Optional[str] = None) -> str:
    raw_text = path.read_text(encoding="utf-8", errors="ignore")
    payload = _parse_encrypted_key_file_payload(raw_text)
    if payload is None:
        return raw_text

    resolved_passphrase = _resolve_key_file_passphrase(passphrase)
    if not resolved_passphrase:
        raise RuntimeError(
            "Encrypted Gemini key file detected but no passphrase configured. "
            "Set GEMINI_KEYS_ENCRYPTION_PASSPHRASE."
        )

    salt = _decode_b64_required(payload, "salt")
    nonce = _decode_b64_required(payload, "nonce")
    ciphertext = _decode_b64_required(payload, "ciphertext")
    iterations = max(
        100_000,
        int(payload.get("iterations") or _ENCRYPTED_KEY_FILE_KDF_ITERATIONS),
    )
    key = _derive_encrypted_key_file_key(
        passphrase=resolved_passphrase,
        salt=salt,
        iterations=iterations,
    )
    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, _ENCRYPTED_KEY_FILE_AAD)  # type: ignore[misc]
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("Failed to decrypt Gemini key file. Check passphrase or file integrity.") from exc
    return plaintext.decode("utf-8", errors="ignore")


def write_key_file_text(
    path: Path,
    raw_text: str,
    *,
    encrypt: bool = False,
    passphrase: Optional[str] = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    next_text = str(raw_text or "")
    if encrypt:
        resolved_passphrase = _resolve_key_file_passphrase(passphrase)
        if not resolved_passphrase:
            raise RuntimeError(
                "Encryption requested for Gemini key file, but no passphrase configured. "
                "Set GEMINI_KEYS_ENCRYPTION_PASSPHRASE."
            )
        salt = os.urandom(16)
        nonce = os.urandom(12)
        key = _derive_encrypted_key_file_key(
            passphrase=resolved_passphrase,
            salt=salt,
            iterations=_ENCRYPTED_KEY_FILE_KDF_ITERATIONS,
        )
        ciphertext = AESGCM(key).encrypt(  # type: ignore[misc]
            nonce,
            next_text.encode("utf-8"),
            _ENCRYPTED_KEY_FILE_AAD,
        )
        payload = {
            "format": _ENCRYPTED_KEY_FILE_FORMAT,
            "cipher": "AES-256-GCM",
            "kdf": "PBKDF2-HMAC-SHA256",
            "iterations": _ENCRYPTED_KEY_FILE_KDF_ITERATIONS,
            "salt": base64.b64encode(salt).decode("ascii"),
            "nonce": base64.b64encode(nonce).decode("ascii"),
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        }
        next_text = json.dumps(payload, ensure_ascii=True, indent=2) + "\n"
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(next_text, encoding="utf-8")
    os.replace(str(tmp_path), str(path))


def _normalize_pool_id(value: Any, *, default: str = "") -> str:
    token = str(value or "").strip().lower()
    if token in {"pro_plus", "pro-plus", "proplus", "plus"}:
        return "slot_3"
    if token == "pro":
        return "slot_2"
    if token == "free":
        return "slot_1"
    if token in {"slot_1", "slot_2", "slot_3"}:
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
    return _normalize_pool_id(value, default="slot_1")


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
        return "slot_3"
    if normalized == "pro":
        return "slot_2"
    return "slot_1"


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
    return "slot_1"


def resolve_plan_pool_hint(config: dict[str, Any], plan_key: Any) -> str:
    normalized_plan = normalize_plan_key(plan_key)
    plan_pools = config.get("planPools") if isinstance(config.get("planPools"), dict) else {}
    raw_mapped = str(plan_pools.get(normalized_plan) or "").strip()
    if raw_mapped:
        raw_token = raw_mapped.lower()
        if raw_token in {"free", "pro", "plus"}:
            return raw_token
    mapped = _normalize_pool_id(raw_mapped, default="")
    if mapped:
        return mapped
    return plan_key_to_pool_hint(normalized_plan)


def list_pool_names(config: dict[str, Any]) -> list[str]:
    source_policy = config.get("sourcePolicy") if isinstance(config.get("sourcePolicy"), dict) else {}
    accounts = _vertex_accounts_from_source({"sourcePolicy": dict(source_policy or {})})
    names = _ordered_unique_pools([account.get("memberId") for account in accounts])
    if names:
        return names
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    fallback = _ordered_unique_pools(list(pools.keys()))
    if fallback:
        return fallback
    return list(POOL_NAMES)


def default_pool_config() -> dict[str, Any]:
    accounts = _slot_default_rows()
    return {
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "sourcePolicy": {
            "ttsModelFallbackEnabled": True,
            "provider": SOURCE_POLICY_PROVIDER_VERTEX,
            "vertexPoolStrategy": "round_robin_health",
            "selectedRegion": "",
            "vertexProject": "",
            "vertexLocation": "us-central1",
            "vertexServiceAccountRef": "",
            "vertexAccounts": accounts,
            "vertexAccountCount": len(accounts),
            "vertexServiceAccountConfigured": False,
        },
        "planPools": dict(DEFAULT_PLAN_POOLS),
        "defaultFallbackChain": list(DEFAULT_GLOBAL_FALLBACK_CHAIN),
        "constraints": {
            "uniqueKeyMembership": True,
        },
        "pools": {},
        "fallbackChains": {},
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
        if not key or _MASKED_KEY_TOKEN_RE.match(key) or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _mask_key_for_storage(value: str) -> tuple[str, dict[str, str]]:
    token = str(value or "").strip()
    if not token:
        return "", {"fingerprint": "", "masked": ""}
    fingerprint = hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()[:12]
    suffix = re.sub(r"[^a-z0-9]", "", token[-4:].lower())[:8]
    placeholder = f"__vf_masked_key__:{fingerprint}"
    if suffix:
        placeholder = f"{placeholder}:{suffix}"
    masked = f"{token[:4]}...{token[-4:]}" if len(token) >= 8 else ("*" * len(token))
    return placeholder, {"fingerprint": fingerprint, "masked": masked}


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
        provider = SOURCE_POLICY_PROVIDER_VERTEX
    mode = str(values.get("freePoolMode") or SOURCE_POLICY_MODE_CONFIG).strip().lower()
    if mode not in {SOURCE_POLICY_MODE_API_FILE, SOURCE_POLICY_MODE_CONFIG}:
        mode = SOURCE_POLICY_MODE_CONFIG
    failure_mode = str(values.get("failureMode") or SOURCE_POLICY_FAILURE_KEEP_LAST).strip().lower()
    if failure_mode != SOURCE_POLICY_FAILURE_KEEP_LAST:
        failure_mode = SOURCE_POLICY_FAILURE_KEEP_LAST
    accounts = _vertex_accounts_from_source({"sourcePolicy": values})
    selected_region = str(values.get("selectedRegion") or "").strip()
    vertex_pool_strategy = str(values.get("vertexPoolStrategy") or "round_robin_health").strip().lower() or "round_robin_health"
    vertex_project = str(values.get("vertexProject") or "").strip()
    vertex_location = str(values.get("vertexLocation") or "us-central1").strip() or "us-central1"
    vertex_service_account_ref = str(values.get("vertexServiceAccountRef") or "").strip()
    return {
        "provider": SOURCE_POLICY_PROVIDER_VERTEX if provider != SOURCE_POLICY_PROVIDER_GEMINI_API else provider,
        "freePoolMode": mode,
        "freePoolFilePath": str(values.get("freePoolFilePath") or "").strip(),
        "freePoolLocked": bool(values.get("freePoolLocked", False)),
        "ttsModelFallbackEnabled": bool(values.get("ttsModelFallbackEnabled", True)),
        "failureMode": failure_mode,
        "lastSyncAt": str(values.get("lastSyncAt") or "").strip(),
        "lastSyncStatus": str(values.get("lastSyncStatus") or "uninitialized").strip() or "uninitialized",
        "lastSyncHash": str(values.get("lastSyncHash") or "").strip(),
        "fileKeyCount": max(0, int(values.get("fileKeyCount") or 0)),
        "selectedRegion": selected_region,
        "vertexPoolStrategy": vertex_pool_strategy,
        "vertexProject": vertex_project,
        "vertexLocation": vertex_location,
        "vertexServiceAccountRef": vertex_service_account_ref,
        "vertexAccounts": accounts,
        "vertexAccountCount": len(accounts),
        "vertexServiceAccountConfigured": bool(vertex_service_account_ref or any(str(item.get("vertexServiceAccountRef") or "").strip() for item in accounts)),
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

    # Legacy config often used the most expensive slot chain as the global fallback signal.
    if isinstance(source_chains.get("slot_3"), list):
        chain = _ordered_unique_pools(list(source_chains.get("slot_3") or []))
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
    source_constraints = source.get("constraints") if isinstance(source.get("constraints"), dict) else {}
    source_policy = source.get("sourcePolicy") if isinstance(source.get("sourcePolicy"), dict) else {}
    accounts = _vertex_accounts_from_source(source)
    source_policy_normalized = _normalize_vertex_source_policy(source_policy or defaults.get("sourcePolicy"))
    plan_pools = _normalize_plan_pools(source.get("planPools") or defaults.get("planPools"))
    default_fallback_chain = _ordered_unique_pools(list(source.get("defaultFallbackChain") or []))
    if not default_fallback_chain:
        default_fallback_chain = list(DEFAULT_GLOBAL_FALLBACK_CHAIN)

    normalized = {
        "version": max(1, int(source.get("version") or defaults["version"])),
        "updatedAt": str(source.get("updatedAt") or defaults["updatedAt"]),
        "pools": {},
        "fallbackChains": {},
        "planPools": plan_pools,
        "defaultFallbackChain": default_fallback_chain,
        "constraints": {
            "uniqueKeyMembership": bool(source_constraints.get("uniqueKeyMembership", True)),
        },
        "sourcePolicy": {
            **source_policy_normalized,
            "vertexAccounts": accounts,
            "vertexAccountCount": len(accounts),
            "vertexServiceAccountConfigured": bool(
                str(source_policy_normalized.get("vertexServiceAccountRef") or "").strip()
                or any(str(account.get("vertexServiceAccountRef") or "").strip() for account in accounts)
            ),
        },
    }
    return normalized


def duplicate_key_memberships(config: dict[str, Any]) -> dict[str, list[str]]:
    accounts = _vertex_accounts_from_source(config)
    key_memberships: dict[str, list[str]] = {}
    for account in accounts:
        slot_id = str(account.get("memberId") or "").strip()
        if not slot_id:
            continue
        for token in _vertex_slot_lookup_tokens(account):
            key_memberships.setdefault(token, []).append(slot_id)
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
        f"Vertex slot metadata appears in multiple slots: token={key[:12]}..., slots={','.join(pools)}"
    )


def flatten_pool_keys(config: dict[str, Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for account in _vertex_accounts_from_source(config):
        slot_id = str(account.get("memberId") or "").strip()
        if not slot_id or slot_id in seen:
            continue
        seen.add(slot_id)
        out.append(slot_id)
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
    chain = resolve_pool_chain(config, pool_hint)
    out: list[str] = []
    seen: set[str] = set()
    for pool_name in chain:
        if pool_name in seen:
            continue
        seen.add(pool_name)
        out.append(pool_name)
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
    source_policy = _normalize_source_policy(normalized.get("sourcePolicy"))
    if str(source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower() == SOURCE_POLICY_PROVIDER_VERTEX:
        return normalized, False, []

    # Legacy compatibility path. The repo no longer manages an API-key file
    # at runtime, but we keep the function callable for old tests.
    warnings: list[str] = []
    changed = False
    next_policy = dict(source_policy)
    next_policy["freePoolMode"] = SOURCE_POLICY_MODE_CONFIG
    next_policy["freePoolLocked"] = False
    if next_policy != source_policy:
        normalized["sourcePolicy"] = next_policy
        changed = True
    return normalized, changed, warnings


def overlay_cached_authoritative_free_pool(
    config: dict[str, Any],
    *,
    cached_config: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    normalized = normalize_pool_config(config)
    if not isinstance(cached_config, dict):
        return normalized
    return normalized


def scrub_pool_config_for_file(config: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_pool_config(config)
    source_policy = _normalize_source_policy(normalized.get("sourcePolicy"))
    provider = str(source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower()
    scrubbed = dict(normalized)
    source = dict(scrubbed.get("sourcePolicy") or {})
    source.pop("vertexServiceAccountJson", None)
    source.pop("serviceAccountJson", None)
    source.pop("vertexAccessToken", None)
    source.pop("accessToken", None)
    source.pop("vertexApiKey", None)
    scrubbed["sourcePolicy"] = source
    return scrubbed


def _read_json_file(path: Path) -> Optional[dict[str, Any]]:
    try:
        if not path.exists() or not path.is_file():
            return None
        payload = json.loads(path.read_text(encoding="utf-8-sig", errors="ignore"))
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

    _write_json_file(file_path, scrub_pool_config_for_file(normalized))
    return normalized
