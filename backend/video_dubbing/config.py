from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request


@dataclass
class DubbingConfig:
    project_root: Path
    work_root: Path
    models_root: Path
    output_root: Path
    sample_rate: int = 48000
    whisper_sample_rate: int = 16000
    gemini_runtime_url: str = "http://127.0.0.1:7810"
    kokoro_runtime_url: str = "http://127.0.0.1:7820"
    voice_transfer_runtime_url: str = "http://127.0.0.1:7830"
    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    demucs_model: str = "htdemucs"
    pyannote_token: str = ""
    latent_sync_cmd: str = ""
    nllb_ct2_path: Path | None = None
    mix_clip_fade_ms: float = 12.0
    mix_stretch_min_rate: float = 0.85
    mix_stretch_max_rate: float = 1.35
    gemini_pair_group_max_concurrency: int = 7
    gemini_pair_group_retry_once: bool = True
    gemini_pair_group_timeout_sec: int = 240
    pipeline_version: str = "2026.1"
    phase1_model: str = "BS-Roformer-Viperx-1297"
    dereverb_model: str = "uvr_deecho_dereverb"
    director_model: str = "gemini-2.5-flash"
    tts_model: str = "gemini-2.5-flash-preview-tts"
    allow_model_fallback: bool = False
    source_language_mode: str = "auto_per_segment"
    language_coverage_profile: str = "core12"
    isochrony_tolerance_pct: float = 10.0
    thinking_low_scene_max_speakers: int = 1
    voice_transfer_preset: str = "tts_realtime"
    wav2lip_onnx_path: Path | None = None
    lpips_asset_path: Path | None = None
    phase1_asset_path: Path | None = None
    dereverb_asset_path: Path | None = None
    strict_core_phases: bool = True

    @property
    def segments_dir(self) -> Path:
        return self.output_root / "segments"

    @property
    def refs_dir(self) -> Path:
        return self.output_root / "refs"

    @property
    def tts_dir(self) -> Path:
        return self.output_root / "tts"

    @property
    def world_dir(self) -> Path:
        return self.output_root / "world"

    @property
    def emotion_dir(self) -> Path:
        return self.output_root / "emotion"

    @property
    def cache_dir(self) -> Path:
        return self.output_root / "cache"

    @property
    def llvc_runtime_url(self) -> str:
        return self.voice_transfer_runtime_url

    @property
    def llvc_preset(self) -> str:
        return self.voice_transfer_preset



def _env_path(value: str) -> Path | None:
    token = str(value or "").strip()
    if not token:
        return None
    try:
        return Path(token).expanduser().resolve()
    except Exception:
        return Path(token)



