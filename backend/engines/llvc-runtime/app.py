from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass
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
LLVC_BACKEND_MODE = "real_svc"

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


llvc_registry = LlvcRegistry()


class RealSvcRuntime:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._convert_lock = threading.Lock()
        self._converter: Any = None
        self._active_assets: Optional[ResolvedModelAssets] = None
        self.import_error: Optional[str] = None

    def _runtime_models_dir(self) -> Path:
        return (MODELS_DIR / "models").resolve()

    def _configure_upstream(self, *, assets: ResolvedModelAssets) -> tuple[Any, Any]:
        try:
            import torch
            from minimal_rvc import model as rvc_model
            from minimal_rvc import shared as rvc_shared
        except Exception as exc:
            self.import_error = f"minimal_rvc import failed: {exc}"
            raise RuntimeError(self.import_error) from exc

        runtime_models_dir = self._runtime_models_dir()
        if not runtime_models_dir.exists():
            raise RuntimeError(f"llvc_models_dir_missing:{runtime_models_dir}")

        rvc_model.MODELS_DIR = str(runtime_models_dir)
        rvc_shared.MODELS_DIR = str(runtime_models_dir)

        device_token = str(LLVC_DEVICE or "cpu").strip().lower()
        if device_token.startswith("cuda") and torch.cuda.is_available():
            selected_device = torch.device(device_token)
            use_half = True
        else:
            selected_device = torch.device("cpu")
            use_half = False

        rvc_model.device = selected_device
        rvc_model.is_half = use_half
        rvc_shared.device = selected_device
        rvc_shared.is_half = use_half

        embedder_path = (runtime_models_dir / "embeddings" / "checkpoint_best_legacy_500.pt").resolve()
        if not embedder_path.exists() and assets.embedder_path.exists():
            embedder_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(assets.embedder_path, embedder_path)

        f0_path = (runtime_models_dir / "f0" / "rmvpe.pt").resolve()
        if not f0_path.exists() and assets.f0_path.exists():
            f0_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(assets.f0_path, f0_path)

        return torch, rvc_model

    def ensure_loaded(self, *, assets: ResolvedModelAssets) -> None:
        with self._lock:
            if self._converter is not None and self._active_assets == assets:
                return
            torch, rvc_model = self._configure_upstream(assets=assets)
            try:
                # Torch 2.6 switched torch.load default to weights_only=True.
                # KoeAI checkpoints require full unpickling.
                load_kwargs: dict[str, Any] = {"map_location": "cpu"}
                try:
                    state_dict = torch.load(str(assets.checkpoint_path), weights_only=False, **load_kwargs)
                except TypeError:
                    state_dict = torch.load(str(assets.checkpoint_path), **load_kwargs)
                self._converter = rvc_model.VoiceConvertModel(f"{assets.resolved_model_id}.pth", state_dict)
                self._active_assets = assets
                self.import_error = None
            except Exception as exc:
                self._converter = None
                self._active_assets = None
                self.import_error = f"llvc_model_load_failed: {exc}"
                raise RuntimeError(self.import_error) from exc

    def convert(
        self,
        *,
        assets: ResolvedModelAssets,
        input_wav: str,
        output_wav: str,
        pitch_shift: int,
        f0_method: str,
        index_rate: Optional[float],
    ) -> dict[str, Any]:
        self.ensure_loaded(assets=assets)

        safe_pitch = max(-24, min(24, int(pitch_shift)))
        method = str(f0_method or "rmvpe").strip().lower()
        if method not in {"rmvpe", "harvest", "crepe", "pm"}:
            method = "rmvpe"

        idx_rate = None
        if index_rate is not None:
            try:
                idx_rate = max(0.0, min(1.0, float(index_rate)))
            except Exception:
                idx_rate = None
        faiss_index_file = ""
        index_used = False
        if assets.index_path is not None and assets.index_path.exists() and idx_rate is not None and idx_rate > 0.0:
            faiss_index_file = str(assets.index_path)
            index_used = True

        sid = 0
        if self._converter is not None:
            try:
                n_spk = int(getattr(self._converter, "n_spk", 1) or 1)
                sid = 0 if n_spk <= 1 else min(1, n_spk - 1)
            except Exception:
                sid = 0

        with self._convert_lock:
            try:
                out = self._converter.single(
                    sid=sid,
                    input_audio=str(input_wav),
                    embedder_model_name="hubert_base",
                    embedding_output_layer="auto",
                    f0_up_key=safe_pitch,
                    f0_file=None,
                    f0_method=method,
                    auto_load_index=False,
                    faiss_index_file=faiss_index_file,
                    index_rate=idx_rate,
                    output_dir=str(Path(output_wav).parent),
                    f0_relative=True,
                )
            except Exception as exc:
                raise RuntimeError(f"llvc_inference_failed: {exc}") from exc

        try:
            out.export(output_wav, format="wav")
        except Exception as exc:
            raise RuntimeError(f"llvc_export_failed: {exc}") from exc

        return {
            "resolvedModelId": assets.resolved_model_id,
            "indexUsed": index_used,
            "f0Method": method,
        }


