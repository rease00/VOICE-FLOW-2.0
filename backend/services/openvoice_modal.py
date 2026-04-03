from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import binascii
import json
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Optional

import requests
from pydantic import BaseModel, Field

def _env_first(*names: str) -> str:
    for name in names:
        token = str(os.getenv(name) or "").strip()
        if token:
            return token
    return ""

OPENVOICE_GPU_RATE_PER_SEC_USD = 0.000222
OPENVOICE_DEFAULT_COST_MULTIPLIER = 1.0
OPENVOICE_DEFAULT_TIMEOUT_SEC = max(
    10.0,
    float(
        (
            _env_first(
                "VF_VOICE_CLONE_MODAL_RUNTIME_TIMEOUT_SEC",
                "VF_OPENVOICE_MODAL_RUNTIME_TIMEOUT_SEC",
                "VF_VOICE_CLONE_RUNTIME_TIMEOUT_SEC",
                "VF_OPENVOICE_RUNTIME_TIMEOUT_SEC",
            )
            or "150"
        ).strip()
        or "150"
    ),
)
OPENVOICE_DEFAULT_RUNTIME_URL = _env_first(
    "VF_VOICE_CLONE_MODAL_RUNTIME_URL",
    "VF_OPENVOICE_MODAL_RUNTIME_URL",
    "VF_VOICE_CLONE_RUNTIME_URL",
    "VF_OPENVOICE_RUNTIME_URL",
).rstrip("/")
OPENVOICE_RUNTIME_TOKEN = _env_first(
    "VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN",
    "VF_OPENVOICE_MODAL_RUNTIME_TOKEN",
    "VF_VOICE_CLONE_RUNTIME_TOKEN",
    "VF_OPENVOICE_RUNTIME_TOKEN",
)
OPENVOICE_ARTIFACT_SECRET = _env_first(
    "VF_VOICE_CLONE_ARTIFACT_SECRET",
    "VF_OPENVOICE_ARTIFACT_SECRET",
)
OPENVOICE_DEV_ALLOW_EPHEMERAL_SECRET = str(
    _env_first(
        "VF_VOICE_CLONE_ALLOW_EPHEMERAL_ARTIFACT_SECRET",
        "VF_VOICE_CLONE_ALLOW_EPHEMERAL_SECRET",
        "VF_OPENVOICE_ALLOW_EPHEMERAL_ARTIFACT_SECRET",
        "VF_OPENVOICE_ALLOW_EPHEMERAL_SECRET",
    )
    or ""
).strip().lower() in {"1", "true", "yes", "on"}
OPENVOICE_ARTIFACT_SIGNATURE_VERSION = 1
OPENVOICE_ARTIFACT_SIGNATURE_TTL_SEC = max(
    30,
    int(
        (
            _env_first(
                "VF_VOICE_CLONE_ARTIFACT_SIGNATURE_TTL_SEC",
                "VF_OPENVOICE_ARTIFACT_SIGNATURE_TTL_SEC",
            )
            or "120"
        ).strip()
        or "120"
    ),
)
OPENVOICE_MAX_AUDIO_BYTES = max(
    64_000,
    int(
        (
            _env_first(
                "VF_VOICE_CLONE_MAX_AUDIO_BYTES",
                "VF_OPENVOICE_MAX_AUDIO_BYTES",
            )
            or str(12 * 1024 * 1024)
        ).strip()
        or str(12 * 1024 * 1024)
    ),
)
OPENVOICE_MAX_AUDIO_BASE64_CHARS = max(
    85_000,
    int(
        (
            _env_first(
                "VF_VOICE_CLONE_MAX_AUDIO_BASE64_CHARS",
                "VF_OPENVOICE_MAX_AUDIO_BASE64_CHARS",
            )
            or str(((OPENVOICE_MAX_AUDIO_BYTES * 4) // 3) + 16)
        ).strip()
        or str(((OPENVOICE_MAX_AUDIO_BYTES * 4) // 3) + 16)
    ),
)
OPENVOICE_ARTIFACT_ROOT = Path(
    str(
        _env_first(
            "VF_VOICE_CLONE_ARTIFACT_DIR",
            "VF_OPENVOICE_ARTIFACT_DIR",
        )
        or str(Path(__file__).resolve().parents[1] / "artifacts" / "voice-clone")
    ).strip()
).resolve()
OPENVOICE_ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
OPENVOICE_ARTIFACT_ID_MAX_LEN = 128


class OpenVoiceRuntimeError(RuntimeError):
    pass


def normalize_openvoice_mode(value: object) -> Literal["tts", "vc", "tts_then_vc"]:
    token = str(value or "").strip().lower().replace("-", "_")
    if token in {"vc", "voice_conversion"}:
        return "vc"
    if token in {"tts_then_vc", "tts_vc", "post_tts_vc", "post_tts", "posttts"}:
        return "tts_then_vc"
    return "tts"


def normalize_openvoice_run_kind(value: object) -> Literal["warm", "cold"]:
    token = str(value or "").strip().lower()
    return "cold" if token == "cold" else "warm"


def normalize_openvoice_language(value: object) -> str:
    token = str(value or "").strip().upper()
    return token if token else "EN"


def decode_openvoice_audio_base64(value: object) -> bytes:
    token = str(value or "").strip()
    if not token:
        return b""
    if len(token) > OPENVOICE_MAX_AUDIO_BASE64_CHARS:
        raise ValueError("audio payload exceeds the maximum allowed size.")
    try:
        decoded = base64.b64decode(token.encode("utf-8"), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("audio payload must be valid base64.") from exc
    if len(decoded) > OPENVOICE_MAX_AUDIO_BYTES:
        raise ValueError("audio payload exceeds the maximum allowed size.")
    return decoded


def encode_openvoice_audio_base64(value: bytes) -> str:
    if not value:
        return ""
    return base64.b64encode(bytes(value)).decode("ascii")


def compute_openvoice_gpu_cost_usd(gpu_seconds: float, cost_multiplier: float = OPENVOICE_DEFAULT_COST_MULTIPLIER) -> float:
    seconds = max(0.0, float(gpu_seconds or 0.0))
    multiplier = max(0.0, float(cost_multiplier or 1.0))
    return seconds * OPENVOICE_GPU_RATE_PER_SEC_USD * multiplier


def normalize_openvoice_artifact_id(value: object, *, fallback: str = "") -> str:
    token = str(value or "").strip()
    token = re.sub(r"[^A-Za-z0-9._-]+", "_", token)
    token = token.strip("._-")
    if not token:
        token = str(fallback or "").strip()
    if not token:
        return ""
    return token[:OPENVOICE_ARTIFACT_ID_MAX_LEN]


def _is_openvoice_production() -> bool:
    return str(os.getenv("VF_ENV") or os.getenv("ENV") or "").strip().lower() in {"prod", "production"}


def _resolve_openvoice_artifact_secret(secret: str | None = None) -> str:
    candidate = str(secret or OPENVOICE_ARTIFACT_SECRET or "").strip()
    if candidate:
        return candidate
    if _is_openvoice_production():
        raise RuntimeError(
            "VF_VOICE_CLONE_ARTIFACT_SECRET is required for Voice Clone artifact signing in production."
        )
    if OPENVOICE_DEV_ALLOW_EPHEMERAL_SECRET and OPENVOICE_RUNTIME_TOKEN:
        return OPENVOICE_RUNTIME_TOKEN
    raise RuntimeError(
        "VF_VOICE_CLONE_ARTIFACT_SECRET is required for Voice Clone artifact signing."
    )


def _openvoice_uid_prefix(uid: object) -> str:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return ""
    return hashlib.sha256(safe_uid.encode("utf-8")).hexdigest()[:12]


def _extract_openvoice_artifact_uid_prefix(artifact_id: str) -> str:
    match = re.match(r"^([0-9a-f]{12})_", str(artifact_id or "").strip().lower())
    return str(match.group(1) or "") if match else ""


def _openvoice_base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(bytes(raw)).decode("ascii").rstrip("=")


def _openvoice_base64url_decode(token: str) -> bytes:
    safe_token = str(token or "").strip()
    if not safe_token:
        return b""
    padding = "=" * (-len(safe_token) % 4)
    return base64.urlsafe_b64decode((safe_token + padding).encode("ascii"))


def extract_openvoice_artifact_signature_payload(signature: str) -> dict[str, Any] | None:
    safe_signature = str(signature or "").strip()
    payload_token, separator, signature_token = safe_signature.partition(".")
    if not payload_token or separator != "." or not signature_token:
        return None
    try:
        payload_raw = _openvoice_base64url_decode(payload_token)
        payload = json.loads(payload_raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def build_openvoice_artifact_signature(
    artifact_id: str,
    secret: str | None = None,
    *,
    uid: str | None = None,
    exp: int | None = None,
    ttl_sec: int | None = None,
    jti: str | None = None,
) -> str:
    safe_artifact_id = normalize_openvoice_artifact_id(artifact_id)
    if not safe_artifact_id:
        raise ValueError("artifact_id is required.")
    safe_secret = _resolve_openvoice_artifact_secret(secret)
    safe_uid = str(uid or "").strip()
    ttl_seconds = max(30, int(ttl_sec or OPENVOICE_ARTIFACT_SIGNATURE_TTL_SEC))
    exp_unix = int(exp) if exp is not None else int(time.time()) + ttl_seconds
    if exp_unix <= 0:
        raise ValueError("exp must be a positive unix timestamp.")

    payload_data: dict[str, Any] = {
        "v": OPENVOICE_ARTIFACT_SIGNATURE_VERSION,
        "aid": safe_artifact_id,
        "exp": exp_unix,
        "jti": str(jti or "").strip()[:64] or secrets.token_urlsafe(12),
    }
    if safe_uid:
        payload_data["uid"] = safe_uid
    payload_raw = json.dumps(payload_data, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_token = _openvoice_base64url_encode(payload_raw)
    payload_to_sign = f"ovsig.{payload_token}".encode("ascii")
    signature_raw = hmac.new(
        safe_secret.encode("utf-8"),
        payload_to_sign,
        hashlib.sha256,
    ).digest()
    signature_token = _openvoice_base64url_encode(signature_raw)
    return f"{payload_token}.{signature_token}"


def verify_openvoice_artifact_signature(
    artifact_id: str,
    signature: str,
    secret: str | None = None,
    *,
    uid: str | None = None,
    now_ts: int | None = None,
) -> bool:
    safe_artifact_id = normalize_openvoice_artifact_id(artifact_id)
    safe_signature = str(signature or "").strip()
    if not safe_artifact_id or not safe_signature:
        return False
    payload_token, separator, signature_token = safe_signature.partition(".")
    if not payload_token or separator != "." or not signature_token:
        return False

    safe_secret = _resolve_openvoice_artifact_secret(secret)
    expected_signature_raw = hmac.new(
        safe_secret.encode("utf-8"),
        f"ovsig.{payload_token}".encode("ascii"),
        hashlib.sha256,
    ).digest()
    expected_signature_token = _openvoice_base64url_encode(expected_signature_raw)
    if not hmac.compare_digest(expected_signature_token, signature_token):
        return False

    payload = extract_openvoice_artifact_signature_payload(safe_signature)
    if not isinstance(payload, dict):
        return False

    payload_version = int(payload.get("v") or 0)
    if payload_version != OPENVOICE_ARTIFACT_SIGNATURE_VERSION:
        return False
    payload_artifact_id = normalize_openvoice_artifact_id(payload.get("aid") or "")
    if payload_artifact_id != safe_artifact_id:
        return False

    current_unix = int(time.time()) if now_ts is None else int(now_ts)
    payload_exp = int(payload.get("exp") or 0)
    if payload_exp <= current_unix:
        return False

    expected_uid = str(uid or "").strip()
    payload_uid = str(payload.get("uid") or "").strip()
    if expected_uid and not payload_uid:
        return False
    if expected_uid and payload_uid and not hmac.compare_digest(expected_uid, payload_uid):
        return False
    if payload_uid:
        artifact_prefix = _extract_openvoice_artifact_uid_prefix(safe_artifact_id)
        expected_prefix = _openvoice_uid_prefix(payload_uid)
        if artifact_prefix and not hmac.compare_digest(artifact_prefix, expected_prefix):
            return False
    if expected_uid:
        artifact_prefix = _extract_openvoice_artifact_uid_prefix(safe_artifact_id)
        expected_prefix = _openvoice_uid_prefix(expected_uid)
        if artifact_prefix and not hmac.compare_digest(artifact_prefix, expected_prefix):
            return False
    return True


@dataclass(frozen=True)
class OpenVoiceArtifact:
    artifact_id: str
    path: Path
    content_type: str = "audio/wav"
    file_name: str = "voice-clone.wav"

    @property
    def size_bytes(self) -> int:
        try:
            return int(self.path.stat().st_size)
        except Exception:
            return 0


class OpenVoiceBenchmarkRequest(BaseModel):
    mode: Literal["tts", "vc", "tts_then_vc"] = "tts"
    runKind: Literal["warm", "cold"] = "warm"
    durationSec: int = Field(default=15, ge=1, le=600)
    language: str = Field(default="EN", max_length=32)
    text: str = Field(default="", max_length=100_000)
    sourceVoiceId: str = Field(default="", max_length=128)
    sourceVoiceName: str = Field(default="", max_length=128)
    sourceVoiceEngine: str = Field(default="", max_length=64)
    referenceAudioBase64: str = Field(default="", max_length=OPENVOICE_MAX_AUDIO_BASE64_CHARS)
    referenceAudioName: str = Field(default="", max_length=256)
    referenceAudioUrl: str = Field(default="", max_length=2_048)
    sourceAudioBase64: str = Field(default="", max_length=OPENVOICE_MAX_AUDIO_BASE64_CHARS)
    sourceAudioName: str = Field(default="", max_length=256)
    extractSourceVocals: bool = False
    sourceSeparationModel: str = Field(default="", max_length=64)
    sourceSeparationDevice: str = Field(default="", max_length=32)
    sourceTrimStartSec: Optional[float] = Field(default=None, ge=0.0)
    sourceTrimEndSec: Optional[float] = Field(default=None, ge=0.0)
    speed: float = 1.0
    requestId: str = Field(default="", max_length=128)
    traceId: str = Field(default="", max_length=128)
    regionHint: str = Field(default="", max_length=64)
    regionSource: str = Field(default="", max_length=64)
    costMultiplier: float = OPENVOICE_DEFAULT_COST_MULTIPLIER


class OpenVoiceModalClient:
    def __init__(
        self,
        base_url: str | None = None,
        *,
        token: str | None = None,
        timeout_sec: float = OPENVOICE_DEFAULT_TIMEOUT_SEC,
    ) -> None:
        resolved_base_url = (
            str(base_url).strip()
            if base_url is not None and str(base_url).strip()
            else _env_first(
                "VF_VOICE_CLONE_RUNTIME_URL",
                "VF_OPENVOICE_RUNTIME_URL",
            )
            or OPENVOICE_DEFAULT_RUNTIME_URL
        )
        resolved_token = (
            str(token).strip()
            if token is not None and str(token).strip()
            else (
                _env_first(
                    "VF_VOICE_CLONE_RUNTIME_TOKEN",
                    "VF_OPENVOICE_RUNTIME_TOKEN",
                )
                or OPENVOICE_RUNTIME_TOKEN
                or ""
            ).strip()
        )
        self.base_url = resolved_base_url.strip().rstrip("/")
        self.token = resolved_token
        self.timeout_sec = max(3.0, float(timeout_sec or OPENVOICE_DEFAULT_TIMEOUT_SEC))
        self._session = requests.Session()
        self._session.headers.update({"user-agent": "voiceflow-seed-vc-client/1.0"})
        if self.token:
            self._session.headers.update({"authorization": f"Bearer {self.token}"})

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        json_payload: Optional[dict[str, Any]] = None,
        timeout_sec: Optional[float] = None,
    ) -> dict[str, Any]:
        if not self.base_url:
            raise OpenVoiceRuntimeError(
                "Voice Clone runtime is not configured. Set VF_VOICE_CLONE_RUNTIME_URL to your Modal endpoint."
            )
        url = f"{self.base_url}{path}"
        try:
            response = self._session.request(
                method.upper(),
                url,
                json=json_payload or {},
                timeout=float(timeout_sec or self.timeout_sec),
            )
        except Exception as exc:  # noqa: BLE001
            raise OpenVoiceRuntimeError(f"Seed-VC runtime unreachable: {exc}") from exc
        if not response.ok:
            detail = response.text[:500] if response.text else f"HTTP {response.status_code}"
            raise OpenVoiceRuntimeError(f"Seed-VC runtime {path} failed: {detail}")
        try:
            payload = response.json()
        except Exception as exc:  # noqa: BLE001
            raise OpenVoiceRuntimeError(f"Seed-VC runtime {path} returned invalid JSON: {exc}") from exc
        return payload if isinstance(payload, dict) else {"value": payload}

    def health(self) -> dict[str, Any]:
        return self._request_json("GET", "/health")

    def capabilities(self) -> dict[str, Any]:
        return self._request_json("GET", "/v1/capabilities")

    def benchmark(self, payload: dict[str, Any], *, timeout_sec: Optional[float] = None) -> dict[str, Any]:
        return self._request_json("POST", "/v1/benchmark", json_payload=payload, timeout_sec=timeout_sec)

    def tts(self, payload: dict[str, Any], *, timeout_sec: Optional[float] = None) -> dict[str, Any]:
        return self._request_json("POST", "/v1/tts", json_payload=payload, timeout_sec=timeout_sec)

    def vc(self, payload: dict[str, Any], *, timeout_sec: Optional[float] = None) -> dict[str, Any]:
        return self._request_json("POST", "/v1/vc", json_payload=payload, timeout_sec=timeout_sec)

    def tts_then_vc(self, payload: dict[str, Any], *, timeout_sec: Optional[float] = None) -> dict[str, Any]:
        return self._request_json("POST", "/v1/tts-vc", json_payload=payload, timeout_sec=timeout_sec)

    def separate(self, payload: dict[str, Any], *, timeout_sec: Optional[float] = None) -> dict[str, Any]:
        return self._request_json("POST", "/v1/separate", json_payload=payload, timeout_sec=timeout_sec)


def save_openvoice_artifact(audio_bytes: bytes, artifact_id: str, *, root: Path | None = None) -> OpenVoiceArtifact:
    safe_root = Path(root or OPENVOICE_ARTIFACT_ROOT).resolve()
    safe_root.mkdir(parents=True, exist_ok=True)
    safe_artifact_id = normalize_openvoice_artifact_id(
        artifact_id,
        fallback=hashlib.sha256(bytes(audio_bytes)).hexdigest()[:16],
    )
    if not safe_artifact_id:
        raise ValueError("artifact_id could not be normalized.")
    artifact_path = (safe_root / f"{safe_artifact_id}.wav").resolve()
    try:
        artifact_path.relative_to(safe_root)
    except ValueError as exc:
        raise ValueError("artifact_id resolved outside of artifact root.") from exc
    artifact_path.write_bytes(bytes(audio_bytes))
    return OpenVoiceArtifact(
        artifact_id=safe_artifact_id,
        path=artifact_path,
        content_type="audio/wav",
        file_name=f"{safe_artifact_id}.wav",
    )


def build_openvoice_artifact_url(
    artifact_id: str,
    *,
    base_path: str = "/voice-lab/voice-clone/artifacts",
    secret: str | None = None,
    uid: str | None = None,
    exp: int | None = None,
    ttl_sec: int | None = None,
) -> str:
    safe_artifact_id = normalize_openvoice_artifact_id(artifact_id)
    if not safe_artifact_id:
        return ""
    signature = build_openvoice_artifact_signature(
        safe_artifact_id,
        secret=secret,
        uid=uid,
        exp=exp,
        ttl_sec=ttl_sec,
    )
    return f"{base_path.rstrip('/')}/{safe_artifact_id}?sig={signature}"
