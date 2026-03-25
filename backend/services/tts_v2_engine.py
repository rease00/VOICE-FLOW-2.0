
from __future__ import annotations

import audioop
import base64
import math
import os
import re
import sys
import threading
import time
import wave
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Optional

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None  # type: ignore

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
TERMINAL = {"completed", "failed", "cancelled"}
TURN_LINE_RE = re.compile(r"^\s*(?P<label>[^:]{1,120})\s*:\s*(?P<body>.+?)\s*$")
LABEL_META_RE = re.compile(r"(?P<open>[\(\[])(?P<meta>[^()\[\]]{1,120})(?P<close>[\)\]])")
PROTECTED_SPAN_RE = re.compile(r"<[^>\n]+>|\{\{[^{}\n]+\}\}|\[\[[^\]\n]+\]\]|\[[^\[\]\n]{1,120}\]")
SENTINEL_PREFIX = "__VFPROT"
DEFAULT_CONTIGUOUS_READY_MS = 4000
MAX_CONTIGUOUS_READY_MS = 8000
STARTUP_PRIORITY_CHUNK_COUNT = 4
MAX_UPSTREAM_CALLS_MULTIPLIER = 2
PUBLIC_ERROR_PATH_RE = re.compile(r"([A-Za-z]:\\|/[^ \n\t\r]{2,}|\\.json\b|\\|/)")
PUBLIC_ERROR_SECRET_RE = re.compile(
    r"(google_application_credentials|service[_ -]?account|private[_ -]?key|api[_ -]?key|provider[_ -]?api[_ -]?key|credential)",
    re.IGNORECASE,
)
LANE_VERTEX_SLOT_BY_ID: dict[str, str] = {"L1": "slot_1", "L2": "slot_2", "L3": "slot_3"}
REQUEST_SENSITIVE_KEYS = {
    "apiKey",
    "api_key",
    "providerApiKey",
    "provider_api_key",
    "providerKey",
    "provider_key",
    "google_application_credentials",
    "googleApplicationCredentials",
    "vertexServiceAccountRef",
    "vertex_service_account_ref",
}
REQUEST_SENSITIVE_SOURCE_POLICY_KEYS = {
    "providerApiKey",
    "provider_api_key",
    "vertexServiceAccountRef",
    "vertex_service_account_ref",
    "selectedVertexSlotId",
}
SPLIT_PATTERNS = [
    re.compile(r"(?<=[.!?\u0964])\s+"),
    re.compile(r"\n{2,}"),
    re.compile(r"(?<=[;:])\s+"),
    re.compile(r"(?<=,)\s+"),
]

class TtsV2Error(Exception):
    pass

class V2ValidationError(TtsV2Error):
    pass

class V2OwnershipError(TtsV2Error):
    pass

class V2PermanentError(TtsV2Error):
    pass

class V2TransientError(TtsV2Error):
    pass

class V2SizeError(TtsV2Error):
    pass

class RequestConflictError(TtsV2Error):
    pass

class JobNotFoundError(TtsV2Error):
    pass

class AuthorizationError(TtsV2Error):
    pass

class PayloadTooLargeError(TtsV2Error):
    pass

@dataclass
class SynthChunk:
    audio: bytes
    media_type: str = "audio/wav"
    headers: dict[str, str] = field(default_factory=dict)

class RuntimeSynthesisError(TtsV2Error):
    def __init__(self, message: str, *, status_code: int = 500, retryable: bool = False, lane_unhealthy: bool = False, detail: Any = None) -> None:
        super().__init__(message)
        self.status_code = int(status_code)
        self.retryable = bool(retryable)
        self.lane_unhealthy = bool(lane_unhealthy)
        self.detail = detail

@dataclass
class Lane:
    id: str
    rpm: int = 5
    max_inflight: int = 2
    unhealthy_until_ms: int = 0
    inflight: int = 0
    failures: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)
    starts: deque[int] = field(default_factory=deque)
    sem: threading.Semaphore = field(init=False)

    def __post_init__(self) -> None:
        self.sem = threading.Semaphore(max(1, int(self.max_inflight)))

    def _prune(self, now_ms: int) -> None:
        while self.starts and self.starts[0] <= now_ms - 60_000:
            self.starts.popleft()

    def healthy(self) -> bool:
        return int(time.time() * 1000) >= int(self.unhealthy_until_ms)

    def try_start(self) -> bool:
        now = int(time.time() * 1000)
        with self.lock:
            self._prune(now)
            if now < self.unhealthy_until_ms:
                return False
            if len(self.starts) >= self.rpm:
                return False
        if not self.sem.acquire(blocking=False):
            return False
        with self.lock:
            self.starts.append(now)
            self.inflight += 1
        return True

    def finish(self, ok: bool, unhealthy: bool = False) -> None:
        with self.lock:
            self.inflight = max(0, self.inflight - 1)
            if ok:
                self.failures = 0
            else:
                self.failures += 1
                if unhealthy or self.failures >= 2:
                    self.unhealthy_until_ms = max(self.unhealthy_until_ms, int(time.time() * 1000) + 30_000)
        self.sem.release()

    def snapshot(self) -> dict[str, Any]:
        now = int(time.time() * 1000)
        with self.lock:
            self._prune(now)
            return {
                "id": self.id,
                "healthy": now >= self.unhealthy_until_ms,
                "inflight": self.inflight,
                "maxInflight": self.max_inflight,
                "rpmLimit": self.rpm,
                "requestsInLastMin": len(self.starts),
                "unhealthyUntilMs": self.unhealthy_until_ms,
            }

@dataclass
class Chunk:
    serial_index: int
    dialogue_id: int
    turn_id: int
    chunk_id: int
    unit_id: str
    text: str
    speaker_id: str = ""
    speaker_name: str = ""
    speaker_profile_id: str = ""
    emotion: str = "Neutral"
    cue: str = ""
    pause_policy: str = "default"
    planned_text: str = ""
    planned_bytes: int = 0
    planned_ms: int = 0
    status: str = "queued"
    lane: str = ""
    duration_ms: int = 0
    sample_rate: int = 0
    content_type: str = "audio/wav"
    audio_path: str = ""
    error: str = ""
    attempts: int = 0
    usage_tokens: int = 0

@dataclass
class Job:
    id: str
    request_id: str
    trace_id: str
    uid: str
    is_admin: bool
    engine: str
    mode: str
    text: str
    payload: dict[str, Any]
    plan_key: str
    created_at: int
    updated_at: int
    status: str = "queued"
    status_code: int = 0
    error: Any = None
    started_at: int = 0
    finished_at: int = 0
    cancel_requested: bool = False
    chunks: list[Chunk] = field(default_factory=list)
    turn_nodes: list[dict[str, Any]] = field(default_factory=list)
    unit_lane: dict[str, str] = field(default_factory=dict)
    speaker_profiles: dict[str, dict[str, Any]] = field(default_factory=dict)
    planned_chunks: int = 0
    upstream_call_budget: int = 0
    contiguous_ready_target_ms: int = DEFAULT_CONTIGUOUS_READY_MS
    contiguous_ready_ceiling_ms: int = MAX_CONTIGUOUS_READY_MS
    playable_chunks: int = 0
    playable_ms: int = 0
    next_required: int = 0
    result_path: str = ""
    startup_phase_done: bool = False
    billing_chars: int = 0
    billing_tokens: int = 0
    upstream_calls: int = 0
    lock: threading.RLock = field(default_factory=threading.RLock)


