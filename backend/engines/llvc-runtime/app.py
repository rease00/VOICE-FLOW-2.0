from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

APP_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = Path(os.getenv("VF_LLVC_MODELS_DIR", str(APP_ROOT / "models" / "llvc"))).resolve()
REGISTRY_FILE = Path(
    os.getenv("VF_LLVC_MODEL_REGISTRY_FILE", str(APP_ROOT / "config" / "llvc_model_registry.json"))
).resolve()
LLVC_DEVICE = str(os.getenv("VF_LLVC_DEVICE") or "cpu").strip() or "cpu"
LLVC_PRESET_DEFAULT = str(os.getenv("VF_LLVC_PRESET_DEFAULT") or "llvc_hq_cpu").strip() or "llvc_hq_cpu"
LLVC_STREAM_DEFAULT = (
    str(os.getenv("VF_LLVC_STREAM_DEFAULT") or "0").strip().lower() in {"1", "true", "yes", "on"}
)
LLVC_CHUNK_FACTOR = max(1, int((os.getenv("VF_LLVC_CHUNK_FACTOR") or "2").strip() or "2"))

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

MODELS_DIR.mkdir(parents=True, exist_ok=True)
REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)


class LoadLlvcModelRequest(BaseModel):
    modelName: str


class RegistryModel(BaseModel):
    id: str
    checkpointPath: str = ""
    configPath: str = ""
    sampleRate: int = 40000
    qualityTier: str = "hq"
    enabled: bool = True


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
        if "llvc_hq_cpu" in models:
            preferred = "llvc_hq_cpu"
        elif "llvc_default" in models:
            preferred = "llvc_default"
        elif models:
            preferred = sorted(models.keys())[0]

        if preferred and self._current_model not in models:
            self._current_model = preferred

    def list_models(self) -> list[str]:
        return sorted(self._models.keys())

    def current_model(self) -> Optional[str]:
        return self._current_model

    def default_model(self) -> Optional[str]:
        if "llvc_hq_cpu" in self._models:
            return "llvc_hq_cpu"
        if "llvc_default" in self._models:
            return "llvc_default"
        keys = self.list_models()
        return keys[0] if keys else None

    def load_model(self, model_name: str) -> str:
        model_id = str(model_name or "").strip()
        if not model_id:
            raise RuntimeError("llvc_model_required")
        if model_id not in self._models:
            raise RuntimeError(f"unknown_llvc_model:{model_id}")
        self._current_model = model_id
        return model_id

    def get_model(self, model_name: Optional[str]) -> RegistryModel:
        model_id = str(model_name or "").strip() or str(self._current_model or "").strip()
        if not model_id:
            default_id = self.default_model()
            if not default_id:
                raise RuntimeError("llvc_models_empty")
            model_id = default_id
        if model_id not in self._models:
            raise RuntimeError(f"unknown_llvc_model:{model_id}")
        return self._models[model_id]

    def diagnostics(self) -> dict[str, Any]:
        return {
            "registryFile": str(REGISTRY_FILE),
            "modelCount": len(self._models),
            "currentModel": self._current_model,
            "defaultModel": self.default_model(),
            "error": self._last_error,
        }


def _resolve_registry_path(raw_path: str) -> Optional[Path]:
    token = str(raw_path or "").strip()
    if not token:
        return None
    path = Path(token)
    if not path.is_absolute():
        path = (APP_ROOT / path).resolve()
    return path


llvc_registry = LlvcRegistry()


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


def _build_atempo_filter_chain(rate: float) -> str:
    safe_rate = max(0.25, min(4.0, float(rate)))
    chunks: list[str] = []
    while safe_rate > 2.0:
        chunks.append("atempo=2.0")
        safe_rate /= 2.0
    while safe_rate < 0.5:
        chunks.append("atempo=0.5")
        safe_rate /= 0.5
    chunks.append(f"atempo={safe_rate:.6f}")
    return ",".join(chunks)


def _normalize_preset(raw: str) -> str:
    token = str(raw or "").strip().lower()
    if token in {"llvc_hq_cpu", "cover_hq", "cover", "hq"}:
        return "llvc_hq_cpu"
    if token in {"tts_realtime", "live"}:
        return "tts_realtime"
    return LLVC_PRESET_DEFAULT


def _apply_llvc_quality_filter(
    input_wav: str,
    output_wav: str,
    *,
    sample_rate: int,
    pitch_shift: int,
    preset: str,
) -> None:
    ffmpeg = _get_ffmpeg_path()
    shift = max(-12, min(12, int(pitch_shift)))
    pitch_factor = pow(2.0, shift / 12.0)
    atempo = _build_atempo_filter_chain(1.0 / pitch_factor)

    if preset == "llvc_hq_cpu":
        audio_filter = (
            f"asetrate={sample_rate * pitch_factor:.4f},"
            f"aresample={sample_rate},"
            f"{atempo},"
            "highpass=f=65,"
            "lowpass=f=14500,"
            "equalizer=f=140:t=q:w=0.8:g=1.5,"
            "equalizer=f=2800:t=q:w=1.1:g=1.8,"
            "equalizer=f=6400:t=q:w=1.0:g=1.2,"
            "acompressor=threshold=-16dB:ratio=2.1:attack=8:release=120"
        )
    else:
        audio_filter = (
            f"asetrate={sample_rate * pitch_factor:.4f},"
            f"aresample={sample_rate},"
            f"{atempo},"
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
        timeout=120,
    )


