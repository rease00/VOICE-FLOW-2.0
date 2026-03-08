from __future__ import annotations

from contextlib import asynccontextmanager
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

RUNTIME_DIR = Path(__file__).resolve().parent
if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

from w_okada_runtime import WOkadaOnnxRuntime

APP_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = Path(os.getenv("VF_VOICE_TRANSFER_MODELS_DIR", str(APP_ROOT / "models" / "voice-transfer"))).resolve()
REGISTRY_FILE = Path(
    os.getenv("VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE", str(APP_ROOT / "config" / "voice_transfer_model_registry.json"))
).resolve()
LLVC_DEVICE = str(os.getenv("VF_VOICE_TRANSFER_DEVICE") or "cpu").strip() or "cpu"
LLVC_PRESET_DEFAULT = (
    str(os.getenv("VF_VOICE_TRANSFER_PRESET_DEFAULT") or "auto_cpu").strip()
    or "auto_cpu"
)
LLVC_AUTO_HQ_MAX_MS = max(
    1000,
    int((os.getenv("VF_VOICE_TRANSFER_AUTO_HQ_MAX_MS") or "8000").strip() or "8000"),
)
LLVC_STREAM_DEFAULT = (
    str(os.getenv("VF_VOICE_TRANSFER_STREAM_DEFAULT") or "0").strip().lower() in {"1", "true", "yes", "on"}
)
LLVC_EXTRA_CONVERT_SIZE = max(
    128,
    int(
        (
            os.getenv("VF_VOICE_TRANSFER_EXTRA_CONVERT_SIZE")
            or os.getenv("VF_VOICE_TRANSFER_CHUNK_FACTOR")
            or "256"
        ).strip()
        or "256"
    ),
)
LLVC_BACKEND_MODE = "onnx"
LLVC_ONNX_PROVIDER = str(os.getenv("VF_VOICE_TRANSFER_ONNX_PROVIDER") or "auto").strip().lower() or "auto"

LLVC_RESOLVED_DEFAULT_MODEL_ID = str(os.getenv("VF_LLVC_RESOLVED_DEFAULT_MODEL_ID") or "f_8312_32k-325").strip() or "f_8312_32k-325"
LLVC_RESOLVED_DEFAULT_CHECKPOINT = (
    str(os.getenv("VF_LLVC_RESOLVED_DEFAULT_CHECKPOINT") or "models/rvc/f_8312_32k-325.pth").strip()
    or "models/rvc/f_8312_32k-325.pth"
)
LLVC_RESOLVED_DEFAULT_INDEX = (
    str(os.getenv("VF_LLVC_RESOLVED_DEFAULT_INDEX") or "models/rvc/f_8312_32k-325.index").strip()
    or "models/rvc/f_8312_32k-325.index"
)
LLVC_RESOLVED_DEFAULT_EMBEDDER = (
    str(os.getenv("VF_LLVC_RESOLVED_DEFAULT_EMBEDDER") or "models/embeddings/checkpoint_best_legacy_500.pt").strip()
    or "models/embeddings/checkpoint_best_legacy_500.pt"
)
LLVC_RESOLVED_DEFAULT_F0 = (
    str(os.getenv("VF_LLVC_RESOLVED_DEFAULT_F0") or "models/f0/rmvpe.pt").strip()
    or "models/f0/rmvpe.pt"
)

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
LOCALHOST_CORS_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$"

MODELS_DIR.mkdir(parents=True, exist_ok=True)
REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)


class LoadLlvcModelRequest(BaseModel):
    modelName: str


class RegistryModel(BaseModel):
    id: str
    checkpointPath: str = ""
    indexPath: str = ""
    configPath: str = ""
    embedderPath: str = ""
    f0ModelPath: str = ""
    resolvedModelId: str = ""
    sampleRate: int = 32000
    qualityTier: str = "hq"
    enabled: bool = True


@dataclass(frozen=True)
class ResolvedModelAssets:
    model_id: str
    resolved_model_id: str
    checkpoint_path: Path
    index_path: Optional[Path]
    embedder_path: Path
    f0_path: Path
    sample_rate: int


