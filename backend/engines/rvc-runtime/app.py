from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

APP_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = Path(os.getenv("VF_RVC_MODELS_DIR", str(APP_ROOT / "models" / "rvc"))).resolve()
RVC_DEVICE = os.getenv("VF_RVC_DEVICE", "cpu:0")
ENABLE_RVC_FALLBACK = (
    (os.getenv("VF_ENABLE_RVC_FALLBACK") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
RVC_FALLBACK_MODEL_ID = "vf_low_cpu_timbre"
DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

MODELS_DIR.mkdir(parents=True, exist_ok=True)


class LoadRvcModelRequest(BaseModel):
    modelName: str
    version: str = "v2"


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
    if not safe:
        return fallback
    return safe[:128]


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

    raise RuntimeError(
        "FFmpeg binary not found. Install imageio-ffmpeg dependency or set VF_FFMPEG_PATH."
    )


def _convert_media_to_wav(
    input_path: str,
    output_path: str,
    *,
    sample_rate: int = 44100,
    channels: int = 1,
) -> None:
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
            str(sample_rate),
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


def _convert_with_low_cpu_timbre(
    input_wav: str,
    output_wav: str,
    *,
    pitch_shift: int = 0,
    sample_rate: int = 40000,
) -> None:
    ffmpeg = _get_ffmpeg_path()
    shift = max(-12, min(12, int(pitch_shift)))
    pitch_factor = pow(2.0, shift / 12.0)
    tempo_rate = 1.0 / pitch_factor
    atempo = _build_atempo_filter_chain(tempo_rate)
    audio_filter = (
        f"asetrate={sample_rate * pitch_factor:.4f},"
        f"aresample={sample_rate},"
        f"{atempo},"
        "highpass=f=70,"
        "lowpass=f=12000,"
        "acompressor=threshold=-14dB:ratio=2.2:attack=8:release=120"
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
        ]
    )


def _normalize_preset(raw: str) -> str:
    token = str(raw or "").strip().lower()
    if token in {"cover_hq", "cover", "hq"}:
        return "cover_hq"
    return "tts_realtime"


def _preset_defaults(preset: str) -> dict[str, Any]:
    if preset == "cover_hq":
        return {
            "index_rate": 0.75,
            "filter_radius": 5,
            "rms_mix_rate": 1.0,
            "protect": 0.2,
            "f0_method": "rmvpe",
        }
    return {
        "index_rate": 0.45,
        "filter_radius": 3,
        "rms_mix_rate": 0.9,
        "protect": 0.35,
        "f0_method": "rmvpe",
    }


class RvcRuntime:
    def __init__(self) -> None:
        self.engine: Any = None
        self.import_error: Optional[str] = None

    def ensure_engine(self) -> Any:
        if self.engine is not None:
            return self.engine

        try:
            from rvc_python.infer import RVCInference  # type: ignore
        except Exception as exc:
            self.import_error = f"rvc-python import failed: {exc}"
            raise RuntimeError(self.import_error) from exc

        try:
            self.engine = RVCInference(models_dir=str(MODELS_DIR), device=RVC_DEVICE)
        except Exception as exc:
            self.import_error = f"RVC engine init failed: {exc}"
            raise RuntimeError(self.import_error) from exc

        return self.engine

    def list_models(self) -> list[str]:
        engine = self.ensure_engine()
        return engine.list_models()

    def load_model(self, model_name: str, version: str = "v2") -> None:
        engine = self.ensure_engine()
        engine.load_model(model_name, version=version)

    def current_model(self) -> Optional[str]:
        if self.engine is None:
            return None
        return getattr(self.engine, "current_model", None)


rvc_runtime = RvcRuntime()
app = FastAPI(title="VoiceFlow RVC Runtime", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS"),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> JSONResponse:
    current_model = rvc_runtime.current_model()
    available = False
    detail = "rvc_unavailable"
    error = rvc_runtime.import_error
    try:
        rvc_runtime.ensure_engine()
        available = True
        detail = "rvc_ready"
        error = None
        current_model = rvc_runtime.current_model()
    except Exception as exc:
        error = str(exc)

    return JSONResponse(
        {
            "ok": available or ENABLE_RVC_FALLBACK,
            "runtime": "rvc-runtime",
            "rvc": {
                "available": available,
                "detail": detail,
                "currentModel": current_model,
                "modelsDir": str(MODELS_DIR),
                "device": RVC_DEVICE,
                "error": error,
                "fallbackAvailable": bool(ENABLE_RVC_FALLBACK),
                "fallbackModel": RVC_FALLBACK_MODEL_ID if ENABLE_RVC_FALLBACK else None,
            },
        }
    )


@app.get("/v1/health")
def v1_health() -> JSONResponse:
    return health()


@app.get("/v1/models")
def list_models() -> JSONResponse:
    try:
        models = rvc_runtime.list_models()
        if ENABLE_RVC_FALLBACK and RVC_FALLBACK_MODEL_ID not in models:
            models = [RVC_FALLBACK_MODEL_ID, *models]
        current_model = rvc_runtime.current_model()
        if not current_model and ENABLE_RVC_FALLBACK:
            current_model = RVC_FALLBACK_MODEL_ID
        return JSONResponse({"ok": True, "models": models, "currentModel": current_model})
    except Exception as exc:
        if ENABLE_RVC_FALLBACK:
            return JSONResponse(
                {
                    "ok": True,
                    "models": [RVC_FALLBACK_MODEL_ID],
                    "currentModel": RVC_FALLBACK_MODEL_ID,
                    "fallback": True,
                    "detail": f"RVC unavailable; using low-CPU fallback ({exc})",
                }
            )
        raise HTTPException(status_code=503, detail=f"RVC unavailable: {exc}") from exc


@app.post("/v1/load-model")
def load_model(payload: LoadRvcModelRequest) -> JSONResponse:
    if payload.modelName == RVC_FALLBACK_MODEL_ID and ENABLE_RVC_FALLBACK:
        return JSONResponse(
            {
                "ok": True,
                "currentModel": RVC_FALLBACK_MODEL_ID,
                "fallback": True,
                "detail": "Low-CPU timbre fallback selected.",
            }
        )

    try:
        rvc_runtime.load_model(payload.modelName, payload.version)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load model: {exc}") from exc

    return JSONResponse({"ok": True, "currentModel": rvc_runtime.current_model()})


@app.post("/v1/convert")
async def convert(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form(...),
    preset: str = Form("tts_realtime"),
    pitch_shift: int = Form(0),
    index_rate: Optional[float] = Form(None),
    filter_radius: Optional[int] = Form(None),
    rms_mix_rate: Optional[float] = Form(None),
    protect: Optional[float] = Form(None),
    f0_method: Optional[str] = Form(None),
) -> FileResponse:
    safe_preset = _normalize_preset(preset)
    defaults = _preset_defaults(safe_preset)

    resolved_index_rate = float(index_rate if index_rate is not None else defaults["index_rate"])
    resolved_filter_radius = int(filter_radius if filter_radius is not None else defaults["filter_radius"])
    resolved_rms_mix_rate = float(rms_mix_rate if rms_mix_rate is not None else defaults["rms_mix_rate"])
    resolved_protect = float(protect if protect is not None else defaults["protect"])
    resolved_f0_method = str(f0_method if f0_method is not None else defaults["f0_method"]).strip() or "rmvpe"

    temp_dir = tempfile.mkdtemp(prefix="vf_rvc_rt_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source_audio")
    normalized_wav = Path(temp_dir) / "input.wav"
    output_path = Path(temp_dir) / "output.wav"

    try:
        with source_path.open("wb") as f:
            f.write(await file.read())

        _convert_media_to_wav(str(source_path), str(normalized_wav), sample_rate=40000)

        if model_name == RVC_FALLBACK_MODEL_ID:
            if not ENABLE_RVC_FALLBACK:
                raise RuntimeError("RVC fallback model is disabled.")
            _convert_with_low_cpu_timbre(
                str(normalized_wav),
                str(output_path),
                pitch_shift=pitch_shift,
                sample_rate=40000,
            )
        else:
            engine = rvc_runtime.ensure_engine()
            if engine.current_model != model_name:
                engine.load_model(model_name)
            engine.set_params(
                f0method=resolved_f0_method,
                f0up_key=int(pitch_shift),
                index_rate=resolved_index_rate,
                filter_radius=resolved_filter_radius,
                rms_mix_rate=resolved_rms_mix_rate,
                protect=resolved_protect,
            )
            engine.infer_file(str(normalized_wav), str(output_path))

    except Exception as exc:
        _cleanup_paths(temp_dir)
        raise HTTPException(status_code=500, detail=f"RVC conversion failed: {exc}") from exc

    background_tasks.add_task(_cleanup_paths, temp_dir)
    safe_model = _safe_upload_name(model_name, "model")
    return FileResponse(
        str(output_path),
        media_type="audio/wav",
        filename=f"rvc_{safe_model}.wav",
        headers={
            "x-vf-rvc-runtime": "1",
            "x-vf-rvc-preset": safe_preset,
            "x-vf-rvc-model": safe_model,
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VF_RVC_RUNTIME_HOST", "127.0.0.1")
    port = int(os.getenv("VF_RVC_RUNTIME_PORT", "7830"))
    uvicorn.run(app, host=host, port=port, reload=False)
