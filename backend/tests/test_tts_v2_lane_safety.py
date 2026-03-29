from __future__ import annotations

import time
import wave
from io import BytesIO
from pathlib import Path

from services.tts_v2_engine import SynthChunk, TtsV2Engine


def _make_wav(duration_ms: int = 80, sample_rate: int = 24_000) -> bytes:
    frame_count = max(1, int(sample_rate * (duration_ms / 1000.0)))
    frames = (b"\x10\x00" * frame_count)
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(frames)
    return buffer.getvalue()


def _wait_for_terminal(engine: TtsV2Engine, job_id: str, *, timeout_s: float = 2.0):
    deadline = time.time() + timeout_s
    thread = engine._threads.get(job_id)  # noqa: SLF001
    if thread is not None:
        thread.join(timeout_s)
    while time.time() < deadline:
        job = engine.get_job(uid="lane_user", is_admin=False, job_id=job_id)
        if str(job.status or "").strip().lower() in {"completed", "failed", "cancelled"}:
            return job
        time.sleep(0.02)
    return engine.get_job(uid="lane_user", is_admin=False, job_id=job_id)


def test_tts_v2_submit_failure_releases_lane_capacity(tmp_path: Path) -> None:
    engine = TtsV2Engine(
        synthesize_fn=lambda payload: SynthChunk(audio=_make_wav()),
        output_root=tmp_path,
        redis_url="",
        lane_inflight=1,
    )

    def _failing_submit(*args, **kwargs):
        raise RuntimeError("submit exploded")

    engine._executor.submit = _failing_submit  # type: ignore[assignment]  # noqa: SLF001

    created = engine.create_job(
        payload={
            "request_id": "lane_submit_fail_1234",
            "mode": "single_speaker",
            "engine": "PRIME",
            "text": " ".join("Sentence one. Sentence two." for _ in range(80)),
        },
        uid="lane_user",
        plan_key="free",
    )

    job = _wait_for_terminal(engine, created.id)

    assert job.status == "failed"
    assert all(int(lane.inflight) == 0 for lane in engine._lanes.values())  # noqa: SLF001
    for lane in engine._lanes.values():  # noqa: SLF001
        assert lane.sem.acquire(blocking=False)
        lane.sem.release()


def test_tts_v2_finalize_failure_releases_lane_capacity(tmp_path: Path) -> None:
    engine = TtsV2Engine(
        synthesize_fn=lambda payload: SynthChunk(audio=_make_wav()),
        output_root=tmp_path,
        redis_url="",
        lane_inflight=1,
    )

    def _failing_write(path, data):
        raise RuntimeError("write exploded")

    engine._write_bytes_atomic = _failing_write  # type: ignore[assignment]  # noqa: SLF001

    created = engine.create_job(
        payload={
            "request_id": "lane_finalize_fail_1234",
            "mode": "single_speaker",
            "engine": "PRIME",
            "text": " ".join("Sentence one. Sentence two." for _ in range(80)),
        },
        uid="lane_user",
        plan_key="free",
    )

    job = _wait_for_terminal(engine, created.id)

    assert job.status == "failed"
    assert all(int(lane.inflight) == 0 for lane in engine._lanes.values())  # noqa: SLF001
    for lane in engine._lanes.values():  # noqa: SLF001
        assert lane.sem.acquire(blocking=False)
        lane.sem.release()