def build_config(work_root: Path | str | None = None) -> DubbingConfig:
    project_root = Path(__file__).resolve().parent.parent
    base = Path(work_root) if work_root else (project_root / "video_dubbing" / "output")
    models_root = project_root / "video_dubbing" / "models"

    wav2lip_onnx_path = _env_path(os.getenv("VF_DUB_WAV2LIP_ONNX_PATH", ""))
    if wav2lip_onnx_path is None:
        wav2lip_onnx_path = (project_root / "models" / "video-pipeline" / "wav2lip" / "wav2lip.onnx").resolve()

    lpips_asset_path = _env_path(os.getenv("VF_DUB_LPIPS_ASSET_PATH", ""))
    if lpips_asset_path is None:
        lpips_asset_path = (project_root / "models" / "video-pipeline" / "lpips" / "lpips.onnx").resolve()

    phase1_asset_path = _env_path(os.getenv("VF_DUB_PHASE1_ASSET_PATH", ""))
    if phase1_asset_path is None:
        phase1_asset_path = (project_root / "models" / "video-pipeline" / "uvr" / "BS-Roformer-Viperx-1297.onnx").resolve()

    dereverb_asset_path = _env_path(os.getenv("VF_DUB_DEREVERB_ASSET_PATH", ""))
    if dereverb_asset_path is None:
        dereverb_asset_path = (project_root / "models" / "video-pipeline" / "uvr" / "dereverb.onnx").resolve()

    cfg = DubbingConfig(
        project_root=project_root,
        work_root=base,
        models_root=models_root,
        output_root=base,
        sample_rate=int(os.getenv("VF_DUB_SR", "48000")),
        whisper_sample_rate=int(os.getenv("VF_DUB_WHISPER_SR", "16000")),
        gemini_runtime_url=os.getenv("VF_GEMINI_RUNTIME_URL", "http://127.0.0.1:7810").rstrip("/"),
        kokoro_runtime_url=os.getenv("VF_KOKORO_RUNTIME_URL", "http://127.0.0.1:7820").rstrip("/"),
        voice_transfer_runtime_url=(
            os.getenv("VF_VOICE_TRANSFER_RUNTIME_URL")
            or os.getenv("VF_VOICE_TRANSFER_RUNTIME_URL")
            or "http://127.0.0.1:7830"
        ).rstrip("/"),
        whisper_model=os.getenv("VF_WHISPER_MODEL", "small"),
        whisper_device=os.getenv("VF_WHISPER_DEVICE", "cpu"),
        whisper_compute_type=os.getenv("VF_WHISPER_COMPUTE", "int8"),
        demucs_model=os.getenv("VF_DEMUCS_MODEL", "htdemucs"),
        pyannote_token=os.getenv("PYANNOTE_AUTH_TOKEN", ""),
        latent_sync_cmd=os.getenv("VF_LATENTSYNC_CMD", "").strip(),
        mix_clip_fade_ms=float(os.getenv("VF_DUB_MIX_CLIP_FADE_MS", "12")),
        mix_stretch_min_rate=float(os.getenv("VF_DUB_MIX_STRETCH_MIN_RATE", "0.85")),
        mix_stretch_max_rate=float(os.getenv("VF_DUB_MIX_STRETCH_MAX_RATE", "1.35")),
        gemini_pair_group_max_concurrency=int(os.getenv("VF_GEMINI_PAIR_GROUP_MAX_CONCURRENCY", "7")),
        gemini_pair_group_retry_once=str(os.getenv("VF_GEMINI_PAIR_GROUP_RETRY_ONCE", "true")).strip().lower()
        in {"1", "true", "yes", "on"},
        gemini_pair_group_timeout_sec=int(os.getenv("VF_GEMINI_PAIR_GROUP_TIMEOUT_SEC", "240")),
        pipeline_version=str(os.getenv("VF_DUB_PIPELINE_VERSION", "2026.1") or "2026.1").strip() or "2026.1",
        phase1_model=str(os.getenv("VF_DUB_PHASE1_MODEL", "BS-Roformer-Viperx-1297") or "BS-Roformer-Viperx-1297").strip()
        or "BS-Roformer-Viperx-1297",
        dereverb_model=str(os.getenv("VF_DUB_DEREVERB_MODEL", "uvr_deecho_dereverb") or "uvr_deecho_dereverb").strip()
        or "uvr_deecho_dereverb",
        director_model=str(os.getenv("VF_DUB_DIRECTOR_MODEL", "gemini-2.5-flash") or "gemini-2.5-flash").strip() or "gemini-2.5-flash",
        tts_model=str(os.getenv("VF_DUB_TTS_MODEL", "gemini-2.5-flash-preview-tts") or "gemini-2.5-flash-preview-tts").strip()
        or "gemini-2.5-flash-preview-tts",
        allow_model_fallback=str(os.getenv("VF_DUB_ALLOW_MODEL_FALLBACK", "0")).strip().lower() in {"1", "true", "yes", "on"},
        source_language_mode=str(os.getenv("VF_DUB_SOURCE_LANGUAGE_MODE", "auto_per_segment") or "auto_per_segment").strip() or "auto_per_segment",
        language_coverage_profile=str(os.getenv("VF_DUB_LANGUAGE_COVERAGE_PROFILE", "core12") or "core12").strip() or "core12",
        isochrony_tolerance_pct=float(os.getenv("VF_DUB_ISOCHRONY_TOLERANCE_PCT", "10")),
        thinking_low_scene_max_speakers=max(
            1,
            int((os.getenv("VF_DUB_THINKING_LOW_SCENE_MAX_SPEAKERS") or "1").strip() or "1"),
        ),
        voice_transfer_preset=str(
            os.getenv("VF_DUB_VOICE_TRANSFER_PRESET")
            or os.getenv("VF_DUB_VOICE_TRANSFER_PRESET")
            or "tts_realtime"
        ).strip()
        or "tts_realtime",
        wav2lip_onnx_path=wav2lip_onnx_path,
        lpips_asset_path=lpips_asset_path,
        phase1_asset_path=phase1_asset_path,
        dereverb_asset_path=dereverb_asset_path,
        strict_core_phases=str(os.getenv("VF_DUB_STRICT_CORE_PHASES", "1")).strip().lower() in {"1", "true", "yes", "on"},
    )

    if cfg.mix_stretch_min_rate <= 0:
        cfg.mix_stretch_min_rate = 0.85
    if cfg.mix_stretch_max_rate <= 0:
        cfg.mix_stretch_max_rate = 1.35
    if cfg.mix_stretch_min_rate > cfg.mix_stretch_max_rate:
        cfg.mix_stretch_min_rate, cfg.mix_stretch_max_rate = cfg.mix_stretch_max_rate, cfg.mix_stretch_min_rate
    if cfg.mix_clip_fade_ms < 0:
        cfg.mix_clip_fade_ms = 0.0
    if cfg.gemini_pair_group_max_concurrency < 1:
        cfg.gemini_pair_group_max_concurrency = 1
    if cfg.gemini_pair_group_max_concurrency > 7:
        cfg.gemini_pair_group_max_concurrency = 7
    if cfg.gemini_pair_group_timeout_sec <= 0:
        cfg.gemini_pair_group_timeout_sec = 240
    if cfg.isochrony_tolerance_pct < 1:
        cfg.isochrony_tolerance_pct = 1.0

    nllb_raw = os.getenv("VF_NLLB_CT2_PATH", "").strip()
    if nllb_raw:
        cfg.nllb_ct2_path = Path(nllb_raw)
    else:
        default_nllb = models_root / "nllb_ct2"
        cfg.nllb_ct2_path = default_nllb if default_nllb.exists() else None

    for path in [
        cfg.output_root,
        cfg.segments_dir,
        cfg.refs_dir,
        cfg.tts_dir,
        cfg.world_dir,
        cfg.emotion_dir,
        cfg.cache_dir,
    ]:
        path.mkdir(parents=True, exist_ok=True)

    return cfg