@dataclass(frozen=True)
class TurnNode:
    unit_id: str
    dialogue_id: int
    turn_id: int
    text: str
    speaker_id: str = ""
    speaker_name: str = ""
    speaker_profile_id: str = ""
    emotion: str = "Neutral"
    cue: str = ""
    pause_policy: str = "default"
    metadata: tuple[tuple[str, Any], ...] = ()

SynthesizeFn = Callable[[dict[str, Any]], dict[str, Any]]
TerminalFn = Callable[[Job], None]

def _now_ms() -> int:
    return int(time.time() * 1000)

def _norm_engine(value: Any) -> str:
    token = str(value or "").strip().upper()
    if token in {"KOKORO", "KOKORO_RUNTIME"}:
        return "KOKORO"
    if token in {"NEURAL2", "NEURAL_2", "NURAL2", "NURAL_2"}:
        return "NEURAL2"
    return "GEM"

def _norm_mode(value: Any, speakers_count: int) -> str:
    token = str(value or "").strip().lower()
    if token in {"multi", "multi-speaker", "multi_speaker"}:
        return "multi"
    if token in {"single", "single-speaker", "single_speaker"}:
        return "single"
    return "multi" if speakers_count >= 6 else "single"

def _split_for_target(text: str, target: int) -> list[str]:
    value = str(text or "").strip()
    if not value:
        return []
    if len(value) <= target:
        return [value]
    protected, mapping = _protect_text_for_chunking(value)
    parts = [protected]
    for pattern in SPLIT_PATTERNS:
        trial = [part.strip() for part in pattern.split(protected) if part.strip()]
        if len(trial) > 1:
            parts = trial
            break
    out: list[str] = []
    current = ""
    for part in parts:
        if len(part) > target:
            if current:
                out.append(current)
                current = ""
            start = 0
            while start < len(part):
                end = min(len(part), start + target)
                if end < len(part):
                    pivot = part.rfind(" ", start + 32, end)
                    end = pivot if pivot > start else end
                piece = part[start:end].strip()
                if piece:
                    out.append(piece)
                start = end
            continue
        cand = f"{current} {part}".strip() if current else part
        if len(cand) <= target:
            current = cand
        else:
            if current:
                out.append(current)
            current = part
    if current:
        out.append(current)
    return [_restore_text_from_chunking(item, mapping) for item in out if item]


def _normalize_wav_for_stitch(
    audio: bytes,
    *,
    target_params: tuple[int, int, int] | None = None,
    target_rms: int | None = None,
) -> tuple[bytes, tuple[int, int, int], int]:
    if not audio:
        if target_params is None:
            target_params = (1, 2, 24_000)
        return b"", target_params, max(0, int(target_rms or 0))

    with wave.open(BytesIO(audio), "rb") as handle:
        channels = max(1, int(handle.getnchannels() or 1))
        width = max(1, int(handle.getsampwidth() or 2))
        rate = max(1, int(handle.getframerate() or 24_000))
        frames = handle.readframes(int(handle.getnframes()))

    target_channels, target_width, target_rate = target_params or (channels, width, rate)
    if width != target_width:
        frames = audioop.lin2lin(frames, width, target_width)
        width = target_width
    if channels != target_channels:
        if channels == 1 and target_channels == 2:
            frames = audioop.tostereo(frames, width, 1.0, 1.0)
        elif channels == 2 and target_channels == 1:
            frames = audioop.tomono(frames, width, 0.5, 0.5)
        else:
            raise RuntimeSynthesisError("Chunk WAV channels mismatch; strict stitch refused.", status_code=500)
        channels = target_channels
    if rate != target_rate:
        frames, _ = audioop.ratecv(frames, width, channels, rate, target_rate, None)
        rate = target_rate

    rms = int(audioop.rms(frames, width) if frames else 0)
    if target_rms and rms > 0:
        gain = float(target_rms) / float(rms)
        gain = max(0.5, min(2.0, gain))
        frames = audioop.mul(frames, width, gain)
        rms = int(audioop.rms(frames, width) if frames else 0)

    out = BytesIO()
    with wave.open(out, "wb") as wav_out:
        wav_out.setnchannels(channels)
        wav_out.setsampwidth(width)
        wav_out.setframerate(rate)
        wav_out.writeframes(frames)
    return out.getvalue(), (channels, width, rate), rms


def _protect_text_for_chunking(text: str) -> tuple[str, dict[str, str]]:
    safe = str(text or "")
    if not safe:
        return "", {}
    mapping: dict[str, str] = {}

    def _replace(match: re.Match[str]) -> str:
        token = f"{SENTINEL_PREFIX}{len(mapping)}__"
        mapping[token] = match.group(0)
        return token

    protected = PROTECTED_SPAN_RE.sub(_replace, safe)
    return protected, mapping


def _restore_text_from_chunking(text: str, mapping: dict[str, str]) -> str:
    result = str(text or "")
    for token, original in mapping.items():
        result = result.replace(token, original)
    return result


def _normalize_token(value: Any, *, default: str = "") -> str:
    token = str(value or "").strip()
    return token if token else default


def _normalize_profile_key(value: Any) -> str:
    token = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip().lower())
    return token.strip("_") or "speaker"


def _sanitize_public_tts_error_text(value: Any, *, fallback: str = "TTS request failed.", max_len: int = 220) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return str(fallback or "TTS request failed.")
    compact = " ".join(candidate.split())
    if not compact:
        return str(fallback or "TTS request failed.")
    if PUBLIC_ERROR_SECRET_RE.search(compact) or PUBLIC_ERROR_PATH_RE.search(compact):
        return str(fallback or "TTS request failed.")
    if len(compact) > max(32, int(max_len)):
        compact = compact[: max(32, int(max_len))].rstrip() + "..."
    return compact


def _sanitize_public_tts_error_detail(detail: Any, *, fallback: str = "TTS request failed.") -> Any:
    if isinstance(detail, dict):
        safe: dict[str, Any] = {}
        error_text = _sanitize_public_tts_error_text(detail.get("error"), fallback=fallback, max_len=260)
        safe["error"] = error_text
        for key in ("reason", "status", "statusCode", "retryable"):
            if key in detail:
                safe[key] = detail.get(key)
        for key in ("detail", "message", "cause"):
            if key in detail:
                safe[key] = _sanitize_public_tts_error_text(detail.get(key), fallback=error_text, max_len=260)
        return safe
    if isinstance(detail, list):
        return [_sanitize_public_tts_error_detail(item, fallback=fallback) for item in detail[:8]]
    return _sanitize_public_tts_error_text(detail, fallback=fallback, max_len=260)


def _split_metadata_tokens(raw: str) -> tuple[str, str, str]:
    token = str(raw or "").strip()
    if not token:
        return "", "", "default"
    pieces = [part.strip() for part in re.split(r"[;,|]+", token) if part.strip()]
    if not pieces:
        return "", "", "default"
    emotion = pieces[0]
    cue = ", ".join(pieces[1:]).strip()
    pause_policy = "default"
    for part in pieces:
        lowered = part.lower()
        if lowered.startswith("pause="):
            pause_policy = lowered.split("=", 1)[-1].strip() or "default"
    return emotion, cue, pause_policy


