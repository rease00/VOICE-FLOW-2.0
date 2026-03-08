from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from uuid import uuid4


def _load_runtime_module():
    module_path = Path(__file__).resolve().parents[1] / "engines" / "voice-transfer-runtime" / "w_okada_runtime.py"
    module_name = f"voice_transfer_w_okada_runtime_test_{uuid4().hex}"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_cpu_default_extra_convert_size_is_256(monkeypatch, tmp_path: Path) -> None:
    runtime_module = _load_runtime_module()
    monkeypatch.delenv("VF_VOICE_TRANSFER_EXTRA_CONVERT_SIZE", raising=False)
    monkeypatch.delenv("VF_VOICE_TRANSFER_CHUNK_FACTOR", raising=False)

    runtime = runtime_module.WOkadaOnnxRuntime(models_dir=tmp_path, device_token="cpu")
    assert runtime._resolve_extra_convert_size() == 256


def test_cpu_runtime_forces_slow_f0_extractors_back_to_rmvpe(tmp_path: Path) -> None:
    runtime_module = _load_runtime_module()
    runtime = runtime_module.WOkadaOnnxRuntime(models_dir=tmp_path, device_token="cpu")

    assert runtime._resolve_f0_method("harvest") == "rmvpe"
    assert runtime._resolve_f0_method("crepe") == "rmvpe"
    assert runtime._resolve_f0_method("crepe_full") == "rmvpe"
    assert runtime._resolve_f0_method("rmvpe") == "rmvpe"
    assert runtime._resolve_f0_method("pm") == "dio"


def test_gpu_runtime_keeps_non_cpu_f0_extractors_available(tmp_path: Path) -> None:
    runtime_module = _load_runtime_module()
    runtime = runtime_module.WOkadaOnnxRuntime(models_dir=tmp_path, device_token="cuda:0")

    assert runtime._resolve_f0_method("harvest") == "harvest"
