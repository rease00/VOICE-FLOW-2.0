from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def _load_gemini_runtime_module():
    workspace_root = Path(__file__).resolve().parents[1]
    runtime_dir = workspace_root / "engines" / "gemini-runtime"
    module_path = runtime_dir / "app.py"
    if str(workspace_root) not in sys.path:
        sys.path.insert(0, str(workspace_root))
    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))
    spec = importlib.util.spec_from_file_location("gemini_runtime_app_text_only", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_text_only_runtime_reports_tts_allocator_limits_disabled(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    runtime.VF_RUNTIME_ROLE = runtime.RUNTIME_ROLE_TEXT_ONLY
    runtime.GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS = False

    monkeypatch.setattr(runtime, "_runtime_source_policy", lambda: {"provider": runtime.SOURCE_POLICY_PROVIDER_VERTEX})
    monkeypatch.setattr(runtime, "_cloud_tts_client_ready", lambda source_policy=None: True)

    effective_limits = runtime._effective_tts_route_limits()
    assert effective_limits["rateLimitsDisabled"] is True
    assert effective_limits["rpm"] == -1
    assert effective_limits["tpm"] == -1

    client = TestClient(runtime.app)
    response = client.get("/v1/capabilities")
    assert response.status_code == 200
    metadata = dict(response.json().get("metadata") or {})
    assert metadata["ttsAllocatorRateLimitsDisabled"] is True
