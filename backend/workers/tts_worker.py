from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class TtsWorkerJob:
    uid: str
    request_id: str
    engine: str
    payload: dict[str, Any]


def process_tts_job(job: TtsWorkerJob) -> dict[str, Any]:
    """
    Placeholder worker contract for queue/worker rollout.
    Runtime processing is currently handled in the API process.
    """

    return {
        "ok": False,
        "requestId": job.request_id,
        "error": "TTS worker queue mode is not enabled in this deployment.",
    }