svc_runtime = RealSvcRuntime()


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


def _normalize_preset(raw: str) -> str:
    token = str(raw or "").strip().lower()
    if token in {"llvc_hq_cpu", "cover_hq", "cover", "hq"}:
        return "llvc_hq_cpu"
    if token in {"tts_realtime", "live"}:
        return "tts_realtime"
    return LLVC_PRESET_DEFAULT


def _apply_llvc_mastering_filter(
    input_wav: str,
    output_wav: str,
    *,
    sample_rate: int,
    preset: str,
) -> None:
    ffmpeg = _get_ffmpeg_path()

    if preset == "llvc_hq_cpu":
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


app = FastAPI(title="VoiceFlow LLVC Runtime", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS"),
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
    available = bool(models and current_model)

    if available:
        try:
            resolved_assets = llvc_registry.resolve_runtime_assets(current_model)
            svc_runtime.ensure_loaded(assets=resolved_assets)
        except Exception as exc:
            available = False
            llvc_error = str(exc)

    payload = {
        "ok": available,
        "runtime": "llvc-runtime",
        "llvc": {
            "available": available,
            "detail": "llvc_ready" if available else "llvc_unavailable",
            "backendMode": LLVC_BACKEND_MODE,
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
            "chunkFactor": LLVC_CHUNK_FACTOR,
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
            "backendMode": LLVC_BACKEND_MODE,
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
            "backendMode": LLVC_BACKEND_MODE,
        }
    )


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
    _ = filter_radius
    _ = rms_mix_rate
    _ = protect

    llvc_registry.reload()
    try:
        assets = llvc_registry.resolve_runtime_assets(model_name)
    except RuntimeError as exc:
        detail = str(exc)
        if detail.startswith("unknown_llvc_model:"):
            raise HTTPException(status_code=400, detail=detail) from exc
        raise HTTPException(status_code=503, detail=detail) from exc

    safe_preset = _normalize_preset(preset)
    sample_rate = max(16000, int(assets.sample_rate or 32000))

    temp_dir = tempfile.mkdtemp(prefix="vf_llvc_rt_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source_audio")
    normalized_wav = Path(temp_dir) / "normalized_input.wav"
    converted_wav = Path(temp_dir) / "converted.wav"
    output_path = Path(temp_dir) / "output.wav"

    inference_meta: dict[str, Any] = {}
    try:
        with source_path.open("wb") as handle:
            handle.write(await file.read())

        _convert_media_to_wav(str(source_path), str(normalized_wav), sample_rate=sample_rate)
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
        raise HTTPException(status_code=500, detail=f"LLVC conversion failed: {exc}") from exc

    background_tasks.add_task(_cleanup_paths, temp_dir)
    safe_model = _safe_upload_name(model_name, "model")
    safe_resolved = _safe_upload_name(str(inference_meta.get("resolvedModelId") or assets.resolved_model_id), "resolved")
    return FileResponse(
        str(output_path),
        media_type="audio/wav",
        filename=f"llvc_{safe_model}.wav",
        headers={
            "x-vf-llvc-runtime": "1",
            "x-vf-llvc-preset": safe_preset,
            "x-vf-llvc-model": safe_model,
            "x-vf-llvc-model-resolved": safe_resolved,
            "x-vf-llvc-backend-mode": LLVC_BACKEND_MODE,
            "x-vf-llvc-index-used": "1" if bool(inference_meta.get("indexUsed")) else "0",
            "x-vf-llvc-f0-method": str(inference_meta.get("f0Method") or "rmvpe"),
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VF_LLVC_RUNTIME_HOST", "0.0.0.0")
    port = int((os.getenv("PORT") or os.getenv("VF_LLVC_RUNTIME_PORT") or "7830").strip() or "7830")
    uvicorn.run(app, host=host, port=port, reload=False)