def _resolve_registry_path(raw_path: str, *, base_dir: Path = MODELS_DIR) -> Optional[Path]:
    token = str(raw_path or "").strip()
    if not token:
        return None
    path = Path(token)
    if path.is_absolute():
        return path.resolve()

    candidates = [
        (base_dir / path).resolve(),
        (APP_ROOT / path).resolve(),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


class LlvcRegistry:
    def __init__(self) -> None:
        self._models: dict[str, RegistryModel] = {}
        self._current_model: Optional[str] = None
        self._last_error: Optional[str] = None
        self.reload()

    def reload(self) -> None:
        payload: dict[str, Any] = {}
        try:
            if REGISTRY_FILE.exists():
                raw = REGISTRY_FILE.read_text(encoding="utf-8").replace("\ufeff", "")
                parsed = json.loads(raw) if raw.strip() else {}
                payload = parsed if isinstance(parsed, dict) else {}
        except Exception as exc:
            self._models = {}
            self._last_error = f"registry_parse_failed: {exc}"
            return

        model_items = payload.get("models") if isinstance(payload.get("models"), list) else []
        models: dict[str, RegistryModel] = {}
        for item in model_items:
            if not isinstance(item, dict):
                continue
            try:
                model = RegistryModel(**item)
            except Exception:
                continue
            model_id = str(model.id or "").strip()
            if not model_id or not model.enabled:
                continue
            models[model_id] = model

        self._models = models
        self._last_error = None

        preferred = ""
        if "voice_transfer_hq_cpu" in models:
            preferred = "voice_transfer_hq_cpu"
        elif "voice_transfer_default" in models:
            preferred = "voice_transfer_default"
        elif models:
            preferred = sorted(models.keys())[0]

        if preferred and self._current_model not in models:
            self._current_model = preferred

    def list_models(self) -> list[str]:
        default_id = self.default_model()
        return [default_id] if default_id else []

    def current_model(self) -> Optional[str]:
        return self._current_model

    def default_model(self) -> Optional[str]:
        if "voice_transfer_hq_cpu" in self._models:
            return "voice_transfer_hq_cpu"
        if "voice_transfer_default" in self._models:
            return "voice_transfer_default"
        keys = self.list_models()
        return keys[0] if keys else None

    def load_model(self, model_name: str) -> str:
        if not str(model_name or "").strip():
            raise RuntimeError("llvc_model_required")
        model_id = self.default_model()
        if not model_id:
            raise RuntimeError("llvc_models_empty")
        self._current_model = model_id
        return model_id

    def get_model(self, model_name: Optional[str]) -> RegistryModel:
        default_id = self.default_model()
        if not default_id:
            raise RuntimeError("llvc_models_empty")
        model_id = str(model_name or "").strip() or str(self._current_model or "").strip()
        if model_id in self._models:
            return self._models[model_id]
        return self._models[default_id]

    def resolve_runtime_assets(self, model_name: Optional[str]) -> ResolvedModelAssets:
        model = self.get_model(model_name)
        resolved_model_id = str(model.resolvedModelId or "").strip() or LLVC_RESOLVED_DEFAULT_MODEL_ID

        checkpoint_token = str(model.checkpointPath or "").strip() or LLVC_RESOLVED_DEFAULT_CHECKPOINT
        checkpoint_path = _resolve_registry_path(checkpoint_token)
        if checkpoint_path is None:
            raise RuntimeError("llvc_checkpoint_missing")

        index_token = str(model.indexPath or "").strip() or LLVC_RESOLVED_DEFAULT_INDEX
        index_path = _resolve_registry_path(index_token)
        if index_path is not None and not index_path.exists():
            index_path = None

        embedder_token = str(model.embedderPath or "").strip() or LLVC_RESOLVED_DEFAULT_EMBEDDER
        embedder_path = _resolve_registry_path(embedder_token)
        if embedder_path is None:
            raise RuntimeError("llvc_embedder_missing")

        f0_token = str(model.f0ModelPath or "").strip() or LLVC_RESOLVED_DEFAULT_F0
        f0_path = _resolve_registry_path(f0_token)
        if f0_path is None:
            raise RuntimeError("llvc_f0_model_missing")

        if not checkpoint_path.exists():
            raise RuntimeError(f"llvc_checkpoint_missing:{checkpoint_path}")
        if not embedder_path.exists():
            raise RuntimeError(f"llvc_embedder_missing:{embedder_path}")
        if not f0_path.exists():
            raise RuntimeError(f"llvc_f0_model_missing:{f0_path}")

        sample_rate = max(16000, int(model.sampleRate or 32000))
        return ResolvedModelAssets(
            model_id=str(model.id),
            resolved_model_id=resolved_model_id,
            checkpoint_path=checkpoint_path,
            index_path=index_path,
            embedder_path=embedder_path,
            f0_path=f0_path,
            sample_rate=sample_rate,
        )

    def diagnostics(self) -> dict[str, Any]:
        return {
            "registryFile": str(REGISTRY_FILE),
            "modelCount": len(self._models),
            "currentModel": self._current_model,
            "defaultModel": self.default_model(),
            "error": self._last_error,
        }

def _normalize_backend_mode(raw: str) -> str:
    _ = raw
    return "onnx"


llvc_registry = LlvcRegistry()


svc_runtime = WOkadaOnnxRuntime(
    models_dir=MODELS_DIR,
    device_token=LLVC_DEVICE,
    default_backend_mode=_normalize_backend_mode(LLVC_BACKEND_MODE),
)
_LLVC_WARMUP_LOCK = threading.Lock()
_LLVC_WARMUP_THREAD: Optional[threading.Thread] = None
_LLVC_WARMUP_STARTED_AT_MS = 0
_LLVC_WARMUP_COMPLETED_AT_MS = 0
_LLVC_WARMUP_ERROR: Optional[str] = None
_LLVC_WARMUP_READY = False


def _now_ms() -> int:
    return int(time.time() * 1000)


def _llvc_runtime_loaded() -> bool:
    return bool(getattr(svc_runtime, "_active_signature", None))


def _run_llvc_warmup() -> None:
    global _LLVC_WARMUP_THREAD, _LLVC_WARMUP_STARTED_AT_MS, _LLVC_WARMUP_COMPLETED_AT_MS
    global _LLVC_WARMUP_ERROR, _LLVC_WARMUP_READY

    try:
        llvc_registry.reload()
        current_model = llvc_registry.current_model() or llvc_registry.default_model()
        if not current_model:
            raise RuntimeError("llvc_models_empty")
        assets = llvc_registry.resolve_runtime_assets(current_model)
        svc_runtime.ensure_loaded(assets=assets)
        _LLVC_WARMUP_READY = True
        _LLVC_WARMUP_ERROR = None
    except Exception as exc:
        _LLVC_WARMUP_READY = False
        _LLVC_WARMUP_ERROR = str(exc)
    finally:
        _LLVC_WARMUP_COMPLETED_AT_MS = _now_ms()
        with _LLVC_WARMUP_LOCK:
            _LLVC_WARMUP_THREAD = None


def _schedule_llvc_warmup(*, force: bool = False) -> bool:
    global _LLVC_WARMUP_THREAD, _LLVC_WARMUP_STARTED_AT_MS, _LLVC_WARMUP_READY, _LLVC_WARMUP_ERROR

    with _LLVC_WARMUP_LOCK:
        if _LLVC_WARMUP_THREAD is not None and _LLVC_WARMUP_THREAD.is_alive():
            return False
        if not force and (_llvc_runtime_loaded() or _LLVC_WARMUP_READY):
            return False
        _LLVC_WARMUP_STARTED_AT_MS = _now_ms()
        _LLVC_WARMUP_ERROR = None
        if force:
            _LLVC_WARMUP_READY = False
        thread = threading.Thread(
            target=_run_llvc_warmup,
            name="voice-transfer-runtime-warmup",
            daemon=True,
        )
        _LLVC_WARMUP_THREAD = thread
        thread.start()
        return True


def _llvc_warmup_in_flight() -> bool:
    with _LLVC_WARMUP_LOCK:
        return _LLVC_WARMUP_THREAD is not None and _LLVC_WARMUP_THREAD.is_alive()


def _parse_cors_origins(env_var: str) -> list[str]:
    raw = (os.getenv(env_var) or "").strip()
    if not raw:
        return DEFAULT_CORS_ORIGINS
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or DEFAULT_CORS_ORIGINS


def _safe_upload_name(filename: Optional[str], fallback: str) -> str:
    if not filename:
        return fallback
    base = Path(filename).name.strip()
    if not base:
        return fallback
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in base)
    safe = safe.lstrip(".")
    return (safe[:128] if safe else fallback)


