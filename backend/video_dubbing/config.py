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


def build_config(work_root: Path | str | None = None) -> DubbingConfig:
    project_root = Path(__file__).resolve().parent.parent
    base = Path(work_root) if work_root else (project_root / "video_dubbing" / "output")
    models_root = project_root / "video_dubbing" / "models"
    cfg = DubbingConfig(
        project_root=project_root,
        work_root=base,
        models_root=models_root,
        output_root=base,
        sample_rate=int(os.getenv("VF_DUB_SR", "48000")),
        whisper_sample_rate=int(os.getenv("VF_DUB_WHISPER_SR", "16000")),
        gemini_runtime_url=os.getenv("VF_GEMINI_RUNTIME_URL", "http://127.0.0.1:7810").rstrip("/"),
        kokoro_runtime_url=os.getenv("VF_KOKORO_RUNTIME_URL", "http://127.0.0.1:7820").rstrip("/"),
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
        gemini_pair_group_retry_once=str(os.getenv("VF_GEMINI_PAIR_GROUP_RETRY_ONCE", "true")).strip().lower() in {"1", "true", "yes", "on"},
        gemini_pair_group_timeout_sec=int(os.getenv("VF_GEMINI_PAIR_GROUP_TIMEOUT_SEC", "240")),
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

    nllb_raw = os.getenv("VF_NLLB_CT2_PATH", "").strip()
    if nllb_raw:
        cfg.nllb_ct2_path = Path(nllb_raw)
    else:
        default_nllb = models_root / "nllb_ct2"
        cfg.nllb_ct2_path = default_nllb if default_nllb.exists() else None

    for path in [cfg.output_root, cfg.segments_dir, cfg.refs_dir, cfg.tts_dir, cfg.world_dir, cfg.emotion_dir]:
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
        "demucs_cli",
        bool(shutil.which("demucs")),
        "demucs command found" if shutil.which("demucs") else "demucs command not found",
        "Install demucs and ensure the demucs entrypoint is available in PATH.",
    )
    check(
        "source_media",
        source_path.exists(),
        f"Source file: {source_path}",
        "Provide a valid source media file.",
    )
    check(
        "pyannote_token",
        bool(cfg.pyannote_token.strip()),
        "PYANNOTE_AUTH_TOKEN configured" if cfg.pyannote_token.strip() else "PYANNOTE_AUTH_TOKEN missing",
        "Set PYANNOTE_AUTH_TOKEN environment variable for diarization.",
    )
    check(
        "nllb_model",
        bool(cfg.nllb_ct2_path and cfg.nllb_ct2_path.exists()),
        f"NLLB path: {cfg.nllb_ct2_path}" if cfg.nllb_ct2_path else "NLLB path not configured",
        "Set VF_NLLB_CT2_PATH or place model at video_dubbing/models/nllb_ct2.",
    )
    is_video = source_path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
    check(
        "latentsync_cmd",
        bool(cfg.latent_sync_cmd) if is_video else True,
        "LatentSync command configured" if cfg.latent_sync_cmd else ("LatentSync not required for audio input" if not is_video else "LatentSync command missing"),
        "Set VF_LATENTSYNC_CMD with '{input}' and '{output}' placeholders." if is_video else "No action required for audio-only input.",
    )
    try:
        from faster_whisper import WhisperModel  # type: ignore

        _ = WhisperModel(cfg.whisper_model, device=cfg.whisper_device, compute_type=cfg.whisper_compute_type)
        check("whisper_runtime", True, "Whisper runtime initialized", "Install faster-whisper and model dependencies.")
    except Exception as exc:
        check("whisper_runtime", False, f"Whisper init failed: {exc}", "Install faster-whisper and required runtime libraries.")

    try:
        from speechbrain.inference.classifiers import EncoderClassifier  # type: ignore

        _ = EncoderClassifier
        check("speechbrain_runtime", True, "SpeechBrain module import ok", "Install speechbrain package.")
    except Exception as exc:
        check(
            "speechbrain_runtime",
            True,
            f"SpeechBrain unavailable (fallback mode): {exc}",
            "Install a compatible speechbrain+torchaudio stack for model-based emotion detection.",
        )

    try:
        import pyworld  # type: ignore  # noqa: F401

        check("pyworld_runtime", True, "pyworld module import ok", "Install pyworld package.")
    except Exception as exc:
        check("pyworld_runtime", False, f"pyworld import failed: {exc}", "Install pyworld package.")

    runtime_checks = [
        ("gem_runtime", cfg.gemini_runtime_url, "Start GEM runtime on configured URL."),
        ("kokoro_runtime", cfg.kokoro_runtime_url, "Start KOKORO runtime on configured URL."),
    ]
    for name, runtime_url, remediation in runtime_checks:
        try:
            with urllib_request.urlopen(f"{runtime_url}/health", timeout=4) as response:
                status_ok = int(getattr(response, "status", 0) or 0) == 200
            check(name, status_ok, f"{name} health at {runtime_url}", remediation)
        except (urllib_error.URLError, TimeoutError, OSError) as exc:
            check(name, False, f"{name} unreachable: {exc}", remediation)

    ok = all(bool(item["ok"]) for item in checks)
    failures = [item for item in checks if not bool(item["ok"])]
    return {
        "ok": ok,
        "checks": checks,
        "failureCount": len(failures),
    }
