from __future__ import annotations

import json
import wave
from io import BytesIO
from pathlib import Path

import app as backend_app
from fastapi.testclient import TestClient


PHASES = [
    "acoustic_isolation",
    "director",
    "isochrony_translation",
    "base_tts",
    "llvc_timbre_transfer",
    "visual_lipsync",
]


def _seed_job(job_id: str) -> None:
    with backend_app.DUBBING_JOB_LOCK:
        backend_app.DUBBING_JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "createdAt": 0,
            "updatedAt": 0,
            "cancelRequested": False,
            "logs": [],
            "resultPath": None,
            "pipelineVersion": backend_app.VF_DUB_PIPELINE_VERSION,
        }


def test_run_dubbing_job_v2_emits_phase_timeline_and_metrics(monkeypatch, tmp_path: Path) -> None:
    job_id = "job2026success"
    job_dir = tmp_path / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    source = job_dir / "source.mp4"
    source.write_bytes(b"00")
    _seed_job(job_id)

    monkeypatch.setattr(
        backend_app,
        "_auto_route_dubbing_voices",
        lambda preferred_map, speakers, tts_route: (
            {"default": "alloy", **{speaker: "alloy" for speaker in speakers}},
            [
                {
                    "speaker": speaker,
                    "engine": "GEM",
                    "status": "selected",
                    "voiceId": "alloy",
                }
                for speaker in speakers
            ],
        ),
    )

    import video_dubbing.config as vd_config
    import video_dubbing.main as vd_main

    monkeypatch.setattr(
        vd_config,
        "run_strict_preflight",
        lambda _cfg, _source: {"ok": True, "checks": [], "failureCount": 0},
    )

    captured_pipeline_kwargs: dict[str, object] = {}

    def _fake_run_pipeline(
        source_path,
        output_dir,
        *,
        target_language="hi",
        tts_route="auto",
        voice_map=None,
        strict=False,
        transcript_override="",
        config_overrides=None,
        voice_map_resolver=None,
        runtime_options=None,
        logger=None,
    ):
        _ = source_path
        _ = target_language
        _ = tts_route
        _ = voice_map
        _ = strict
        _ = voice_map_resolver
        captured_pipeline_kwargs["transcript_override"] = transcript_override
        captured_pipeline_kwargs["config_overrides"] = config_overrides
        captured_pipeline_kwargs["runtime_options"] = runtime_options
        for phase in PHASES:
            if logger:
                logger(f"[stage:start] {phase}")
                logger(f"[stage:end] {phase}")
        output_root = Path(output_dir)
        output_root.mkdir(parents=True, exist_ok=True)
        final_video = output_root / "dubbed_video_final.mp4"
        final_audio = output_root / "dubbed_audio.wav"
        final_video.write_bytes(b"00")
        final_audio.write_bytes(b"00")
        return {
            "ok": True,
            "dubbed_audio": str(final_audio),
            "dubbed_video_final": str(final_video),
            "segments": [{"start": 0.0, "end": 0.5, "speaker": "SPEAKER_00", "text": "hello"}],
            "tts_requests": [{"speaker": "SPEAKER_00", "ok": True, "engine": "GEM"}],
            "synthesis_failures": [],
            "alignment": [{"index": 0, "score": 1.0, "target": 0.5, "actual": 0.5}],
            "speaker_profiles": [],
            "director_json": {"segments": [], "sceneComplexity": "low"},
            "isochrony_stats": {"segmentCount": 1, "withinToleranceCount": 1},
            "llvc_metrics": {"segmentCount": 1, "avgRtf": 0.08},
            "lipsync_metrics": {"engine": "wav2lip-onnx"},
            "assets": {"ready": True},
            "thinking_policy": {"default": "low", "complexScene": "high", "thinkingLevel": "low"},
            "language": "en",
        }

    monkeypatch.setattr(vd_main, "run_pipeline", _fake_run_pipeline)

    payload = {
        "jobId": job_id,
        "jobDir": str(job_dir),
        "sourcePath": str(source),
        "target_language": "hi",
        "mode": "strict_full",
        "output": "audio+video",
        "advanced": {
            "engine_policy": "auto_reliable",
            "tts_route": "auto",
            "processing_profile": "cpu_quality",
            "segment_failure_policy": "hard_fail",
            "clone_scope": "job_only",
            "voice_map": {},
            "transcript_override": "Speaker 1: scripted line",
        },
    }

    backend_app._run_dubbing_job_v2(job_id, payload)

    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])

    assert job.get("status") == "completed"
    assert job.get("pipelineVersion") == backend_app.VF_DUB_PIPELINE_VERSION
    stage_timeline = list(job.get("stageTimeline") or [])
    assert [str(item.get("stage") or "") for item in stage_timeline] == PHASES
    assert isinstance(job.get("directorJson"), dict)
    assert isinstance(job.get("isochronyStats"), dict)
    assert isinstance(job.get("llvcMetrics"), dict)
    assert isinstance(job.get("lipsyncMetrics"), dict)
    assert isinstance(job.get("assets"), dict)
    assert isinstance(job.get("thinkingPolicy"), dict)
    assert isinstance(job.get("outputFiles"), dict)
    assert job.get("processingProfile") == "cpu_quality"
    assert captured_pipeline_kwargs.get("transcript_override") == "Speaker 1: scripted line"
    assert isinstance(captured_pipeline_kwargs.get("config_overrides"), dict)
    assert isinstance(captured_pipeline_kwargs.get("runtime_options"), dict)

    report_path = Path(str(job.get("reportPath") or ""))
    assert report_path.exists()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report.get("pipelineVersion") == backend_app.VF_DUB_PIPELINE_VERSION
    assert [str(item.get("stage") or "") for item in list(report.get("stageTimeline") or [])] == PHASES
    assert isinstance(report.get("directorJson"), dict)