def _cleanup_paths(*paths: str) -> None:
    for raw in paths:
        if not raw:
            continue
        try:
            path = Path(raw)
            if path.is_file():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
        except Exception:
            pass


def _run(cmd: list[str], *, timeout: Optional[int] = None) -> None:
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"Command failed: {' '.join(cmd)}")


def _get_ffmpeg_path() -> str:
    env_ffmpeg = os.getenv("VF_FFMPEG_PATH")
    if env_ffmpeg:
        return env_ffmpeg

    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            return ffmpeg

    raise RuntimeError("FFmpeg binary not found. Install imageio-ffmpeg dependency or set VF_FFMPEG_PATH.")


def _convert_media_to_wav(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1) -> None:
    try:
        with wave.open(input_path, "rb") as handle:
            if (
                int(handle.getnchannels()) == max(1, int(channels))
                and int(handle.getframerate()) == max(8000, int(sample_rate))
                and int(handle.getsampwidth()) == 2
                and str(handle.getcomptype() or "").upper() == "NONE"
            ):
                shutil.copy2(input_path, output_path)
                return
    except Exception:
        pass

    ffmpeg = _get_ffmpeg_path()
    _run(
        [
            ffmpeg,
            "-y",
            "-i",
            input_path,
            "-vn",
            "-ac",
            str(max(1, int(channels))),
            "-ar",
            str(max(8000, int(sample_rate))),
            "-sample_fmt",
            "s16",
            output_path,
        ]
    )