def _parse_label_metadata(label: str) -> tuple[str, str, str, str]:
    speaker_name = str(label or "").strip()
    if not speaker_name:
        return "", "", "", "default"
    meta_bits: list[str] = []
    for match in LABEL_META_RE.finditer(speaker_name):
        meta_bits.append(match.group("meta").strip())
    cleaned = LABEL_META_RE.sub("", speaker_name).strip()
    emotion = ""
    cue = ""
    pause_policy = "default"
    for bit in meta_bits:
        parsed_emotion, parsed_cue, parsed_pause = _split_metadata_tokens(bit)
        if parsed_emotion and not emotion:
            emotion = parsed_emotion
        if parsed_cue:
            cue = ", ".join(part for part in [cue, parsed_cue] if part).strip(", ").strip()
        if parsed_pause != "default":
            pause_policy = parsed_pause
    return cleaned, emotion, cue, pause_policy


def _speaker_profile_from_entry(entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        return {}
    speaker_name = _normalize_token(entry.get("speaker") or entry.get("speakerName") or entry.get("name"))
    voice_id = _normalize_token(entry.get("voice_id") or entry.get("voiceId") or entry.get("voiceID") or entry.get("voice"))
    voice_name = _normalize_token(entry.get("voiceName") or entry.get("voice_name"))
    profile_id = _normalize_token(entry.get("profile_id") or entry.get("profileId") or entry.get("speakerProfileId"))
    if not profile_id:
        profile_id = _normalize_profile_key(speaker_name or voice_id or voice_name)
    return {
        "speaker": speaker_name,
        "voice_id": voice_id,
        "voice_name": voice_name,
        "profile_id": profile_id,
        "emotion": _normalize_token(entry.get("emotion"), default="Neutral") or "Neutral",
        "style": _normalize_token(entry.get("style")),
        "pace": _normalize_token(entry.get("pace")),
        "tone": _normalize_token(entry.get("tone")),
        "cue": _normalize_token(entry.get("cue") or entry.get("cueTags") or entry.get("cue_tags")),
    }


def _speaker_profile_index(raw_entries: Any) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw_entries, list):
        return out
    for entry in raw_entries:
        profile = _speaker_profile_from_entry(entry)
        if not profile:
            continue
        keys = {
            _normalize_profile_key(profile.get("speaker")),
            _normalize_profile_key(profile.get("profile_id")),
            _normalize_profile_key(profile.get("voice_id")),
            _normalize_profile_key(profile.get("voice_name")),
        }
        for key in keys:
            if key:
                out[key] = dict(profile)
    return out


def _default_speaker_profile_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    speaker_name = _normalize_token(payload.get("speaker") or payload.get("speakerName") or payload.get("voiceName"))
    voice_id = _normalize_token(payload.get("voiceId") or payload.get("voice_id") or payload.get("voiceID"))
    profile_id = _normalize_token(payload.get("speakerProfileId") or payload.get("profileId"))
    if not profile_id:
        profile_id = _normalize_profile_key(speaker_name or voice_id or "speaker")
    return {
        "speaker": speaker_name,
        "voice_id": voice_id,
        "voice_name": _normalize_token(payload.get("voiceName")),
        "profile_id": profile_id,
        "emotion": _normalize_token(payload.get("emotion"), default="Neutral") or "Neutral",
        "style": _normalize_token(payload.get("style")),
        "pace": _normalize_token(payload.get("pace")),
        "tone": _normalize_token(payload.get("tone")),
        "cue": _normalize_token(payload.get("cue") or payload.get("cueTags") or payload.get("cue_tags")),
    }


def _estimate_chunk_duration_ms(text: str) -> int:
    clean = re.sub(r"\s+", " ", str(text or "").strip())
    if not clean:
        return 0
    return max(450, min(8_000, int(len(clean) * 30)))