def test_run_dubbing_job_v2_sets_phase_error_code_on_core_failure(monkeypatch, tmp_path: Path) -> None:
    job_id = "job2026fail"
    job_dir = tmp_path / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    source = job_dir / "source.mp4"
    source.write_bytes(b"00")
    _seed_job(job_id)

    monkeypatch.setattr(
        backend_app,
        "_auto_route_dubbing_voices",
        lambda preferred_map, speakers, tts_route: ({"default": "alloy"}, []),
    )

    import video_dubbing.config as vd_config
    import video_dubbing.main as vd_main

    monkeypatch.setattr(
        vd_config,
        "run_strict_preflight",
        lambda _cfg, _source: {"ok": True, "checks": [], "failureCount": 0},
    )
    monkeypatch.setattr(vd_main, "run_pipeline", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("phase_failed:base_tts:segment_failures=1")))

    payload = {
        "jobId": job_id,
        "jobDir": str(job_dir),
        "sourcePath": str(source),
        "target_language": "hi",
        "mode": "strict_full",
        "output": "audio+video",
        "advanced": {
            "engine_policy": "auto_reliable",
            "tts_route": "auto",
            "segment_failure_policy": "hard_fail",
            "clone_scope": "job_only",
            "voice_map": {},
        },
    }

    backend_app._run_dubbing_job_v2(job_id, payload)

    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])

    assert job.get("status") == "failed"
    assert job.get("errorCode") == "PHASE_FAILED_BASE_TTS"
    assert job.get("pipelineVersion") == backend_app.VF_DUB_PIPELINE_VERSION