def _normalize_preset(raw: str) -> str:
    token = str(raw or "").strip().lower().replace("-", "_")
    if token in {"voice_transfer_hq_cpu", "llvc_hq_cpu", "cover_hq", "cover", "hq"}:
        return "voice_transfer_hq_cpu"
    if token in {"tts_realtime", "live", "realtime"}:
        return "tts_realtime"
    if token in {"auto", "auto_cpu", "cpu_auto", "adaptive", "adaptive_cpu"}:
        return "auto_cpu"
    fallback = str(LLVC_PRESET_DEFAULT or "").strip().lower().replace("-", "_")
    if fallback in {"voice_transfer_hq_cpu", "llvc_hq_cpu", "cover_hq", "cover", "hq"}:
        return "voice_transfer_hq_cpu"
    if fallback in {"auto", "auto_cpu", "cpu_auto", "adaptive", "adaptive_cpu"}:
        return "auto_cpu"
    return "tts_realtime"


def _wav_duration_ms(path: str) -> int:
    with wave.open(path, "rb") as handle:
        frame_rate = int(handle.getframerate() or 0)
        frames = int(handle.getnframes() or 0)
    if frame_rate <= 0 or frames <= 0:
        return 0
    return int(round((float(frames) / float(frame_rate)) * 1000.0))


def _resolve_convert_preset(requested_preset: str, *, normalized_wav_path: str) -> tuple[str, int]:
    normalized_preset = _normalize_preset(requested_preset)
    if normalized_preset != "auto_cpu":
        return normalized_preset, 0
    duration_ms = 0
    try:
        duration_ms = _wav_duration_ms(normalized_wav_path)
    except Exception:
        duration_ms = 0
    if duration_ms >= int(LLVC_AUTO_HQ_MAX_MS):
        return "tts_realtime", duration_ms
    return "voice_transfer_hq_cpu", duration_ms


def _apply_llvc_mastering_filter(
    input_wav: str,
    output_wav: str,
    *,
    sample_rate: int,
    preset: str,
) -> None:
    if preset == "tts_realtime":
        shutil.copy2(input_wav, output_wav)
        return

    ffmpeg = _get_ffmpeg_path()

    if preset == "voice_transfer_hq_cpu":
        audio_filter = (
            "highpass=f=65,"
            "lowpass=f=14500,"
            "equalizer=f=140:t=q:w=0.8:g=1.2,"
            "equalizer=f=2800:t=q:w=1.1:g=1.4,"
            "equalizer=f=6400:t=q:w=1.0:g=1.0,"
            "acompressor=threshold=-16dB:ratio=2.1:attack=8:release=120"
        )
    else:
        audio_filter = (
            "highpass=f=70,"
            "lowpass=f=12000,"
            "acompressor=threshold=-14dB:ratio=2.0:attack=8:release=90"
        )

    _run(
        [
            ffmpeg,
            "-y",
            "-i",
            input_wav,
            "-vn",
            "-af",
            audio_filter,
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-sample_fmt",
            "s16",
            output_wav,
        ],
        timeout=180,
    )


@asynccontextmanager
async def _app_lifespan(_app: FastAPI):
    _schedule_llvc_warmup(force=True)
    yield


