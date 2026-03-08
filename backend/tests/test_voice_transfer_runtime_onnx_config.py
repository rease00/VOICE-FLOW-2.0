from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from uuid import uuid4


def _load_device_manager_module():
    module_path = (
        Path(__file__).resolve().parents[1]
        / "engines"
        / "voice-transfer-runtime"
        / "voice_changer"
        / "RVC"
        / "deviceManager"
        / "DeviceManager.py"
    )
    module_name = f"voice_transfer_device_manager_test_{uuid4().hex}"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_device_manager_builds_low_latency_cpu_onnx_options(monkeypatch) -> None:
    device_manager_module = _load_device_manager_module()
    monkeypatch.setattr(device_manager_module.os, "cpu_count", lambda: 12)
    monkeypatch.setattr(
        device_manager_module.onnxruntime,
        "get_available_providers",
        lambda: ["CPUExecutionProvider"],
    )
    monkeypatch.setenv("VF_VOICE_TRANSFER_ONNX_INTRA_THREADS", "3")
    monkeypatch.setenv("VF_VOICE_TRANSFER_ONNX_INTER_THREADS", "1")

    device_manager = device_manager_module.DeviceManager()
    device_manager.gpu_num = 0

    session_options = device_manager.buildOnnxSessionOptions(-1)

    assert session_options.log_severity_level == 3
    assert session_options.intra_op_num_threads == 3
    assert session_options.inter_op_num_threads == 1
    assert session_options.execution_mode == device_manager_module.onnxruntime.ExecutionMode.ORT_SEQUENTIAL

    providers, provider_options = device_manager.getOnnxExecutionProvider(-1)
    assert providers == ["CPUExecutionProvider"]
    assert provider_options == [{}]


def test_device_manager_prefers_openvino_for_cpu_default_when_available(monkeypatch) -> None:
    device_manager_module = _load_device_manager_module()
    monkeypatch.setattr(
        device_manager_module.onnxruntime,
        "get_available_providers",
        lambda: ["OpenVINOExecutionProvider", "CPUExecutionProvider"],
    )

    device_manager = device_manager_module.DeviceManager()
    device_manager.gpu_num = 0

    providers, provider_options = device_manager.getOnnxExecutionProvider(-1)
    assert providers == ["OpenVINOExecutionProvider"]
    assert provider_options == [{"device_type": "CPU"}]


def test_device_manager_honors_explicit_openvino_provider_request(monkeypatch) -> None:
    device_manager_module = _load_device_manager_module()
    monkeypatch.setenv("VF_VOICE_TRANSFER_ONNX_PROVIDER", "openvino")
    monkeypatch.setenv("VF_VOICE_TRANSFER_OPENVINO_DEVICE_TYPE", "AUTO:GPU,NPU,CPU")
    monkeypatch.setenv("VF_VOICE_TRANSFER_OPENVINO_NUM_THREADS", "4")
    monkeypatch.setenv("VF_VOICE_TRANSFER_OPENVINO_NUM_STREAMS", "2")
    monkeypatch.setattr(
        device_manager_module.onnxruntime,
        "get_available_providers",
        lambda: ["OpenVINOExecutionProvider", "CPUExecutionProvider"],
    )

    device_manager = device_manager_module.DeviceManager()
    device_manager.gpu_num = 0

    providers, provider_options = device_manager.getOnnxExecutionProvider(-1)
    assert providers == ["OpenVINOExecutionProvider"]
    assert provider_options == [
        {
            "device_type": "AUTO:GPU,NPU,CPU",
            "num_of_threads": "4",
            "num_streams": "2",
        }
    ]


def test_device_manager_honors_explicit_cpu_provider_request(monkeypatch) -> None:
    device_manager_module = _load_device_manager_module()
    monkeypatch.setenv("VF_VOICE_TRANSFER_ONNX_PROVIDER", "cpu")
    monkeypatch.setattr(
        device_manager_module.onnxruntime,
        "get_available_providers",
        lambda: ["OpenVINOExecutionProvider", "CPUExecutionProvider"],
    )

    device_manager = device_manager_module.DeviceManager()
    device_manager.gpu_num = 0

    providers, provider_options = device_manager.getOnnxExecutionProvider(-1)
    assert providers == ["CPUExecutionProvider"]
    assert provider_options == [{}]