def test_run_dubbing_job_v2_applies_clip_window_trim_before_pipeline(monkeypatch, tmp_path: Path) -> None:
    job_id = "job2026clip"
    job_dir = tmp_path / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    source = job_dir / "source.mp4"
    source.write_bytes(b"00")
    _seed_job(job_id)

    monkeypatch.setattr(
        backend_app,
        "_auto_route_dubbing_voices",
        lambda preferred_map, speakers, tts_route: (
            {"default": "alloy", **{speaker: "alloy" for speaker in speakers}},
            [],
        ),
    )

    import video_dubbing.config as vd_config
    import video_dubbing.main as vd_main

    monkeypatch.setattr(
        vd_config,
        "run_strict_preflight",
        lambda _cfg, _source: {"ok": True, "checks": [], "failureCount": 0},
    )

    captured: dict[str, object] = {}

    def _fake_trim(src_path, dst_path, *, start_ms: int, end_ms: int):
        captured["trim_source"] = str(src_path)
        captured["trim_target"] = str(dst_path)
        captured["trim_start"] = start_ms
        captured["trim_end"] = end_ms
        Path(dst_path).write_bytes(b"trimmed")
        return Path(dst_path)

    def _fake_run_pipeline(*args, **kwargs):
        _ = args
        captured["pipeline_source"] = str(kwargs.get("source_path"))
        output_root = Path(str(kwargs.get("output_dir")))
        output_root.mkdir(parents=True, exist_ok=True)
        final_video = output_root / "dubbed_video_final.mp4"
        final_audio = output_root / "dubbed_audio.wav"
        final_video.write_bytes(b"00")
        final_audio.write_bytes(b"00")
        return {
            "ok": True,
            "dubbed_audio": str(final_audio),
            "dubbed_video_final": str(final_video),
            "segments": [{"start": 0.0, "end": 0.4, "speaker": "SPEAKER_00", "text": "hello"}],
            "tts_requests": [{"speaker": "SPEAKER_00", "ok": True, "engine": "GEM"}],
            "synthesis_failures": [],
            "alignment": [{"index": 0, "score": 1.0, "target": 0.4, "actual": 0.4}],
            "speaker_profiles": [],
            "director_json": {"segments": [], "sceneComplexity": "low"},
            "isochrony_stats": {"segmentCount": 1, "withinToleranceCount": 1},
            "llvc_metrics": {"segmentCount": 1, "avgRtf": 0.08},
            "lipsync_metrics": {"engine": "wav2lip-onnx"},
            "assets": {"ready": True},
            "thinking_policy": {"default": "low", "complexScene": "high", "thinkingLevel": "low"},
            "language": "en",
        }

    monkeypatch.setattr(backend_app, "_trim_media_to_clip_window", _fake_trim)
    monkeypatch.setattr(vd_main, "run_pipeline", _fake_run_pipeline)

    payload = {
        "jobId": job_id,
        "jobDir": str(job_dir),
        "sourcePath": str(source),
        "target_language": "hi",
        "mode": "strict_full",
        "output": "audio+video",
        "advanced": {
            "engine_policy": "auto_reliable",
            "tts_route": "auto",
            "processing_profile": "cpu_quality",
            "segment_failure_policy": "hard_fail",
            "clone_scope": "job_only",
            "voice_map": {},
            "clip_window": {"start_ms": 110, "end_ms": 880},
        },
    }

    backend_app._run_dubbing_job_v2(job_id, payload)

    assert captured.get("trim_start") == 110
    assert captured.get("trim_end") == 880
    assert str(captured.get("pipeline_source") or "").endswith("source_clip_110_880.mp4")


def _wav_bytes(duration_sec: float = 0.15, sample_rate: int = 24000) -> bytes:
    frames = max(1, int(duration_sec * sample_rate))
    payload = BytesIO()
    with wave.open(payload, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frames)
    return payload.getvalue()


def test_dubbing_job_status_include_chunks_and_chunk_download(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    job_id = "job2026chunks"
    with backend_app.DUBBING_JOB_LOCK:
        backend_app.DUBBING_JOBS[job_id] = {
            "id": job_id,
            "status": "running",
            "stage": "base_tts",
            "progress": 64,
            "createdAt": 0,
            "updatedAt": 0,
            "cancelRequested": False,
            "logs": [],
            "resultPath": None,
            "pipelineVersion": backend_app.VF_DUB_PIPELINE_VERSION,
            "live": {"enabled": True, "mode": "progressive_audio", "playableChunks": 0, "playableDurationMs": 0, "chunkCursorNext": 0},
            "liveChunks": [],
            "chunkCursorNext": 0,
        }

    chunk = backend_app._persist_dubbing_live_chunk(
        job_id,
        0,
        _wav_bytes(),
        meta={"speakerId": "SPEAKER_00", "engine": "GEM", "voiceId": "alloy", "textChars": 12},
    )
    with backend_app.DUBBING_JOB_LOCK:
        backend_app.DUBBING_JOBS[job_id]["liveChunks"] = [chunk]
        backend_app.DUBBING_JOBS[job_id]["chunkCursorNext"] = 1
        backend_app.DUBBING_JOBS[job_id]["live"] = {
            "enabled": True,
            "mode": "progressive_audio",
            "playableChunks": 1,
            "playableDurationMs": int(chunk.get("durationMs") or 0),
            "chunkCursorNext": 1,
        }

    client = TestClient(backend_app.app)
    status_response = client.get(f"/dubbing/jobs/{job_id}?includeChunks=1&chunkCursor=0&chunkLimit=8")
    assert status_response.status_code == 200
    payload = status_response.json()
    job = payload.get("job") or {}
    chunks = list(job.get("chunks") or [])
    assert len(chunks) == 1
    assert int(chunks[0].get("index")) == 0
    assert str(chunks[0].get("speakerId") or "") == "SPEAKER_00"
    assert int(job.get("chunkCursorNext") or 0) >= 1

    chunk_response = client.get(f"/dubbing/jobs/{job_id}/chunks/0")
    assert chunk_response.status_code == 200
    assert str(chunk_response.headers.get("content-type") or "").lower().startswith("audio/")