app = FastAPI(title="VoiceFlow Voice Transfer Runtime", version="2.0.0", lifespan=_app_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS"),
    allow_origin_regex=LOCALHOST_CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _health_payload() -> dict[str, Any]:
    llvc_registry.reload()
    models = llvc_registry.list_models()
    current_model = llvc_registry.current_model() or llvc_registry.default_model()
    diagnostics = llvc_registry.diagnostics()

    resolved_assets: Optional[ResolvedModelAssets] = None
    llvc_error = diagnostics.get("error")
    configured = bool(models and current_model)
    assets_ready = False
    runtime_loaded = _llvc_runtime_loaded() or _LLVC_WARMUP_READY

    if configured:
        try:
            resolved_assets = llvc_registry.resolve_runtime_assets(current_model)
            assets_ready = True
        except Exception as exc:
            llvc_error = str(exc)

    warmup_in_flight = _llvc_warmup_in_flight()
    if assets_ready and not runtime_loaded and not warmup_in_flight:
        _schedule_llvc_warmup()
        warmup_in_flight = _llvc_warmup_in_flight()

    if not llvc_error and _LLVC_WARMUP_ERROR:
        llvc_error = _LLVC_WARMUP_ERROR

    ready = bool(assets_ready and runtime_loaded)
    if ready:
        status = "ready"
    elif assets_ready and (warmup_in_flight or _LLVC_WARMUP_STARTED_AT_MS <= 0 or _LLVC_WARMUP_COMPLETED_AT_MS <= 0):
        status = "warming"
    elif configured:
        status = "degraded"
    else:
        status = "booting"

    payload = {
        "ok": True,
        "ready": ready,
        "status": status,
        "runtime": "voice-transfer-runtime",
        "voiceTransfer": {
            "available": configured,
            "ready": ready,
            "detail": "voice_transfer_ready" if ready else f"voice_transfer_{status}",
            "backendMode": svc_runtime.backend_mode(),
            "configuredBackendMode": svc_runtime.configured_backend_mode(),
            "currentModel": current_model,
            "resolvedModelId": resolved_assets.resolved_model_id if resolved_assets else None,
            "resolvedCheckpoint": str(resolved_assets.checkpoint_path) if resolved_assets else None,
            "models": models,
            "modelsDir": str(MODELS_DIR),
            "registryFile": str(REGISTRY_FILE),
            "device": LLVC_DEVICE,
            "fallbackAvailable": False,
            "fallbackModel": None,
            "error": llvc_error or svc_runtime.import_error,
            "streamDefault": LLVC_STREAM_DEFAULT,
            "chunkFactor": LLVC_EXTRA_CONVERT_SIZE,
            "extraConvertSize": LLVC_EXTRA_CONVERT_SIZE,
            "onnxProviderPreference": LLVC_ONNX_PROVIDER,
            "warmupInFlight": warmup_in_flight,
            "warmupStartedAtMs": _LLVC_WARMUP_STARTED_AT_MS or None,
            "warmupCompletedAtMs": _LLVC_WARMUP_COMPLETED_AT_MS or None,
        },
    }
    return payload


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(_health_payload())


@app.get("/v1/health")
def v1_health() -> JSONResponse:
    return JSONResponse(_health_payload())


@app.get("/v1/models")
def list_models() -> JSONResponse:
    llvc_registry.reload()
    models = llvc_registry.list_models()
    current_model = llvc_registry.current_model() or llvc_registry.default_model()
    registry_rows = []
    for model_id in models:
        model = llvc_registry.get_model(model_id)
        resolved_model_id = str(model.resolvedModelId or "").strip() or LLVC_RESOLVED_DEFAULT_MODEL_ID
        registry_rows.append(
            {
                "id": model.id,
                "resolvedModelId": resolved_model_id,
                "sampleRate": int(model.sampleRate or 32000),
                "qualityTier": model.qualityTier,
                "enabled": bool(model.enabled),
            }
        )
    return JSONResponse(
        {
            "ok": True,
            "backendMode": svc_runtime.backend_mode(),
            "configuredBackendMode": svc_runtime.configured_backend_mode(),
            "models": models,
            "currentModel": current_model,
            "defaultModel": llvc_registry.default_model(),
            "registryFile": str(REGISTRY_FILE),
            "registry": registry_rows,
        }
    )


@app.post("/v1/load-model")
def load_model(payload: LoadLlvcModelRequest) -> JSONResponse:
    llvc_registry.reload()
    try:
        current_model = llvc_registry.load_model(payload.modelName)
        assets = llvc_registry.resolve_runtime_assets(current_model)
        svc_runtime.ensure_loaded(assets=assets)
    except RuntimeError as exc:
        detail = str(exc)
        if detail.startswith("unknown_llvc_model:"):
            raise HTTPException(status_code=400, detail=detail) from exc
        raise HTTPException(status_code=503, detail=detail) from exc
    return JSONResponse(
        {
            "ok": True,
            "currentModel": current_model,
            "resolvedModelId": assets.resolved_model_id,
            "backendMode": svc_runtime.backend_mode(),
            "configuredBackendMode": svc_runtime.configured_backend_mode(),
        }
    )


@app.post("/v1/convert")
async def convert(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form(...),
    preset: str = Form("auto_cpu"),
    backend_mode: Optional[str] = Form(None),
    pitch_shift: int = Form(0),
    index_rate: Optional[float] = Form(None),
    filter_radius: Optional[int] = Form(None),
    rms_mix_rate: Optional[float] = Form(None),
    protect: Optional[float] = Form(None),
    f0_method: Optional[str] = Form(None),
) -> FileResponse:
    _ = filter_radius
    _ = rms_mix_rate
    _ = protect
    _ = backend_mode

    llvc_registry.reload()
    try:
        assets = llvc_registry.resolve_runtime_assets(model_name)
    except RuntimeError as exc:
        detail = str(exc)
        if detail.startswith("unknown_llvc_model:"):
            raise HTTPException(status_code=400, detail=detail) from exc
        raise HTTPException(status_code=503, detail=detail) from exc

    requested_preset = _normalize_preset(preset)
    sample_rate = max(16000, int(assets.sample_rate or 32000))

    temp_dir = tempfile.mkdtemp(prefix="vf_voice_transfer_rt_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source_audio")
    normalized_wav = Path(temp_dir) / "normalized_input.wav"
    converted_wav = Path(temp_dir) / "converted.wav"
    output_path = Path(temp_dir) / "output.wav"

    inference_meta: dict[str, Any] = {}
    safe_preset = requested_preset
    input_duration_ms = 0
    try:
        with source_path.open("wb") as handle:
            handle.write(await file.read())

        _convert_media_to_wav(str(source_path), str(normalized_wav), sample_rate=sample_rate)
        safe_preset, input_duration_ms = _resolve_convert_preset(
            requested_preset,
            normalized_wav_path=str(normalized_wav),
        )
        inference_meta = svc_runtime.convert(
            assets=assets,
            input_wav=str(normalized_wav),
            output_wav=str(converted_wav),
            pitch_shift=int(pitch_shift),
            f0_method=str(f0_method or "rmvpe"),
            index_rate=index_rate,
        )
        _apply_llvc_mastering_filter(
            str(converted_wav),
            str(output_path),
            sample_rate=sample_rate,
            preset=safe_preset,
        )
    except HTTPException:
        _cleanup_paths(temp_dir)
        raise
    except Exception as exc:
        _cleanup_paths(temp_dir)
        raise HTTPException(status_code=500, detail=f"Voice transfer failed: {exc}") from exc

    background_tasks.add_task(_cleanup_paths, temp_dir)
    safe_model = _safe_upload_name(str(assets.model_id), "model")
    safe_resolved = _safe_upload_name(str(inference_meta.get("resolvedModelId") or assets.resolved_model_id), "resolved")
    return FileResponse(
        str(output_path),
        media_type="audio/wav",
        filename=f"voice_transfer_{safe_model}.wav",
        headers={
            "x-vf-voice-transfer-runtime": "1",
            "x-vf-voice-transfer-preset": safe_preset,
            "x-vf-voice-transfer-preset-requested": requested_preset,
            "x-vf-voice-transfer-model": safe_model,
            "x-vf-voice-transfer-model-resolved": safe_resolved,
            "x-vf-voice-transfer-backend-mode": svc_runtime.backend_mode(),
            "x-vf-voice-transfer-index-used": "1" if bool(inference_meta.get("indexUsed")) else "0",
            "x-vf-voice-transfer-f0-method": str(inference_meta.get("f0Method") or "rmvpe"),
            "x-vf-voice-transfer-input-duration-ms": str(int(input_duration_ms)),
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VF_VOICE_TRANSFER_RUNTIME_HOST", "0.0.0.0")
    port = int((os.getenv("PORT") or os.getenv("VF_VOICE_TRANSFER_RUNTIME_PORT") or "7830").strip() or "7830")
    uvicorn.run(app, host=host, port=port, reload=False)
