from __future__ import annotations

import base64
import hashlib
import hmac
import io
import os
import shutil
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from typing import Any

import modal
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


APP_NAME = "voiceflow-demucs-separation"
RUNTIME_PROVIDER = "modal"
RUNTIME_ENGINE = "demucs"
SEPARATION_MODEL_DEFAULT = str(os.getenv("VF_SOURCE_SEPARATION_MODEL") or "htdemucs_ft").strip() or "htdemucs_ft"
SEPARATION_DEVICE_DEFAULT = str(os.getenv("VF_SOURCE_SEPARATION_DEVICE") or "gpu_preferred").strip() or "gpu_preferred"
SEPARATION_SAMPLE_RATE = max(16000, int((os.getenv("VF_SOURCE_SEPARATION_SAMPLE_RATE") or "44100").strip() or "44100"))
OUTPUT_SAMPLE_RATE = 48000
MAX_AUDIO_BYTES = max(64_000, int((os.getenv("VF_VOICE_CLONE_MAX_AUDIO_BYTES") or str(12 * 1024 * 1024)).strip() or str(12 * 1024 * 1024)))
REQUEST_TIMEOUT_SEC = max(10.0, float((os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_TIMEOUT_SEC") or "45").strip() or "45"))
MODAL_GPU_FALLBACKS = [
    str(item).strip()
    for item in (os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_GPU") or "L4,A10G").split(",")
    if str(item).strip()
]
if not MODAL_GPU_FALLBACKS:
    MODAL_GPU_FALLBACKS = ["L4", "A10G"]
MODAL_GPU_RETRIES = max(0, int((os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_RETRIES") or "2").strip() or "2"))
MODAL_SCALEDOWN_WINDOW_SEC = max(
    60,
    int(
        (
            os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_SCALE_DOWN_WINDOW_SEC")
            or os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_IDLE_TIMEOUT_SEC")
            or "900"
        ).strip()
        or "900"
    ),
)
MODAL_CONTAINER_IDLE_TIMEOUT_SEC = max(
    60,
    int((os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_CONTAINER_IDLE_TIMEOUT_SEC") or "900").strip() or "900"),
)
MODAL_MIN_CONTAINERS = max(
    0,
    int(
        (
            os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_MIN_CONTAINERS")
            or os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_KEEP_WARM")
            or "0"
        ).strip()
        or "0"
    ),
)
MODAL_CONCURRENCY = max(
    1,
    int(
        (
            os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_CONCURRENCY")
            or os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_ALLOW_CONCURRENT_INPUTS")
            or "2"
        ).strip()
        or "2"
    ),
)
MODAL_STARTUP_TIMEOUT_SEC = max(
    120,
    int((os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_STARTUP_TIMEOUT_SEC") or "900").strip() or "900"),
)
MODAL_FUNCTION_TIMEOUT_SEC = max(
    120,
    int((os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_FUNCTION_TIMEOUT_SEC") or "1200").strip() or "1200"),
)
MODAL_MAX_CONTAINERS = max(
    1,
    int((os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_MAX_CONTAINERS") or "1").strip() or "1"),
)
DEMUCS_OVERLAP = min(
    0.45,
    max(0.05, float((os.getenv("VF_SOURCE_SEPARATION_OVERLAP") or "0.25").strip() or "0.25")),
)
DEMUCS_SEGMENT_SEC = max(2.0, float((os.getenv("VF_SOURCE_SEPARATION_SEGMENT_SEC") or "8.0").strip() or "8.0"))
FORCE_GPU = str(os.getenv("VF_VOICE_CLONE_SEPARATION_FORCE_GPU") or "1").strip().lower() not in {"0", "false", "no", "off"}
RUNTIME_TOKEN = str(
    os.getenv("VF_VOICE_CLONE_SEPARATION_MODAL_RUNTIME_TOKEN")
    or os.getenv("VF_OPENVOICE_SEPARATION_MODAL_RUNTIME_TOKEN")
    or os.getenv("VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN")
    or os.getenv("VF_OPENVOICE_MODAL_RUNTIME_TOKEN")
    or os.getenv("VF_VOICE_CLONE_RUNTIME_TOKEN")
    or os.getenv("VF_OPENVOICE_RUNTIME_TOKEN")
    or "voiceflow-separation-dev-token"
).strip()

_CACHE_ROOT = Path("/tmp/voiceflow-demucs-cache")
_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
_MODEL_CACHE: dict[tuple[str, str], Any] = {}
_RUNTIME_STATE: dict[str, Any] = {
    "startupOk": False,
    "startupError": "",
    "dependencyStatus": "unknown",
}

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "fastapi==0.116.1",
        "uvicorn[standard]==0.35.0",
        "demucs==4.0.1",
        "soundfile==0.13.1",
        "torch==2.6.0",
        "torchaudio==2.6.0",
        "numpy==1.26.4",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
)
app = modal.App(APP_NAME)


def _constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(str(left or "").encode("utf-8"), str(right or "").encode("utf-8"))


def _require_runtime_token(request: Request) -> None:
    expected = str(RUNTIME_TOKEN or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Runtime bearer token is not configured.")
    authorization = str(request.headers.get("authorization") or "").strip()
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    provided = authorization.split(" ", 1)[1].strip()
    if not provided:
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    if not _constant_time_equal(provided, expected):
        raise HTTPException(status_code=403, detail="Invalid bearer token.")


def _decode_audio_base64(token: str) -> bytes:
    safe = str(token or "").strip()
    if not safe:
        return b""
    padding = "=" * (-len(safe) % 4)
    try:
        return base64.b64decode((safe + padding).encode("ascii"), validate=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid base64 audio payload: {exc}") from exc


def _encode_audio_base64(audio_bytes: bytes) -> str:
    return base64.b64encode(bytes(audio_bytes or b"")).decode("ascii")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except Exception:
        return float(default)
    if parsed != parsed:  # NaN
        return float(default)
    return float(parsed)


def _get_torch() -> Any:
    try:
        import torch as torch_module
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"PyTorch is unavailable in the Modal runtime: {exc}") from exc
    return torch_module


def _get_soundfile() -> Any:
    try:
        import soundfile as soundfile_module
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"SoundFile is unavailable in the Modal runtime: {exc}") from exc
    return soundfile_module


def _get_demucs_runtime() -> tuple[Any, Any, Any]:
    try:
        from demucs.apply import apply_model as apply_model_fn
        from demucs.pretrained import get_model as get_model_fn
        from demucs.separate import load_track as load_track_fn
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Demucs is unavailable in the Modal runtime: {exc}") from exc
    return apply_model_fn, get_model_fn, load_track_fn


def _resolve_device(preference: str, *, torch_module: Any | None = None) -> str:
    torch_module = torch_module or _get_torch()
    cuda_available = bool(getattr(torch_module.cuda, "is_available", lambda: False)())
    token = str(preference or "").strip().lower()
    if token in {"gpu_preferred", "gpu", "cuda", "cuda_preferred"}:
        return "cuda" if cuda_available else "cpu"
    if token in {"cpu", "cpu_only"}:
        if FORCE_GPU and cuda_available:
            return "cuda"
        return "cpu"
    if token in {"auto", ""}:
        return "cuda" if cuda_available else "cpu"
    if token.startswith("cuda") and not cuda_available:
        return "cpu"
    return token


def _runtime_diagnostics(*, include_gpu_probe: bool = False) -> dict[str, Any]:
    torch_module: Any | None = None
    diagnostics: dict[str, Any] = {
        "provider": RUNTIME_PROVIDER,
        "engine": RUNTIME_ENGINE,
        "modelDefault": SEPARATION_MODEL_DEFAULT,
        "deviceDefault": SEPARATION_DEVICE_DEFAULT,
        "gpuRequested": MODAL_GPU_FALLBACKS,
        "startupOk": bool(_RUNTIME_STATE.get("startupOk")),
        "startupError": str(_RUNTIME_STATE.get("startupError") or ""),
        "dependencyStatus": str(_RUNTIME_STATE.get("dependencyStatus") or "unknown"),
        "modelCacheEntries": len(_MODEL_CACHE),
        "ffmpegAvailable": shutil.which("ffmpeg") is not None,
    }
    try:
        torch_module = _get_torch()
        diagnostics.update(
            {
                "torchVersion": str(getattr(torch_module, "__version__", "")),
                "cudaAvailable": bool(getattr(torch_module.cuda, "is_available", lambda: False)()),
                "cudaVersion": str(getattr(torch_module.version, "cuda", "") or ""),
                "cudaDeviceCount": int(getattr(torch_module.cuda, "device_count", lambda: 0)()),
            }
        )
    except HTTPException as exc:
        diagnostics["torchError"] = str(exc.detail)
    if include_gpu_probe:
        try:
            probe = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            diagnostics["gpuProbe"] = [line.strip() for line in str(probe.stdout or "").splitlines() if line.strip()]
        except Exception as exc:  # noqa: BLE001
            diagnostics["gpuProbeError"] = str(exc)
    return diagnostics


def _mark_startup_state(*, ok: bool, error: str = "", dependency_status: str = "ready") -> None:
    _RUNTIME_STATE["startupOk"] = bool(ok)
    _RUNTIME_STATE["startupError"] = str(error or "")
    _RUNTIME_STATE["dependencyStatus"] = str(dependency_status or "ready")


def _ffmpeg_convert_to_wav(
    source_path: Path,
    output_path: Path,
    *,
    start_sec: float | None = None,
    end_sec: float | None = None,
    sample_rate: int = SEPARATION_SAMPLE_RATE,
    channels: int = 2,
) -> None:
    command: list[str] = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
    ]
    if start_sec is not None and start_sec > 0:
        command.extend(["-ss", f"{float(start_sec):.3f}"])
    command.extend(["-i", str(source_path)])
    if end_sec is not None and start_sec is not None and end_sec > start_sec:
        duration_sec = max(0.05, float(end_sec) - float(start_sec))
        command.extend(["-t", f"{duration_sec:.3f}"])
    command.extend(
        [
            "-vn",
            "-ac",
            str(max(1, int(channels))),
            "-ar",
            str(max(8000, int(sample_rate))),
            str(output_path),
        ]
    )
    subprocess.run(command, check=True, capture_output=True)


def _hash_bytes(payload: bytes, *, model_name: str, device_hint: str, trim_window_key: str) -> str:
    digest = hashlib.sha256()
    digest.update(bytes(payload or b""))
    digest.update(b"\x00")
    digest.update(str(model_name or "").encode("utf-8"))
    digest.update(b"\x00")
    digest.update(str(device_hint or "").encode("utf-8"))
    digest.update(b"\x00")
    digest.update(str(trim_window_key or "").encode("utf-8"))
    return digest.hexdigest()[:40]


def _load_demucs_model(model_name: str, *, device: str) -> Any:
    _, get_model_fn, _ = _get_demucs_runtime()
    safe_name = str(model_name or "").strip() or SEPARATION_MODEL_DEFAULT
    safe_device = str(device or "cpu").strip().lower() or "cpu"
    cached = _MODEL_CACHE.get((safe_name, safe_device))
    if cached is not None:
        return cached
    model = get_model_fn(safe_name)
    if safe_device.startswith("cuda"):
        model = model.to("cuda")
    else:
        model = model.cpu()
    model.eval()
    _MODEL_CACHE[(safe_name, safe_device)] = model
    return model


def _wav_duration_sec(wav_bytes: bytes) -> float:
    with wave.open(io.BytesIO(bytes(wav_bytes or b"")), "rb") as handle:
        sample_rate = int(handle.getframerate() or 0)
        frames = int(handle.getnframes() or 0)
    if sample_rate <= 0 or frames <= 0:
        return 0.0
    return round(float(frames) / float(sample_rate), 6)


def _separate_audio_with_demucs(
    *,
    source_audio_bytes: bytes,
    source_audio_name: str,
    model_name: str,
    device_preference: str,
    trim_start_sec: float | None,
    trim_end_sec: float | None,
) -> tuple[bytes, bytes, dict[str, Any]]:
    torch_module = _get_torch()
    apply_model_fn, _, load_track_fn = _get_demucs_runtime()
    soundfile_module = _get_soundfile()
    try:
        torch_module.set_num_threads(1)
    except Exception:
        pass
    safe_model = str(model_name or "").strip() or SEPARATION_MODEL_DEFAULT
    safe_device_pref = str(device_preference or "").strip() or SEPARATION_DEVICE_DEFAULT
    runtime_device = _resolve_device(safe_device_pref, torch_module=torch_module)
    trim_key = ""
    if trim_start_sec is not None and trim_end_sec is not None and trim_end_sec > trim_start_sec:
        trim_key = f"{float(trim_start_sec):.3f}:{float(trim_end_sec):.3f}"
    cache_key = _hash_bytes(
        source_audio_bytes,
        model_name=safe_model,
        device_hint=safe_device_pref,
        trim_window_key=trim_key,
    )
    cache_dir = _CACHE_ROOT / cache_key
    vocals_cached = cache_dir / "vocals.wav"
    background_cached = cache_dir / "background.wav"
    if vocals_cached.exists() and background_cached.exists():
        vocals_bytes = vocals_cached.read_bytes()
        background_bytes = background_cached.read_bytes()
        duration_sec = _wav_duration_sec(vocals_bytes)
        runtime_meta = {
            "cacheHit": True,
            "cacheKey": cache_key,
            "durationSec": duration_sec,
        }
        return vocals_bytes, background_bytes, runtime_meta

    temp_dir = Path(tempfile.mkdtemp(prefix="vf_modal_sep_"))
    try:
        source_suffix = Path(source_audio_name or "source.wav").suffix or ".wav"
        source_path = temp_dir / f"source{source_suffix}"
        source_path.write_bytes(source_audio_bytes)
        prepared_path = temp_dir / "prepared.wav"
        _ffmpeg_convert_to_wav(
            source_path,
            prepared_path,
            start_sec=trim_start_sec,
            end_sec=trim_end_sec,
            sample_rate=SEPARATION_SAMPLE_RATE,
            channels=2,
        )

        model = _load_demucs_model(safe_model, device=runtime_device)
        wav = load_track_fn(prepared_path, model.audio_channels, model.samplerate)
        original_samples = int(wav.shape[-1]) if getattr(wav, "shape", None) else 0
        min_segment_samples = int(float(getattr(model, "segment", 0.0) or 0.0) * float(model.samplerate))
        # Guard short clips against Demucs split/chunk shape errors by right-padding.
        if original_samples > 0 and min_segment_samples > 0 and original_samples < min_segment_samples:
            wav = torch_module.nn.functional.pad(wav, (0, int(min_segment_samples - original_samples)))
        ref = wav.mean(0)
        ref_mean = ref.mean()
        ref_std = ref.std()
        safe_std = ref_std if float(ref_std) > 1e-6 else torch_module.tensor(1.0, dtype=wav.dtype, device=wav.device)
        wav = (wav - ref_mean) / safe_std
        with torch_module.inference_mode():
            try:
                sources = apply_model_fn(
                    model,
                    wav[None],
                    device=runtime_device,
                    shifts=1,
                    split=True,
                    overlap=DEMUCS_OVERLAP,
                    progress=False,
                    num_workers=0,
                    segment=DEMUCS_SEGMENT_SEC,
                )[0]
            except Exception as exc:  # noqa: BLE001
                message = str(exc or "").lower()
                if "shape" in message and "invalid" in message:
                    sources = apply_model_fn(
                        model,
                        wav[None],
                        device=runtime_device,
                        shifts=1,
                        split=False,
                        overlap=DEMUCS_OVERLAP,
                        progress=False,
                        num_workers=0,
                        segment=None,
                    )[0]
                else:
                    raise
        sources = sources * safe_std + ref_mean
        if original_samples > 0 and int(getattr(sources, "shape", [0, 0, 0])[-1]) > original_samples:
            sources = sources[..., :original_samples]

        source_names = [str(name) for name in getattr(model, "sources", [])]
        if "vocals" not in source_names:
            raise RuntimeError(f"Model '{safe_model}' does not expose a vocals stem.")
        vocals_index = source_names.index("vocals")
        vocals_tensor = sources[vocals_index]
        background_tensor = torch_module.zeros_like(vocals_tensor)
        for idx, source_name in enumerate(source_names):
            if idx == vocals_index or source_name == "vocals":
                continue
            background_tensor += sources[idx]

        vocals_raw = temp_dir / "vocals_raw.wav"
        background_raw = temp_dir / "background_raw.wav"
        soundfile_module.write(
            str(vocals_raw),
            vocals_tensor.detach().cpu().transpose(0, 1).numpy(),
            model.samplerate,
            subtype="PCM_16",
        )
        soundfile_module.write(
            str(background_raw),
            background_tensor.detach().cpu().transpose(0, 1).numpy(),
            model.samplerate,
            subtype="PCM_16",
        )

        vocals_final = temp_dir / "vocals.wav"
        background_final = temp_dir / "background.wav"
        _ffmpeg_convert_to_wav(
            vocals_raw,
            vocals_final,
            sample_rate=OUTPUT_SAMPLE_RATE,
            channels=1,
        )
        _ffmpeg_convert_to_wav(
            background_raw,
            background_final,
            sample_rate=OUTPUT_SAMPLE_RATE,
            channels=2,
        )

        vocals_bytes = vocals_final.read_bytes()
        background_bytes = background_final.read_bytes()
        cache_dir.mkdir(parents=True, exist_ok=True)
        vocals_cached.write_bytes(vocals_bytes)
        background_cached.write_bytes(background_bytes)
        duration_sec = _wav_duration_sec(vocals_bytes)
        runtime_meta = {
            "cacheHit": False,
            "cacheKey": cache_key,
            "durationSec": duration_sec,
            "device": runtime_device,
        }
        return vocals_bytes, background_bytes, runtime_meta
    finally:
        if str(runtime_device).lower().startswith("cuda"):
            try:
                torch_module.cuda.empty_cache()
            except Exception:
                pass
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


class SeparationRequest(BaseModel):
    sourceAudioBase64: str = Field(default="", min_length=1, max_length=30_000_000)
    sourceAudioName: str = Field(default="source.wav", max_length=256)
    sourceSeparationModel: str = Field(default=SEPARATION_MODEL_DEFAULT, max_length=64)
    sourceSeparationDevice: str = Field(default=SEPARATION_DEVICE_DEFAULT, max_length=32)
    sourceTrimStartSec: float | None = Field(default=None, ge=0.0)
    sourceTrimEndSec: float | None = Field(default=None, ge=0.0)
    requestId: str = Field(default="", max_length=128)
    traceId: str = Field(default="", max_length=128)
    uid: str = Field(default="", max_length=256)


api = FastAPI(title=APP_NAME, version="1.0.0")


@api.on_event("startup")
async def _startup_probe() -> None:
    try:
        torch_module = _get_torch()
        _get_soundfile()
        _get_demucs_runtime()
        cuda_available = bool(getattr(torch_module.cuda, "is_available", lambda: False)())
        warm_device = _resolve_device(SEPARATION_DEVICE_DEFAULT, torch_module=torch_module)
        _load_demucs_model(SEPARATION_MODEL_DEFAULT, device=warm_device)
        _mark_startup_state(
            ok=True,
            error="",
            dependency_status="ready_warmed" if cuda_available else "ready_cpu_fallback",
        )
    except Exception as exc:  # noqa: BLE001
        _mark_startup_state(ok=False, error=str(exc), dependency_status="degraded")


@api.middleware("http")
async def _auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    if request.url.path in {"/health", "/v1/capabilities", "/v1/separate"}:
        try:
            _require_runtime_token(request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)


@api.get("/health")
def health() -> JSONResponse:
    diagnostics = _runtime_diagnostics(include_gpu_probe=True)
    return JSONResponse(
        {
            "ok": True,
            "state": "online" if diagnostics.get("startupOk") else "degraded",
            "detail": "Modal demucs runtime ready." if diagnostics.get("startupOk") else "Modal demucs runtime started with warnings.",
            "engine": RUNTIME_ENGINE,
            "provider": RUNTIME_PROVIDER,
            "device": "cuda" if diagnostics.get("cudaAvailable") else "cpu",
            "warm": bool(diagnostics.get("startupOk")),
            "diagnostics": diagnostics,
        }
    )


@api.get("/v1/capabilities")
def capabilities() -> JSONResponse:
    diagnostics = _runtime_diagnostics(include_gpu_probe=False)
    return JSONResponse(
        {
            "ok": True,
            "ready": bool(diagnostics.get("cudaAvailable")) or bool(diagnostics.get("startupOk")),
            "engine": RUNTIME_ENGINE,
            "provider": RUNTIME_PROVIDER,
            "supportsVC": False,
            "supportsTTS": False,
            "supportsTTSVC": False,
            "supportsSeparation": True,
            "diagnostics": diagnostics,
            "metadata": {
                "defaultModel": SEPARATION_MODEL_DEFAULT,
                "defaultDevice": SEPARATION_DEVICE_DEFAULT,
                "sampleRate": OUTPUT_SAMPLE_RATE,
                "maxAudioBytes": MAX_AUDIO_BYTES,
                "gpu": MODAL_GPU_FALLBACKS,
                "containerIdleTimeoutSec": MODAL_CONTAINER_IDLE_TIMEOUT_SEC,
                "scaledownWindowSec": MODAL_SCALEDOWN_WINDOW_SEC,
                "retries": MODAL_GPU_RETRIES,
                "maxContainers": MODAL_MAX_CONTAINERS,
                "minContainers": MODAL_MIN_CONTAINERS,
                "concurrency": MODAL_CONCURRENCY,
            },
        }
    )


@api.post("/v1/separate")
def separate(payload: SeparationRequest, request: Request) -> JSONResponse:
    _ = request
    source_audio_bytes = _decode_audio_base64(payload.sourceAudioBase64)
    if not source_audio_bytes:
        raise HTTPException(status_code=400, detail="Source audio is required.")
    if len(source_audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Source audio payload exceeds the maximum allowed size.")

    trim_start = payload.sourceTrimStartSec if payload.sourceTrimStartSec is not None else None
    trim_end = payload.sourceTrimEndSec if payload.sourceTrimEndSec is not None else None
    if trim_start is not None and trim_end is not None and trim_end <= trim_start:
        raise HTTPException(status_code=400, detail="sourceTrimEndSec must be greater than sourceTrimStartSec.")

    request_id = str(payload.requestId or "").strip() or f"sep_{int(time.time() * 1000)}"
    trace_id = str(payload.traceId or "").strip() or request_id

    if FORCE_GPU:
        runtime_device_hint = _resolve_device(payload.sourceSeparationDevice)
        if not str(runtime_device_hint).startswith("cuda"):
            raise HTTPException(
                status_code=503,
                detail="GPU is required for source separation but CUDA is unavailable in the runtime.",
            )

    started_at = time.perf_counter()
    try:
        vocals_bytes, background_bytes, runtime_meta = _separate_audio_with_demucs(
            source_audio_bytes=source_audio_bytes,
            source_audio_name=payload.sourceAudioName,
            model_name=payload.sourceSeparationModel,
            device_preference=payload.sourceSeparationDevice,
            trim_start_sec=trim_start,
            trim_end_sec=trim_end,
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        message = str(exc)
        if "cuda out of memory" in message.lower() or "out of memory" in message.lower():
            raise HTTPException(status_code=503, detail=f"Demucs GPU memory pressure: {message[:400]}") from exc
        raise HTTPException(status_code=503, detail=f"Demucs separation failed: {message[:400]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", errors="replace")[:600]
        raise HTTPException(status_code=422, detail=f"Audio preprocessing failed: {detail or exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Demucs separation failed: {exc}") from exc
    elapsed_ms = max(1, int((time.perf_counter() - started_at) * 1000))

    runtime_device = str(runtime_meta.get("device") or _resolve_device(payload.sourceSeparationDevice)).strip()
    duration_sec = max(0.0, _safe_float(runtime_meta.get("durationSec"), 0.0))
    notes = ["source_audio_vocals_extracted_demucs_modal"]
    if runtime_device.startswith("cuda"):
        notes.append("source_audio_vocals_extracted_demucs_gpu")
    elif runtime_device.startswith("cpu"):
        notes.append("source_audio_vocals_extracted_demucs_cpu_fallback")
    if bool(runtime_meta.get("cacheHit")):
        notes.append("source_audio_vocals_extracted_demucs_cache_hit")

    response_payload = {
        "ok": True,
        "status": "completed",
        "requestId": request_id,
        "traceId": trace_id,
        "sourceAudioName": str(payload.sourceAudioName or "source.wav").strip() or "source.wav",
        "timings": {
            "sourceSeparationMs": elapsed_ms,
            "totalMs": elapsed_ms,
        },
        "runtime": {
            "sourceSeparation": {
                "enabled": True,
                "pipeline": "demucs",
                "model": str(payload.sourceSeparationModel or "").strip() or SEPARATION_MODEL_DEFAULT,
                "device": runtime_device,
                "cacheKey": str(runtime_meta.get("cacheKey") or "").strip(),
                "timeoutSec": int(REQUEST_TIMEOUT_SEC),
                "trimApplied": bool(trim_start is not None and trim_end is not None),
                "durationSec": round(duration_sec, 6),
                "provider": "modal",
                "providerLabel": "modal-runtime",
                "gpuRequested": MODAL_GPU_FALLBACKS,
            }
        },
        "vocalsAudioBase64": _encode_audio_base64(vocals_bytes),
        "backgroundAudioBase64": _encode_audio_base64(background_bytes),
        "notes": notes,
        "message": "",
        "diagnostics": _runtime_diagnostics(include_gpu_probe=False),
    }
    if trim_start is not None and trim_end is not None and trim_end > trim_start:
        response_payload["runtime"]["sourceSeparation"]["trimStartSec"] = float(trim_start)
        response_payload["runtime"]["sourceSeparation"]["trimEndSec"] = float(trim_end)
        response_payload["runtime"]["sourceSeparation"]["trimWindowKey"] = f"{int(round(trim_start * 1000.0))}:{int(round(trim_end * 1000.0))}"
    return JSONResponse(response_payload)


@app.function(
    image=image,
    cpu=4.0,
    memory=24576,
    gpu=MODAL_GPU_FALLBACKS,
    max_containers=MODAL_MAX_CONTAINERS,
    min_containers=MODAL_MIN_CONTAINERS,
    scaledown_window=MODAL_SCALEDOWN_WINDOW_SEC,
    startup_timeout=MODAL_STARTUP_TIMEOUT_SEC,
    timeout=MODAL_FUNCTION_TIMEOUT_SEC,
)
@modal.concurrent(max_inputs=MODAL_CONCURRENCY)
@modal.asgi_app()
def fastapi_app():
    return api


@app.local_entrypoint()
def main() -> None:
    print(f"{APP_NAME}: deploy with `modal deploy backend/engines/modal-openvoice/separation_runtime_modal.py`")
