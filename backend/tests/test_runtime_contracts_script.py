from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "test-runtime-contracts.mjs"
REPORT_PATH = BACKEND_ROOT / "artifacts" / "runtime_contract_conformance_report.json"


def _run_contract_script(*, media_backend_url: str, timeout_ms: int = 250, retries: int = 1, backoff_ms: int = 40) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["VF_MEDIA_BACKEND_URL"] = media_backend_url
    env["VF_RUNTIME_CONTRACT_TIMEOUT_MS"] = str(timeout_ms)
    env["VF_RUNTIME_CONTRACT_RETRIES"] = str(retries)
    env["VF_RUNTIME_CONTRACT_BACKOFF_MS"] = str(backoff_ms)
    return subprocess.run(
        ["node", str(SCRIPT_PATH)],
        cwd=str(BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _read_report() -> dict:
    assert REPORT_PATH.exists(), "runtime contract report was not written"
    return json.loads(REPORT_PATH.read_text(encoding="utf-8"))


def _engine_capability(engine: str) -> dict:
    return {
        "engine": engine,
        "runtime": f"{engine.lower()}_runtime",
        "ready": True,
        "languages": ["en"],
        "speed": {"min": 0.8, "max": 1.2, "default": 1.0},
        "supportsEmotion": True,
        "supportsStyle": True,
        "supportsSpeakerWav": False,
    }


def test_runtime_contract_script_classifies_backend_unreachable() -> None:
    result = _run_contract_script(media_backend_url="http://127.0.0.1:9", timeout_ms=120, retries=0, backoff_ms=20)
    assert result.returncode != 0
    report = _read_report()
    assert report["passed"] is False
    assert report["failures"], "expected at least one failure entry"
    first = report["failures"][0]
    assert first["class"] == "backend_unreachable"
    assert first["stage"] == "preflight"


def test_runtime_contract_script_allows_auth_challenge_preflight() -> None:
    class AuthPreflightHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/":
                body = json.dumps({"detail": "Missing bearer token."}).encode("utf-8")
                self.send_response(401)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path == "/tts/engines/capabilities":
                payload = {
                    "engines": {
                        "PRIME": _engine_capability("GEMINI"),
                        "VECTOR": _engine_capability("VECTOR"),
                        "DUNO": _engine_capability("DUNO"),
                    }
                }
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(404)
            self.end_headers()

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            _ = format, args

    server = HTTPServer(("127.0.0.1", 0), AuthPreflightHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    try:
        result = _run_contract_script(media_backend_url=base_url, timeout_ms=180, retries=0, backoff_ms=20)
        assert result.returncode == 0, result.stderr
        report = _read_report()
        assert report["passed"] is True
        assert not report["failures"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1.0)


def test_runtime_contract_script_retries_timeout_and_recovers() -> None:
    class RetryHandler(BaseHTTPRequestHandler):
        capabilities_calls = 0

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/":
                body = json.dumps({"ok": True}).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path == "/tts/engines/capabilities":
                RetryHandler.capabilities_calls += 1
                if RetryHandler.capabilities_calls == 1:
                    time.sleep(0.35)
                payload = {
                    "engines": {
                        "PRIME": _engine_capability("GEMINI"),
                        "VECTOR": _engine_capability("VECTOR"),
                        "DUNO": _engine_capability("DUNO"),
                    }
                }
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except BrokenPipeError:
                    # First request is expected to time out and drop the socket.
                    pass
                return
            self.send_response(404)
            self.end_headers()

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            _ = format, args

    server = HTTPServer(("127.0.0.1", 0), RetryHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    try:
        result = _run_contract_script(media_backend_url=base_url, timeout_ms=120, retries=2, backoff_ms=30)
        assert result.returncode == 0, result.stderr
        report = _read_report()
        assert report["passed"] is True
        assert RetryHandler.capabilities_calls >= 2
        assert report["checks"] and all(check["ok"] for check in report["checks"])
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1.0)


def test_runtime_contract_script_reports_schema_violation() -> None:
    class SchemaHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/":
                body = json.dumps({"ok": True}).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path == "/tts/engines/capabilities":
                body = json.dumps({"engines": {"PRIME": {"engine": "PRIME"}}}).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(404)
            self.end_headers()

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            _ = format, args

    server = HTTPServer(("127.0.0.1", 0), SchemaHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    try:
        result = _run_contract_script(media_backend_url=base_url, timeout_ms=180, retries=0, backoff_ms=20)
        assert result.returncode != 0
        report = _read_report()
        assert report["passed"] is False
        classes = {entry.get("class") for entry in report.get("failures") or []}
        assert "schema_violation" in classes
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1.0)