app = FastAPI(title="VoiceFlow LLVC Runtime", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS"),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> JSONResponse:
    llvc_registry.reload()
    models = llvc_registry.list_models()
    current_model = llvc_registry.current_model() or llvc_registry.default_model()
    diagnostics = llvc_registry.diagnostics()
    ok = len(models) > 0 and bool(current_model)

    return JSONResponse(
        {
            "ok": ok,
            "runtime": "llvc-runtime",
            "llvc": {
                "available": ok,
                "detail": "llvc_ready" if ok else "llvc_unavailable",
                "currentModel": current_model,
                "models": models,
                "modelsDir": str(MODELS_DIR),
                "registryFile": str(REGISTRY_FILE),
                "device": LLVC_DEVICE,
                "fallbackAvailable": False,
                "fallbackModel": None,
                "error": diagnostics.get("error"),
                "streamDefault": LLVC_STREAM_DEFAULT,
                "chunkFactor": LLVC_CHUNK_FACTOR,
            },
        }
    )


@app.get("/v1/health")
def v1_health() -> JSONResponse:
    return health()


@app.get("/v1/models")
def list_models() -> JSONResponse:
    llvc_registry.reload()
    models = llvc_registry.list_models()
    current_model = llvc_registry.current_model() or llvc_registry.default_model()
    registry_rows = []
    for model_id in models:
        model = llvc_registry.get_model(model_id)
        registry_rows.append(
            {
                "id": model.id,
                "sampleRate": int(model.sampleRate or 40000),
                "qualityTier": model.qualityTier,
                "enabled": bool(model.enabled),
            }
        )
    return JSONResponse(
        {
            "ok": True,
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
        model = llvc_registry.get_model(current_model)
        checkpoint = _resolve_registry_path(model.checkpointPath)
        config = _resolve_registry_path(model.configPath)
        if checkpoint and not checkpoint.exists():
            raise RuntimeError(f"llvc_checkpoint_missing:{checkpoint}")
        if config and not config.exists():
            raise RuntimeError(f"llvc_config_missing:{config}")
    except RuntimeError as exc:
        detail = str(exc)
        if detail.startswith("unknown_llvc_model:"):
            raise HTTPException(status_code=400, detail=detail) from exc
        raise HTTPException(status_code=503, detail=detail) from exc
    return JSONResponse({"ok": True, "currentModel": current_model})


@app.post("/v1/convert")
async def convert(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form(...),
    preset: str = Form("llvc_hq_cpu"),
    pitch_shift: int = Form(0),
    index_rate: Optional[float] = Form(None),
    filter_radius: Optional[int] = Form(None),
    rms_mix_rate: Optional[float] = Form(None),
    protect: Optional[float] = Form(None),
    f0_method: Optional[str] = Form(None),
) -> FileResponse:
    _ = index_rate
    _ = filter_radius
    _ = rms_mix_rate
    _ = protect
    _ = f0_method

    llvc_registry.reload()
    try:
        model = llvc_registry.get_model(model_name)
    except RuntimeError as exc:
        detail = str(exc)
        if detail.startswith("unknown_llvc_model:"):
            raise HTTPException(status_code=400, detail=detail) from exc
        raise HTTPException(status_code=503, detail=detail) from exc
    checkpoint = _resolve_registry_path(model.checkpointPath)
    config = _resolve_registry_path(model.configPath)
    if checkpoint and not checkpoint.exists():
        raise HTTPException(status_code=503, detail=f"llvc_checkpoint_missing:{checkpoint}")
    if config and not config.exists():
        raise HTTPException(status_code=503, detail=f"llvc_config_missing:{config}")

    safe_preset = _normalize_preset(preset)
    sample_rate = max(8000, int(model.sampleRate or 40000))

    temp_dir = tempfile.mkdtemp(prefix="vf_llvc_rt_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source_audio")
    # Keep normalized file name distinct from upload name to avoid FFmpeg in-place edit failures.
    normalized_wav = Path(temp_dir) / "normalized_input.wav"
    output_path = Path(temp_dir) / "output.wav"

    try:
        with source_path.open("wb") as f:
            f.write(await file.read())

        _convert_media_to_wav(str(source_path), str(normalized_wav), sample_rate=sample_rate)
        _apply_llvc_quality_filter(
            str(normalized_wav),
            str(output_path),
            sample_rate=sample_rate,
            pitch_shift=int(pitch_shift),
            preset=safe_preset,
        )
    except HTTPException:
        _cleanup_paths(temp_dir)
        raise
    except Exception as exc:
        _cleanup_paths(temp_dir)
        raise HTTPException(status_code=500, detail=f"LLVC conversion failed: {exc}") from exc

    background_tasks.add_task(_cleanup_paths, temp_dir)
    safe_model = _safe_upload_name(model.id, "model")
    return FileResponse(
        str(output_path),
        media_type="audio/wav",
        filename=f"llvc_{safe_model}.wav",
        headers={
            "x-vf-llvc-runtime": "1",
            "x-vf-llvc-preset": safe_preset,
            "x-vf-llvc-model": safe_model,
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VF_LLVC_RUNTIME_HOST", "127.0.0.1")
    port = int(os.getenv("VF_LLVC_RUNTIME_PORT", "7830"))
    uvicorn.run(app, host=host, port=port, reload=False)