def run_strict_preflight(cfg: DubbingConfig, source_path: Path) -> dict:
    checks: list[dict[str, str | bool]] = []

    def check(name: str, ok: bool, detail: str, remediation: str) -> None:
        checks.append(
            {
                "name": name,
                "ok": bool(ok),
                "detail": detail,
                "remediation": remediation,
            }
        )

    ffmpeg_bin = shutil.which("ffmpeg")
    check(
        "ffmpeg",
        bool(ffmpeg_bin),
        "ffmpeg found on PATH" if ffmpeg_bin else "ffmpeg not found on PATH",
        "Install FFmpeg and ensure ffmpeg executable is available in PATH.",
    )
    check(
        "source_media",
        source_path.exists(),
        f"Source file: {source_path}",
        "Provide a valid source media file.",
    )

    required_assets = [
        ("phase1_asset", cfg.phase1_asset_path, "Download UVR phase1 model assets."),
        ("dereverb_asset", cfg.dereverb_asset_path, "Download dereverb assets."),
        ("wav2lip_asset", cfg.wav2lip_onnx_path, "Download Wav2Lip ONNX assets."),
    ]
    for name, asset_path, remediation in required_assets:
        check(
            name,
            bool(asset_path and asset_path.exists()),
            f"Asset path: {asset_path}" if asset_path else "Asset path not configured",
            remediation,
        )

    # Optional validation asset: warning-only.
    if cfg.lpips_asset_path and not cfg.lpips_asset_path.exists():
        check(
            "lpips_asset_optional",
            True,
            f"Optional LPIPS asset missing: {cfg.lpips_asset_path}",
            "Optional: download LPIPS assets for face-preservation validation.",
        )

    runtime_checks = [
        ("gem_runtime", cfg.gemini_runtime_url, "Start GEM runtime on configured URL."),
        ("kokoro_runtime", cfg.kokoro_runtime_url, "Start KOKORO runtime on configured URL."),
        ("voice_transfer_runtime", cfg.voice_transfer_runtime_url, "Start voice-transfer runtime on configured URL."),
    ]
    for name, runtime_url, remediation in runtime_checks:
        try:
            with urllib_request.urlopen(f"{runtime_url}/health", timeout=4) as response:
                status_ok = int(getattr(response, "status", 0) or 0) == 200
            check(name, status_ok, f"{name} health at {runtime_url}", remediation)
        except (urllib_error.URLError, TimeoutError, OSError) as exc:
            check(name, False, f"{name} unreachable: {exc}", remediation)

    check(
        "pyannote_auth_token",
        bool(str(cfg.pyannote_token or "").strip()),
        "PYANNOTE_AUTH_TOKEN configured" if str(cfg.pyannote_token or "").strip() else "PYANNOTE_AUTH_TOKEN missing",
        "Set PYANNOTE_AUTH_TOKEN for mandatory speaker diarization.",
    )

    ok = all(bool(item["ok"]) for item in checks)
    failures = [item for item in checks if not bool(item["ok"])]
    return {
        "ok": ok,
        "checks": checks,
        "failureCount": len(failures),
    }
