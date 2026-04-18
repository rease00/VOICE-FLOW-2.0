import time
from fastapi.testclient import TestClient

import app as backend_app

client = TestClient(backend_app.app)
backend_app.VF_AUTH_ENFORCE = False


def _slow_synth(payload, text, lane_id):
    _ = payload, text, lane_id
    time.sleep(0.25)
    return backend_app.TtsV2SynthChunk(audio=b"RIFF" + b"\x00" * 128, media_type="audio/wav", headers={})


backend_app._tts_v2_synthesize_chunk = _slow_synth

session = client.post("/tts/v2/sessions", headers={"x-dev-uid": "status_contract_user"})
print("session", session.status_code, session.json())
session_key = session.json()["sessionKey"]
request_id = "debug_status_case"
submit = client.post(
    "/tts/v2/jobs",
    headers={
        "x-dev-uid": "status_contract_user",
        "x-vf-tts-session-key": session_key,
        "Idempotency-Key": request_id,
    },
    json={
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "VECTOR",
        "text": "One.\nTwo.\nThree.\nFour.\nFive.",
    },
)
print("submit", submit.status_code, submit.json())
job = backend_app._TTS_V2_ENGINE._jobs.get(request_id)
if job is not None:
    print("job.payload", job.payload)
    print("job.status", job.status)
first = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "status_contract_user"})
print("first", first.status_code, first.json())
job = backend_app._TTS_V2_ENGINE._jobs.get(request_id)
if job is not None:
    print("job.payload.after", job.payload)
    print("job.status.after", job.status)
