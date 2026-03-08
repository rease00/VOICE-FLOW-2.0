from __future__ import annotations

import http.server
import json
import os
import socketserver
import subprocess
import threading
from pathlib import Path


def test_download_llvc_models_rejects_hash_mismatch(tmp_path: Path) -> None:
    sample_dir = tmp_path / "web"
    sample_dir.mkdir(parents=True, exist_ok=True)
    sample_file = sample_dir / "sample.bin"
    sample_file.write_bytes(b"voiceflow-test-payload")

    handler = http.server.SimpleHTTPRequestHandler
    previous_cwd = Path.cwd()
    os.chdir(sample_dir)

    try:
        with socketserver.TCPServer(("127.0.0.1", 0), handler) as server:
            port = int(server.server_address[1])
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            manifest_path = tmp_path / "voice_transfer_model_sources.json"
            out_manifest_path = tmp_path / "llvc_model_download_manifest.json"
            models_root = tmp_path / "models_root"

            manifest_payload = {
                "version": "test",
                "models": [
                    {
                        "id": "bad_hash",
                        "required": True,
                        "url": f"http://127.0.0.1:{port}/sample.bin",
                        "outputPath": "models/rvc/sample.bin",
                        "sha256": "0" * 64,
                    }
                ],
            }
            manifest_path.write_text(json.dumps(manifest_payload), encoding="utf-8")

            cmd = [
                "node",
                "scripts/download-voice-transfer-models.mjs",
                "--manifest",
                str(manifest_path),
                "--out",
                str(out_manifest_path),
                "--models-dir",
                str(models_root),
            ]
            result = subprocess.run(
                cmd,
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True,
                text=True,
            )

            assert result.returncode != 0
            assert out_manifest_path.exists()
            report = json.loads(out_manifest_path.read_text(encoding="utf-8"))
            assert int(report.get("summary", {}).get("failed", 0)) == 1
            rows = report.get("models") if isinstance(report.get("models"), list) else []
            assert rows
            assert str(rows[0].get("status") or "") in {"failed", "hash_mismatch"}
            server.shutdown()
            thread.join(timeout=2)
    finally:
        os.chdir(previous_cwd)
