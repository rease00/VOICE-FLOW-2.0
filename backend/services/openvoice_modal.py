from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Optional

import requests
from pydantic import BaseModel, Field

OPENVOICE_GPU_RATE_PER_SEC_USD = 0.000222
OPENVOICE_DEFAULT_COST_MULTIPLIER = 1.0
OPENVOICE_DEFAULT_TIMEOUT_SEC = max(
    10.0,
    float((os.getenv("VF_OPENVOICE_RUNTIME_TIMEOUT_SEC") or "150").strip() or "150"),
)
OPENVOICE_DEFAULT_RUNTIME_URL = str(os.getenv("VF_OPENVOICE_RUNTIME_URL") or "").strip().rstrip("/")
OPENVOICE_RUNTIME_TOKEN = str(os.getenv("VF_OPENVOICE_RUNTIME_TOKEN") or "").strip()
OPENVOICE_ARTIFACT_SECRET = str(os.getenv("VF_OPENVOICE_ARTIFACT_SECRET") or "").strip()
OPENVOICE_ARTIFACT_EPHEMERAL_SECRET = hashlib.sha256(os.urandom(32)).hexdigest()
OPENVOICE_ARTIFACT_ROOT = Path(
    str(
        os.getenv(
            "VF_OPENVOICE_ARTIFACT_DIR",
            str(Path(__file__).resolve().parents[1] / "artifacts" / "openvoice"),
        )
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
    return base64.b64decode(token.encode("utf-8"), validate=False)


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


def _resolve_openvoice_artifact_secret(secret: str | None = None) -> str:
    return str(
        secret
        or OPENVOICE_ARTIFACT_SECRET
        or OPENVOICE_RUNTIME_TOKEN
        or OPENVOICE_ARTIFACT_EPHEMERAL_SECRET
    ).strip()


def build_openvoice_artifact_signature(artifact_id: str, secret: str | None = None) -> str:
    safe_artifact_id = normalize_openvoice_artifact_id(artifact_id)
    if not safe_artifact_id:
        raise ValueError("artifact_id is required.")
    safe_secret = _resolve_openvoice_artifact_secret(secret)
    payload = safe_artifact_id.encode("utf-8")
    return hmac.new(safe_secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_openvoice_artifact_signature(artifact_id: str, signature: str, secret: str | None = None) -> bool:
    safe_artifact_id = normalize_openvoice_artifact_id(artifact_id)
    if not safe_artifact_id:
        return False
    expected = build_openvoice_artifact_signature(safe_artifact_id, secret=secret)
    return hmac.compare_digest(expected, str(signature or "").strip())


@dataclass(frozen=True)
class OpenVoiceArtifact:
    artifact_id: str
    path: Path
    content_type: str = "audio/wav"
    file_name: str = "openvoice.wav"

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
    language: str = "EN"
    text: str = ""
    sourceVoiceId: str = ""
    sourceVoiceName: str = ""
    sourceVoiceEngine: str = ""
    referenceAudioBase64: str = ""
    referenceAudioName: str = ""
    referenceAudioUrl: str = ""
    sourceAudioBase64: str = ""
    sourceAudioName: str = ""
    speed: float = 1.0
    requestId: str = ""
    traceId: str = ""
    regionHint: str = ""
    regionSource: str = ""
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
            else str(os.getenv("VF_OPENVOICE_RUNTIME_URL") or OPENVOICE_DEFAULT_RUNTIME_URL)
        )
        resolved_token = (
            str(token).strip()
            if token is not None and str(token).strip()
            else str(os.getenv("VF_OPENVOICE_RUNTIME_TOKEN") or OPENVOICE_RUNTIME_TOKEN or "").strip()
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
                "Seed-VC runtime is not configured. Set VF_OPENVOICE_RUNTIME_URL to your Modal endpoint."
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


def build_openvoice_artifact_url(artifact_id: str, *, base_path: str = "/voice-lab/openvoice/artifacts", secret: str | None = None) -> str:
    safe_artifact_id = normalize_openvoice_artifact_id(artifact_id)
    if not safe_artifact_id:
        return ""
    signature = build_openvoice_artifact_signature(safe_artifact_id, secret=secret)
    return f"{base_path.rstrip('/')}/{safe_artifact_id}?sig={signature}"