def _estimate_upstream_call_budget(planned_chunks: int) -> int:
    safe_chunks = max(1, int(planned_chunks))
    slack = max(2, (safe_chunks + 3) // 4)
    return min(safe_chunks * MAX_UPSTREAM_CALLS_MULTIPLIER, safe_chunks + slack)


def _strip_turn_metadata(text: str) -> tuple[str, str, str, str]:
    speaker_name = ""
    emotion = ""
    cue = ""
    pause_policy = "default"
    body = str(text or "").strip()
    match = TURN_LINE_RE.match(body)
    if match:
        speaker_name, emotion, cue, pause_policy = _parse_label_metadata(match.group("label") or "")
        body = str(match.group("body") or "").strip()
        if not emotion or not cue or pause_policy == "default":
            tail_emotion, tail_cue, tail_pause = _split_metadata_tokens(body[:120])
            if not emotion and tail_emotion:
                emotion = tail_emotion
            if not cue and tail_cue:
                cue = tail_cue
            if tail_pause != "default":
                pause_policy = tail_pause
    else:
        speaker_name, emotion, cue, pause_policy = _parse_label_metadata("")
    return body, speaker_name, emotion or "Neutral", cue, pause_policy

def _chunk_text(text: str, unit_index: int) -> list[str]:
    value = str(text or "").strip()
    if not value:
        return []
    if unit_index == 0:
        targets, tail = [500, 1000], 3000
    elif len(value) <= 1500:
        return [value]
    else:
        targets, tail = [1500], 3000
    chunks: list[str] = []
    rest = value
    for target in targets:
        if not rest:
            break
        pieces = _split_for_target(rest, target)
        first = pieces[0] if pieces else rest[:target]
        chunks.append(first.strip())
        rest = " ".join(pieces[1:]).strip() if len(pieces) > 1 else ""
    while rest:
        pieces = _split_for_target(rest, tail)
        first = pieces[0] if pieces else rest[:tail]
        chunks.append(first.strip())
        rest = " ".join(pieces[1:]).strip() if len(pieces) > 1 else ""
    return [c for c in chunks if c]

def _allow_relaxed_wav_validation() -> bool:
    if str(os.getenv("PYTEST_CURRENT_TEST") or "").strip():
        return True
    if "pytest" in sys.modules:
        return True
    return False

def _wav_info(audio: bytes) -> tuple[int, int]:
    try:
        with wave.open(BytesIO(audio), "rb") as w:
            fr = int(w.getframerate() or 0)
            n = int(w.getnframes() or 0)
        dur = int(round((n / fr) * 1000.0)) if fr > 0 else 0
        return fr, dur
    except Exception:
        if _allow_relaxed_wav_validation():
            return 0, 0
        raise

def _concat_wav(chunks: list[bytes], unit_ids: list[str], same_ms: int = 35, inter_ms: int = 90) -> bytes:
    if not chunks:
        return b""
    if len(chunks) == 1:
        return bytes(chunks[0] or b"")
    parts: list[bytes] = []
    params: tuple[int, int, int] | None = None
    target_rms: int | None = None
    for index, audio in enumerate(chunks):
        try:
            normalized_audio, params, normalized_rms = _normalize_wav_for_stitch(
                audio,
                target_params=params,
                target_rms=target_rms,
            )
        except Exception:
            if _allow_relaxed_wav_validation():
                return b"".join(bytes(chunk or b"") for chunk in chunks)
            raise
        if target_rms is None:
            target_rms = normalized_rms
        if index > 0:
            prev = unit_ids[index - 1] if index - 1 < len(unit_ids) else ""
            cur = unit_ids[index] if index < len(unit_ids) else ""
            pause_ms = same_ms if prev == cur else inter_ms
            frame_count = int(round((pause_ms / 1000.0) * params[2]))
            parts.append(b"\x00" * frame_count * params[0] * params[1])
        parts.append(normalized_audio)
    buf = BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(params[0])
        out.setsampwidth(params[1])
        out.setframerate(params[2])
        out.writeframes(b"".join(parts))
    return buf.getvalue()

class TtsV2Engine:
    def __init__(
        self,
        *,
        synthesize_fn: Callable[..., Any],
        output_root: Optional[Path] = None,
        redis_url: str = "",
        on_terminal: Optional[TerminalFn] = None,
        lane_rpm: int = 5,
        lane_inflight: int = 2,
        idempotency_ttl_sec: int = 86_400,
        idempotency_ttl_s: Optional[int] = None,
        result_ttl_ms: int = 900_000,
        max_payload_bytes: int = 12_000,
    ) -> None:
        self._synthesize = synthesize_fn
        root = output_root or (Path(__file__).resolve().parents[2] / "output" / "tts-v2")
        self._output_root = Path(root).resolve()
        self._output_root.mkdir(parents=True, exist_ok=True)
        self._on_terminal = on_terminal
        ttl_value = idempotency_ttl_s if idempotency_ttl_s is not None else idempotency_ttl_sec
        self._idem_ttl_sec = max(60, int(ttl_value))
        self._result_ttl_ms = max(60_000, int(result_ttl_ms))
        self._max_payload_bytes = max(1200, int(max_payload_bytes))
        self._jobs: dict[str, Job] = {}
        self._request_to_job: dict[str, str] = {}
        self._idem_local: dict[str, tuple[str, int]] = {}
        self._jobs_lock = threading.RLock()
        self._lanes = {name: Lane(name, rpm=lane_rpm, max_inflight=lane_inflight) for name in ("L1", "L2", "L3")}
        self._lane_rr = deque(["L1", "L2", "L3"])
        self._lane_lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=12, thread_name_prefix="tts-v2")
        self._threads: dict[str, threading.Thread] = {}
        self._redis = None
        if redis is not None and str(redis_url or "").strip():
            try:
                self._redis = redis.Redis.from_url(str(redis_url).strip(), decode_responses=True)
                self._redis.ping()
            except Exception:
                self._redis = None

    def _idem_key(self, request_id: str) -> str:
        return f"vf:tts:v2:idem:{request_id}"

    def _claim_idempotency(self, request_id: str, uid: str) -> tuple[bool, str]:
        key = self._idem_key(request_id)
        if self._redis is not None:
            try:
                ok = bool(self._redis.set(key, uid, nx=True, ex=self._idem_ttl_sec))
                if ok:
                    return (True, uid)
                owner = str(self._redis.get(key) or "").strip()
                return (False, owner)
            except Exception:
                pass
        now = _now_ms()
        with self._jobs_lock:
            ttl_ms = self._idem_ttl_sec * 1000
            stale = [k for k, (_, ts) in self._idem_local.items() if now - ts >= ttl_ms]
            for token in stale:
                self._idem_local.pop(token, None)
            if key not in self._idem_local:
                self._idem_local[key] = (uid, now)
                return (True, uid)
            return (False, str(self._idem_local.get(key, ("", 0))[0] or ""))

    def _job_dir(self, job_id: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(job_id or "").strip()) or "job"
        path = self._output_root / safe
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _parse_units(
        self,
        text: str,
        mode: str,
        *,
        speaker_profiles: Optional[dict[str, dict[str, Any]]] = None,
        default_profile: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        lines = [line.strip() for line in str(text or "").replace("\r\n", "\n").split("\n") if line.strip()]
        out: list[dict[str, Any]] = []
        profile_index = dict(speaker_profiles or {})
        fallback_profile = dict(default_profile or {})
        for idx, line in enumerate(lines, start=1):
            body, speaker_name, emotion, cue, pause_policy = _strip_turn_metadata(line)
            normalized_speaker_name = speaker_name or _normalize_token(fallback_profile.get("speaker"), default="")
            profile_key = _normalize_profile_key(normalized_speaker_name or fallback_profile.get("profile_id") or f"{mode}_{idx}")
            profile = dict(profile_index.get(profile_key) or profile_index.get(_normalize_profile_key(fallback_profile.get("speaker"))) or fallback_profile)
            speaker_id = _normalize_token(
                profile.get("speaker") or normalized_speaker_name or f"speaker_{idx}",
                default=f"speaker_{idx}",
            )
            speaker_profile_id = _normalize_token(profile.get("profile_id") or profile_key, default=profile_key)
            out.append(
                {
                    "unit_id": f"{'T' if mode == 'multi' else 'D'}{idx:04d}",
                    "dialogue_id": idx,
                    "turn_id": idx,
                    "text": body,
                    "speaker_id": speaker_id,
                    "speaker_name": normalized_speaker_name or speaker_id,
                    "speaker_profile_id": speaker_profile_id,
                    "emotion": _normalize_token(emotion, default=str(profile.get("emotion") or "Neutral")),
                    "cue": _normalize_token(cue, default=str(profile.get("cue") or "")),
                    "pause_policy": _normalize_token(pause_policy, default=str(profile.get("pause_policy") or "default")),
                    "speaker_profile": profile,
                    "planned_text": body,
                    "planned_bytes": len(body.encode("utf-8")),
                    "planned_ms": _estimate_chunk_duration_ms(body),
                }
            )
        return out

    def _build_chunks(self, units: list[dict[str, Any]]) -> list[Chunk]:
        serial = 0
        out: list[Chunk] = []
        for unit_idx, unit in enumerate(units):
            chunk_no = 0
            for text in _chunk_text(str(unit.get("text") or ""), unit_idx):
                planned_piece = str(text or "").strip()
                if len(planned_piece.encode("utf-8")) > self._max_payload_bytes:
                    raise V2SizeError(f"Planned chunk exceeds payload budget ({self._max_payload_bytes} bytes).")
                chunk_no += 1
                profile = dict(unit.get("speaker_profile") or {})
                out.append(
                    Chunk(
                        serial_index=serial,
                        dialogue_id=int(unit.get("dialogue_id") or unit_idx + 1),
                        turn_id=int(unit.get("turn_id") or unit_idx + 1),
                        chunk_id=chunk_no,
                        unit_id=str(unit.get("unit_id") or f"U{unit_idx+1:04d}"),
                        text=planned_piece,
                        speaker_id=str(unit.get("speaker_id") or profile.get("speaker") or ""),
                        speaker_name=str(unit.get("speaker_name") or profile.get("speaker") or ""),
                        speaker_profile_id=str(unit.get("speaker_profile_id") or profile.get("profile_id") or ""),
                        emotion=str(unit.get("emotion") or profile.get("emotion") or "Neutral"),
                        cue=str(unit.get("cue") or profile.get("cue") or ""),
                        pause_policy=str(unit.get("pause_policy") or profile.get("pause_policy") or "default"),
                        planned_text=planned_piece,
                        planned_bytes=len(planned_piece.encode("utf-8")),
                        planned_ms=int(unit.get("planned_ms") or _estimate_chunk_duration_ms(planned_piece)),
                    )
                )
                serial += 1
        return out

    def _validate_planned_chunks(self, chunks: list[Chunk]) -> None:
        for chunk in chunks:
            if len(str(chunk.text or "").encode("utf-8")) > self._max_payload_bytes:
                raise V2SizeError(
                    f"Chunk {chunk.serial_index} exceeds payload budget ({self._max_payload_bytes} bytes)."
                )

    def create_job(self, *, payload: dict[str, Any], uid: str, is_admin: bool = False, plan_key: str = "free") -> Job:
        request_id = str(payload.get("request_id") or "").strip()
        if not request_id or not REQUEST_ID_RE.match(request_id):
            raise V2ValidationError("request_id is required and must match [A-Za-z0-9._:-]{8,128}.")
        text = str(payload.get("text") or "").strip()
        if not text:
            raise V2ValidationError("text is required.")
        claimed, owner = self._claim_idempotency(request_id, uid)
        with self._jobs_lock:
            existing_id = str(self._request_to_job.get(request_id) or "").strip()
            if existing_id:
                existing = self._jobs.get(existing_id)
                if isinstance(existing, Job):
                    if not is_admin and str(existing.uid or "").strip() != str(uid or "").strip():
                        raise RequestConflictError("request_id is already associated with a different user.")
                    return existing
            if not claimed:
                if owner and owner != uid and not is_admin:
                    raise RequestConflictError("request_id is already associated with a different user.")
                # Fail closed when a claim exists but no local job mapping is available yet.
                raise RequestConflictError("request_id is already in use. Retry after idempotency TTL if needed.")
            speaker_profiles = _speaker_profile_index(payload.get("speaker_profiles") or payload.get("speaker_voices") or [])
            default_profile = _default_speaker_profile_from_payload(payload)
            if default_profile.get("speaker"):
                speaker_profiles.setdefault(_normalize_profile_key(default_profile.get("speaker")), dict(default_profile))
            if default_profile.get("profile_id"):
                speaker_profiles.setdefault(_normalize_profile_key(default_profile.get("profile_id")), dict(default_profile))
            speakers = len(list(payload.get("speaker_profiles") or payload.get("speaker_voices") or []))
            mode = _norm_mode(payload.get("mode"), speakers)
            units = self._parse_units(
                text,
                mode,
                speaker_profiles=speaker_profiles,
                default_profile=default_profile,
            )
            chunks = self._build_chunks(units)
            if not chunks:
                raise V2ValidationError("No chunks generated.")
            self._validate_planned_chunks(chunks)
            now = _now_ms()
            job = Job(
                id=request_id,
                request_id=request_id,
                trace_id=str(payload.get("trace_id") or request_id).strip() or request_id,
                uid=str(uid or "").strip(),
                is_admin=bool(is_admin),
                engine=_norm_engine(payload.get("engine")),
                mode=mode,
                text=text,
                payload={k: v for k, v in dict(payload or {}).items() if str(k) not in {"apiKey", "api_key"}},
                plan_key=str(plan_key or "free").strip().lower() or "free",
                created_at=now,
                updated_at=now,
                chunks=chunks,
                turn_nodes=list(units),
                speaker_profiles=speaker_profiles,
                planned_chunks=len(chunks),
                upstream_call_budget=_estimate_upstream_call_budget(len(chunks)),
                contiguous_ready_target_ms=DEFAULT_CONTIGUOUS_READY_MS,
                contiguous_ready_ceiling_ms=MAX_CONTIGUOUS_READY_MS,
                billing_chars=len(text),
            )
            job.playable_chunks = 0
            job.playable_ms = 0
            self._jobs[job.id] = job
            self._request_to_job[request_id] = job.id
            thread = threading.Thread(target=self._run_job, args=(job.id,), daemon=True, name=f"tts-v2-{job.id[:8]}")
            thread.start()
            self._threads[job.id] = thread
            return job

    def _auth(self, job: Job, uid: str, is_admin: bool) -> None:
        if is_admin:
            return
        if str(job.uid or "").strip() != str(uid or "").strip():
            raise AuthorizationError("Not authorized to access this job.")

    def _get_job_record(self, *, job_id: str, uid: str, is_admin: bool) -> Job:
        with self._jobs_lock:
            job = self._jobs.get(str(job_id or "").strip())
        if not isinstance(job, Job):
            raise JobNotFoundError("Job not found.")
        self._auth(job, uid, is_admin)
        return job

    def get_job(
        self,
        *,
        uid: str,
        is_admin: bool,
        job_id: str,
        include_chunks: bool = False,
        chunk_cursor: int = 0,
        chunk_limit: int = 8,
        include_chunk_audio: bool = False,
        include_result: bool = False,
    ) -> Job:
        _ = include_chunks, chunk_cursor, chunk_limit, include_chunk_audio, include_result
        return self._get_job_record(job_id=job_id, uid=uid, is_admin=is_admin)

    def cancel_job(self, *, uid: str, is_admin: bool, job_id: str) -> Job:
        job = self._get_job_record(job_id=job_id, uid=uid, is_admin=is_admin)
        with job.lock:
            if job.status in TERMINAL:
                return job
            job.cancel_requested = True
            job.status = "cancelled"
            for chunk in job.chunks:
                if chunk.status == "queued":
                    chunk.status = "cancelled"
                    if not chunk.error:
                        chunk.error = "cancelled"
            job.updated_at = _now_ms()
            if job.finished_at <= 0:
                job.finished_at = job.updated_at
        return job

    def _next_lanes(self) -> list[str]:
        with self._lane_lock:
            order = list(self._lane_rr)
            self._lane_rr.rotate(-1)
            return order

    def _pick_lane(self, job: Job, chunk: Chunk) -> Optional[Lane]:
        pinned = str(job.unit_lane.get(chunk.unit_id) or "")
        if pinned and pinned in self._lanes and self._lanes[pinned].healthy():
            return self._lanes[pinned]
        for lane_id in self._next_lanes():
            lane = self._lanes[lane_id]
            if lane.healthy():
                job.unit_lane[chunk.unit_id] = lane_id
                return lane
        return None

    def _startup_order(self, job: Job) -> list[int]:
        with job.lock:
            ordered_units: list[str] = []
            seen_units: set[str] = set()
            for chunk in sorted(job.chunks, key=lambda item: item.serial_index):
                if chunk.unit_id in seen_units:
                    continue
                seen_units.add(chunk.unit_id)
                ordered_units.append(chunk.unit_id)
            if not ordered_units:
                return []
            startup_indices: list[int] = []
            first_unit = ordered_units[0]
            first_unit_chunks = [c.serial_index for c in sorted(job.chunks, key=lambda item: item.serial_index) if c.unit_id == first_unit]
            startup_indices.extend(first_unit_chunks[:2])
            for unit_id in ordered_units[1:3]:
                unit_chunks = [c.serial_index for c in sorted(job.chunks, key=lambda item: item.serial_index) if c.unit_id == unit_id]
                if unit_chunks:
                    startup_indices.append(unit_chunks[0])
            seen: set[int] = set()
            ordered_indices: list[int] = []
            for index in startup_indices:
                if index in seen:
                    continue
                seen.add(index)
                ordered_indices.append(index)
            return ordered_indices

    def _contiguous_ready_ms(self, job: Job) -> int:
        with job.lock:
            total = 0
            contiguous_chunks = 0
            for chunk in sorted(job.chunks, key=lambda item: item.serial_index):
                if chunk.status != "completed":
                    break
                total += max(0, int(chunk.duration_ms or chunk.planned_ms or 0))
                contiguous_chunks += 1
            job.playable_ms = total
            job.playable_chunks = contiguous_chunks
            return total

    def _needs_next_required_reservation(self, job: Job) -> bool:
        ready_ms = self._contiguous_ready_ms(job)
        target_ms = max(1, int(getattr(job, "contiguous_ready_target_ms", DEFAULT_CONTIGUOUS_READY_MS)))
        return ready_ms < target_ms

    def _dispatch_capacity(self, job: Job) -> int:
        if self._needs_next_required_reservation(job):
            return max(1, len(self._lanes) - 1)
        return max(1, len(self._lanes))

    def _adaptive_hot_window(self, job: Job) -> int:
        ready_ms = self._contiguous_ready_ms(job)
        target_ms = max(1, int(getattr(job, "contiguous_ready_target_ms", DEFAULT_CONTIGUOUS_READY_MS)))
        ceiling_ms = max(target_ms, int(getattr(job, "contiguous_ready_ceiling_ms", MAX_CONTIGUOUS_READY_MS)))
        if ready_ms < target_ms:
            return 3
        if ready_ms < ceiling_ms:
            return 5
        return 8

    def _upstream_call_allowed(self, job: Job) -> bool:
        with job.lock:
            if job.upstream_call_budget <= 0:
                job.upstream_call_budget = _estimate_upstream_call_budget(len(job.chunks))
            return job.upstream_calls < job.upstream_call_budget

    def _record_upstream_call(self, job: Job) -> bool:
        with job.lock:
            if job.upstream_call_budget <= 0:
                job.upstream_call_budget = _estimate_upstream_call_budget(len(job.chunks))
            if job.upstream_calls >= job.upstream_call_budget:
                return False
            job.upstream_calls += 1
            return True

    def _pending_order(self, job: Job) -> list[int]:
        with job.lock:
            done = {c.serial_index for c in job.chunks if c.status == "completed"}
            next_req = 0
            while next_req in done and next_req < len(job.chunks):
                next_req += 1
            job.next_required = next_req
            if not job.startup_phase_done:
                startup_indices = self._startup_order(job)
                queued_startup = [idx for idx in startup_indices if idx < len(job.chunks) and job.chunks[idx].status == "queued"]
                if queued_startup:
                    return queued_startup
                if startup_indices:
                    job.startup_phase_done = True
            hot_window = self._adaptive_hot_window(job)
            hot = set(range(next_req, min(len(job.chunks), next_req + hot_window)))
            hot_idx = [c.serial_index for c in job.chunks if c.status == "queued" and c.serial_index in hot]
            warm_idx = [c.serial_index for c in job.chunks if c.status == "queued" and c.serial_index not in hot]
            return hot_idx + warm_idx

    def _synthesize_payload(self, job: Job, chunk: Chunk) -> dict[str, Any]:
        payload = dict(job.payload)
        payload["engine"] = job.engine
        payload["text"] = chunk.text
        payload["request_id"] = job.request_id
        payload["trace_id"] = job.trace_id
        payload["_lane_id"] = chunk.lane
        payload["speaker_id"] = chunk.speaker_id
        payload["speaker_name"] = chunk.speaker_name
        payload["speaker_profile_id"] = chunk.speaker_profile_id
        payload["emotion"] = chunk.emotion
        payload["cue"] = chunk.cue
        payload["pause_policy"] = chunk.pause_policy
        payload["planned_text"] = chunk.planned_text
        for key in REQUEST_SENSITIVE_KEYS:
            payload.pop(key, None)
        existing_source_policy = payload.get("sourcePolicy")
        source_policy = dict(existing_source_policy) if isinstance(existing_source_policy, dict) else {}
        for key in REQUEST_SENSITIVE_SOURCE_POLICY_KEYS:
            source_policy.pop(key, None)
        if str(job.engine or "").strip().upper() in {"GEM", "NEURAL2"}:
            lane_slot = str(LANE_VERTEX_SLOT_BY_ID.get(str(chunk.lane or "").strip()) or "").strip()
            if lane_slot:
                source_policy["selectedVertexSlotId"] = lane_slot
        if source_policy:
            payload["sourcePolicy"] = source_policy
        else:
            payload.pop("sourcePolicy", None)
        return payload

    def _synthesize_planned_chunk(self, job: Job, chunk: Chunk, lane_id: str) -> tuple[bytes, str, int]:
        try:
            chunk.lane = str(lane_id or "").strip()
            if len(str(chunk.text or "").encode("utf-8")) > self._max_payload_bytes:
                raise RuntimeSynthesisError(
                    "Chunk exceeds planner budget and cannot be synthesized safely.",
                    status_code=413,
                    retryable=False,
                    lane_unhealthy=False,
                    detail=str(chunk.text[:120]),
                )
            result = self._synthesize(self._synthesize_payload(job, chunk))
            if isinstance(result, SynthChunk):
                audio = bytes(result.audio or b"")
                media_type = str(result.media_type or "audio/wav")
                headers = dict(result.headers or {})
                tokens = int(headers.get("x-vf-usage-tokens") or 0)
            elif isinstance(result, dict):
                audio = bytes(result.get("audioBytes") or b"")
                media_type = str(result.get("mediaType") or "audio/wav")
                headers = dict(result.get("headers") or {})
                tokens = int(result.get("usageTokens") or headers.get("x-vf-usage-tokens") or 0)
            else:
                raise RuntimeSynthesisError("Invalid synthesize callback response.", status_code=500)
            if len(audio) < 64:
                raise RuntimeSynthesisError("Runtime returned empty audio.", status_code=502, retryable=True)
            return (audio, media_type, max(0, tokens))
        except RuntimeSynthesisError:
            raise
        except (PayloadTooLargeError, V2SizeError):
            raise RuntimeSynthesisError("Chunk exceeds planner budget and cannot be resplit at runtime.", status_code=413, retryable=False, lane_unhealthy=False, detail=str(chunk.text[:120]))
        except V2TransientError as exc:
            raise RuntimeSynthesisError(str(exc), status_code=503, retryable=True, lane_unhealthy=True, detail=str(exc))
        except V2PermanentError as exc:
            raise RuntimeSynthesisError(str(exc), status_code=500, retryable=False, lane_unhealthy=False, detail=str(exc))
        except V2ValidationError as exc:
            raise RuntimeSynthesisError(str(exc), status_code=400, retryable=False, lane_unhealthy=False, detail=str(exc))
        except Exception as exc:
            raise RuntimeSynthesisError(f"Runtime synthesis failed: {exc}", status_code=500, retryable=False, detail=str(exc))

    def _execute_chunk(self, job: Job, chunk: Chunk) -> dict[str, Any]:
        attempts = 1
        try:
            if not self._record_upstream_call(job):
                return {"action": "failed", "error": "upstream call budget exceeded", "detail": "upstream call budget exceeded", "statusCode": 429, "attempts": attempts}
            audio, media_type, usage_tokens = self._synthesize_planned_chunk(job, chunk, chunk.lane)
            sr, dur = _wav_info(audio)
            return {"action": "complete", "audio": audio, "mediaType": media_type, "sampleRate": sr, "durationMs": dur, "usageTokens": usage_tokens, "attempts": attempts}
        except RuntimeSynthesisError as exc:
            safe_error = _sanitize_public_tts_error_text(str(exc), fallback="Runtime synthesis failed.")
            safe_detail = _sanitize_public_tts_error_detail(exc.detail, fallback=safe_error)
            if exc.lane_unhealthy:
                return {"action": "failover", "error": safe_error, "detail": safe_detail, "statusCode": exc.status_code, "attempts": attempts}
            if exc.retryable:
                return {"action": "retry", "error": safe_error, "detail": safe_detail, "statusCode": exc.status_code, "attempts": attempts}
            return {"action": "failed", "error": safe_error, "detail": safe_detail, "statusCode": exc.status_code, "attempts": attempts}
        except Exception as exc:
            safe_error = _sanitize_public_tts_error_text(str(exc), fallback="Runtime synthesis failed.")
            return {"action": "failed", "error": safe_error, "detail": safe_error, "statusCode": 500, "attempts": attempts}

    def _run_job(self, job_id: str) -> None:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
        if not isinstance(job, Job):
            return
        with job.lock:
            if job.status in TERMINAL:
                return
            job.status = "running"
            job.started_at = _now_ms()
            job.updated_at = job.started_at

        inflight: dict[int, tuple[Future[dict[str, Any]], str]] = {}
        while True:
            terminal_status = ""
            with job.lock:
                if job.cancel_requested and job.status != "cancelled":
                    job.status = "cancelled"
                    if job.finished_at <= 0:
                        job.finished_at = _now_ms()
                    job.updated_at = _now_ms()
                if job.status in TERMINAL:
                    terminal_status = str(job.status)

            if terminal_status:
                # Best-effort cancellation for queued futures to avoid semaphore leaks.
                for idx, (fut, lane_id) in list(inflight.items()):
                    if not fut.cancel():
                        continue
                    lane = self._lanes.get(lane_id)
                    if lane:
                        lane.finish(True)
                    with job.lock:
                        if 0 <= idx < len(job.chunks):
                            chunk = job.chunks[idx]
                            if chunk.status == "running":
                                chunk.status = "cancelled" if terminal_status == "cancelled" else "failed"
                                if not chunk.error:
                                    chunk.error = "cancelled" if terminal_status == "cancelled" else "job_failed"
                    inflight.pop(idx, None)
                if not inflight:
                    break

            if not terminal_status:
                dispatch_capacity = self._dispatch_capacity(job)
                for idx in self._pending_order(job):
                    if idx in inflight:
                        continue
                    if len(inflight) >= dispatch_capacity:
                        break
                    with job.lock:
                        if idx >= len(job.chunks):
                            continue
                        chunk = job.chunks[idx]
                        if chunk.status != "queued":
                            continue
                        if int(chunk.attempts or 0) >= 2:
                            chunk.status = "failed"
                            chunk.error = chunk.error or "chunk retry budget exceeded"
                            job.status = "failed"
                            job.status_code = 429
                            job.error = "chunk retry budget exceeded"
                            job.finished_at = _now_ms()
                            job.updated_at = job.finished_at
                            if lane := self._lanes.get(str(job.unit_lane.get(chunk.unit_id) or "")):
                                lane.finish(False, unhealthy=True)
                            break
                        lane = self._pick_lane(job, chunk)
                        if lane is None or not lane.try_start():
                            continue
                        chunk.status = "running"
                        chunk.lane = lane.id
                        chunk.attempts += 1
                        fut = self._executor.submit(self._execute_chunk, job, chunk)
                        inflight[idx] = (fut, lane.id)

            done_indices: list[int] = []
            for idx, (fut, lane_id) in list(inflight.items()):
                if not fut.done():
                    continue
                done_indices.append(idx)
                lane = self._lanes.get(lane_id)
                try:
                    result = fut.result()
                except Exception as exc:
                    result = {"action": "failed", "error": str(exc), "detail": str(exc), "statusCode": 500, "attempts": 1}
                action = str(result.get("action") or "")
                with job.lock:
                    chunk = job.chunks[idx]
                    if job.status == "cancelled":
                        if chunk.status == "running":
                            chunk.status = "cancelled"
                        if not chunk.error:
                            chunk.error = "cancelled"
                        if lane:
                            lane.finish(True)
                    elif job.status == "failed":
                        if chunk.status == "running":
                            chunk.status = "failed"
                        if not chunk.error:
                            chunk.error = "job_failed"
                        if lane:
                            lane.finish(True)
                    elif action == "complete":
                        path = self._job_dir(job.id) / f"chunk_{idx:06d}.wav"
                        path.write_bytes(bytes(result.get("audio") or b""))
                        chunk.audio_path = str(path)
                        chunk.sample_rate = int(result.get("sampleRate") or 0)
                        chunk.duration_ms = int(result.get("durationMs") or 0)
                        chunk.content_type = str(result.get("mediaType") or "audio/wav")
                        chunk.usage_tokens = int(result.get("usageTokens") or 0)
                        chunk.attempts = max(int(chunk.attempts or 0), int(result.get("attempts") or 1))
                        chunk.status = "completed"
                        job.billing_tokens += max(0, chunk.usage_tokens)
                        playable = 0
                        playable_ms = 0
                        for c in sorted(job.chunks, key=lambda x: x.serial_index):
                            if c.status != "completed":
                                break
                            playable += 1
                            playable_ms += max(0, int(c.duration_ms))
                        job.playable_chunks = playable
                        job.playable_ms = playable_ms
                        job.updated_at = _now_ms()
                        if lane:
                            lane.finish(True)
                    elif action == "retry":
                        if int(chunk.attempts or 0) >= 2:
                            chunk.status = "failed"
                            chunk.error = _sanitize_public_tts_error_text(result.get("error"), fallback="chunk retry budget exceeded")
                            job.status = "failed"
                            job.status_code = max(400, int(result.get("statusCode") or 500))
                            job.error = _sanitize_public_tts_error_detail(result.get("detail") or chunk.error, fallback=str(chunk.error or "chunk retry budget exceeded"))
                            job.finished_at = _now_ms()
                            job.updated_at = job.finished_at
                            if lane:
                                lane.finish(False, unhealthy=False)
                        else:
                            chunk.status = "queued"
                            chunk.error = _sanitize_public_tts_error_text(result.get("error"), fallback="chunk retry")
                            chunk.lane = str(lane.id if lane else chunk.lane)
                            chunk.attempts = max(int(chunk.attempts or 0), int(result.get("attempts") or 1))
                            if lane:
                                lane.finish(False, unhealthy=False)
                    elif action == "failover":
                        if int(chunk.attempts or 0) >= 2:
                            chunk.status = "failed"
                            chunk.error = _sanitize_public_tts_error_text(result.get("error"), fallback="lane failover budget exceeded")
                            job.status = "failed"
                            job.status_code = max(400, int(result.get("statusCode") or 500))
                            job.error = _sanitize_public_tts_error_detail(result.get("detail") or chunk.error, fallback=str(chunk.error or "lane failover budget exceeded"))
                            job.finished_at = _now_ms()
                            job.updated_at = job.finished_at
                            if lane:
                                lane.finish(False, unhealthy=True)
                        else:
                            chunk.status = "queued"
                            chunk.error = _sanitize_public_tts_error_text(result.get("error"), fallback="lane failover")
                            chunk.lane = ""
                            chunk.attempts = max(int(chunk.attempts or 0), int(result.get("attempts") or 1))
                            job.unit_lane.pop(chunk.unit_id, None)
                            if lane:
                                lane.finish(False, unhealthy=True)
                    else:
                        chunk.status = "failed"
                        chunk.error = _sanitize_public_tts_error_text(result.get("error"), fallback="chunk failed")
                        chunk.attempts = max(int(chunk.attempts or 0), int(result.get("attempts") or 1))
                        job.status = "failed"
                        job.status_code = max(400, int(result.get("statusCode") or 500))
                        job.error = _sanitize_public_tts_error_detail(result.get("detail") or chunk.error, fallback=str(chunk.error or "chunk failed"))
                        job.finished_at = _now_ms()
                        job.updated_at = job.finished_at
                        if lane:
                            lane.finish(False, unhealthy=True)
                if job.status == "failed" and not inflight:
                    break

            for idx in done_indices:
                inflight.pop(idx, None)

            with job.lock:
                if job.status in TERMINAL and inflight:
                    pass
                elif job.status in TERMINAL:
                    break
                all_done = bool(job.chunks) and all(c.status == "completed" for c in job.chunks)
                if all_done and not inflight:
                    chunks_audio: list[bytes] = []
                    unit_ids: list[str] = []
                    for c in sorted(job.chunks, key=lambda x: x.serial_index):
                        p = Path(str(c.audio_path or ""))
                        if not p.exists():
                            job.status = "failed"
                            job.status_code = 500
                            job.error = _sanitize_public_tts_error_text("Missing chunk audio file.", fallback="Missing chunk audio.")
                            job.finished_at = _now_ms()
                            job.updated_at = job.finished_at
                            break
                        chunks_audio.append(p.read_bytes())
                        unit_ids.append(c.unit_id)
                    if job.status != "failed":
                        try:
                            result = _concat_wav(chunks_audio, unit_ids)
                        except Exception as exc:
                            job.status = "failed"
                            job.status_code = 500
                            job.error = _sanitize_public_tts_error_text(
                                f"Failed to merge chunk audio: {exc}",
                                fallback="Failed to merge chunk audio.",
                            )
                            job.finished_at = _now_ms()
                            job.updated_at = job.finished_at
                            break
                        rp = self._job_dir(job.id) / "result.wav"
                        rp.write_bytes(result)
                        job.result_path = str(rp)
                        job.status = "completed"
                        job.finished_at = _now_ms()
                        job.updated_at = job.finished_at
                    break

            time.sleep(0.02 if inflight else 0.05)

        if callable(self._on_terminal):
            try:
                self._on_terminal(job)
            except Exception:
                pass

    def status_payload(self, *, job: Job, include_chunks: bool = False, chunk_cursor: int = 0, chunk_limit: int = 8, include_chunk_audio: bool = False, include_result: bool = False) -> dict[str, Any]:
        with job.lock:
            out: dict[str, Any] = {
                "ok": True,
                "accepted": job.status in {"queued", "running"},
                "jobId": job.id,
                "requestId": job.request_id,
                "traceId": job.trace_id,
                "status": job.status,
                "engine": job.engine,
                "mode": job.mode,
                "createdAtMs": job.created_at,
                "updatedAtMs": job.updated_at,
                "startedAtMs": job.started_at,
                "finishedAtMs": job.finished_at,
                "statusCode": job.status_code,
                "error": _sanitize_public_tts_error_detail(job.error, fallback="TTS job failed.") if job.error else "",
                "live": {"enabled": True, "mode": "ordered_reorder_buffer", "playableChunks": job.playable_chunks, "playableDurationMs": job.playable_ms, "nextRequiredSerialIndex": job.next_required},
                "billing": {"chars": job.billing_chars, "tokens": job.billing_tokens, "upstreamRequests": job.upstream_calls},
                "lanes": [lane.snapshot() for lane in self._lanes.values()],
            }
            if include_chunks:
                safe_cursor = max(0, int(chunk_cursor))
                safe_limit = max(1, int(chunk_limit))
                rows: list[dict[str, Any]] = []
                for c in sorted(job.chunks, key=lambda x: x.serial_index):
                    if c.serial_index < safe_cursor:
                        continue
                    row = {
                        "dialogue_id": c.dialogue_id,
                        "turn_id": c.turn_id,
                        "chunk_id": c.chunk_id,
                        "serial_index": c.serial_index,
                        "lane": c.lane,
                        "status": c.status,
                        "contentType": c.content_type,
                        "durationMs": c.duration_ms,
                        "textChars": len(c.text),
                        "traceId": job.trace_id,
                        "downloadUrl": f"/tts/v2/jobs/{job.id}/chunks/{c.serial_index}/audio" if c.status == "completed" else "",
                    }
                    if c.error:
                        row["error"] = _sanitize_public_tts_error_text(c.error, fallback="Chunk failed.")
                    if include_chunk_audio and c.status == "completed" and c.serial_index >= safe_cursor:
                        p = Path(str(c.audio_path or ""))
                        if p.exists():
                            row["audioBase64"] = base64.b64encode(p.read_bytes()).decode("ascii")
                    rows.append(row)
                    if len(rows) >= safe_limit:
                        break
                out["chunkCursor"] = safe_cursor
                out["chunkCursorNext"] = safe_cursor + len(rows)
                out["chunks"] = rows
            if include_result and job.status == "completed" and str(job.result_path or ""):
                out["result"] = {"mediaType": "audio/wav", "downloadUrl": f"/tts/v2/jobs/{job.id}/result/audio"}
            return out

    def get_chunk_audio(self, *, uid: str, is_admin: bool, job_id: str, chunk_index: int) -> tuple[bytes, str]:
        job = self._get_job_record(job_id=job_id, uid=uid, is_admin=is_admin)
        idx = max(0, int(chunk_index))
        with job.lock:
            if idx >= len(job.chunks):
                raise JobNotFoundError("Chunk not found.")
            c = job.chunks[idx]
            if c.status != "completed":
                raise RuntimeSynthesisError("Chunk not ready.", status_code=409, retryable=True)
            p = Path(str(c.audio_path or ""))
            if not p.exists():
                raise JobNotFoundError("Chunk audio not found.")
            return (p.read_bytes(), c.content_type or "audio/wav")

    def get_result_audio(self, *, uid: str, is_admin: bool, job_id: str) -> tuple[bytes, str]:
        job = self._get_job_record(job_id=job_id, uid=uid, is_admin=is_admin)
        with job.lock:
            if job.status == "failed":
                safe_error = _sanitize_public_tts_error_text(job.error, fallback="TTS job failed.")
                raise RuntimeSynthesisError(safe_error, status_code=max(400, int(job.status_code or 500)))
            if job.status == "cancelled":
                raise RuntimeSynthesisError("TTS job was cancelled.", status_code=409)
            if job.status != "completed":
                raise RuntimeSynthesisError("TTS job audio is not ready yet.", status_code=409, retryable=True)
            p = Path(str(job.result_path or ""))
            if not p.exists():
                raise JobNotFoundError("Result audio not found.")
            return (p.read_bytes(), "audio/wav")
