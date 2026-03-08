import os

import onnxruntime
import torch


class DeviceManager(object):
    _instance = None
    forceTensor: bool = False

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.gpu_num = torch.cuda.device_count()
        self.mps_enabled: bool = (
            getattr(torch.backends, "mps", None) is not None
            and torch.backends.mps.is_available()
        )

    def getDevice(self, id: int):
        if id < 0 or self.gpu_num == 0:
            if self.mps_enabled is False:
                dev = torch.device("cpu")
            else:
                dev = torch.device("mps")
        else:
            if id < self.gpu_num:
                dev = torch.device("cuda", index=id)
            else:
                print("[Voice Changer] device detection error, fallback to cpu")
                dev = torch.device("cpu")
        return dev

    def _cpu_thread_defaults(self) -> tuple[int, int]:
        logical_cores = max(1, int(os.cpu_count() or 1))
        default_intra_threads = min(4, logical_cores)
        intra_threads = max(
            1,
            int((os.getenv("VF_VOICE_TRANSFER_ONNX_INTRA_THREADS") or str(default_intra_threads)).strip() or default_intra_threads),
        )
        inter_threads = max(
            1,
            int((os.getenv("VF_VOICE_TRANSFER_ONNX_INTER_THREADS") or "1").strip() or "1"),
        )
        return intra_threads, inter_threads

    def buildOnnxSessionOptions(self, gpu: int):
        session_options = onnxruntime.SessionOptions()
        session_options.log_severity_level = 3
        try:
            session_options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
        except Exception:
            pass

        if gpu < 0 or self.gpu_num == 0:
            intra_threads, inter_threads = self._cpu_thread_defaults()
            try:
                session_options.intra_op_num_threads = intra_threads
            except Exception:
                pass
            try:
                session_options.inter_op_num_threads = inter_threads
            except Exception:
                pass
            try:
                session_options.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL
            except Exception:
                pass
            try:
                session_options.enable_mem_pattern = False
            except Exception:
                pass
        else:
            try:
                session_options.execution_mode = onnxruntime.ExecutionMode.ORT_PARALLEL
            except Exception:
                pass

        return session_options

    def _requested_onnx_provider(self) -> str:
        requested = str(os.getenv("VF_VOICE_TRANSFER_ONNX_PROVIDER") or "auto").strip().lower()
        if requested in {"auto", "cpu", "cuda", "dml", "openvino"}:
            return requested
        return "auto"

    def _openvino_provider_options(self) -> dict[str, str]:
        options: dict[str, str] = {
            "device_type": str(os.getenv("VF_VOICE_TRANSFER_OPENVINO_DEVICE_TYPE") or "CPU").strip().upper() or "CPU",
        }
        num_threads = str(os.getenv("VF_VOICE_TRANSFER_OPENVINO_NUM_THREADS") or "").strip()
        if num_threads:
            options["num_of_threads"] = num_threads
        num_streams = str(os.getenv("VF_VOICE_TRANSFER_OPENVINO_NUM_STREAMS") or "").strip()
        if num_streams:
            options["num_streams"] = num_streams
        return options

    def _cpu_execution_provider(self):
        return ["CPUExecutionProvider"], [{}]

    def getOnnxExecutionProvider(self, gpu: int):
        availableProviders = onnxruntime.get_available_providers()
        devNum = torch.cuda.device_count()
        requested = self._requested_onnx_provider()

        if requested == "auto" and (gpu < 0 or devNum <= 0):
            if "OpenVINOExecutionProvider" in availableProviders:
                return ["OpenVINOExecutionProvider"], [self._openvino_provider_options()]
            return self._cpu_execution_provider()

        if requested == "openvino":
            if "OpenVINOExecutionProvider" in availableProviders:
                return ["OpenVINOExecutionProvider"], [self._openvino_provider_options()]
            print("[Voice Changer] OpenVINOExecutionProvider requested but unavailable, fallback to CPU")
            return self._cpu_execution_provider()

        if requested == "cuda":
            if gpu >= 0 and "CUDAExecutionProvider" in availableProviders and devNum > 0:
                if gpu < devNum:
                    return ["CUDAExecutionProvider"], [{"device_id": gpu}]
                print("[Voice Changer] device detection error, fallback to cpu")
            return self._cpu_execution_provider()

        if requested == "dml":
            if gpu >= 0 and "DmlExecutionProvider" in availableProviders:
                return ["DmlExecutionProvider"], [{"device_id": gpu}]
            return self._cpu_execution_provider()

        if requested == "cpu":
            return self._cpu_execution_provider()

        if gpu >= 0 and "CUDAExecutionProvider" in availableProviders and devNum > 0:
            if gpu < devNum:
                return ["CUDAExecutionProvider"], [{"device_id": gpu}]
            print("[Voice Changer] device detection error, fallback to cpu")
            return self._cpu_execution_provider()
        if gpu >= 0 and "DmlExecutionProvider" in availableProviders:
            return ["DmlExecutionProvider"], [{"device_id": gpu}]
        return self._cpu_execution_provider()

    def setForceTensor(self, forceTensor: bool):
        self.forceTensor = forceTensor

    def halfPrecisionAvailable(self, id: int):
        if self.gpu_num == 0:
            return False
        if id < 0:
            return False
        if self.forceTensor:
            return False

        try:
            gpuName = torch.cuda.get_device_name(id).upper()
            if (
                ("16" in gpuName and "V100" not in gpuName)
                or "P40" in gpuName.upper()
                or "1070" in gpuName
                or "1080" in gpuName
            ):
                return False
        except Exception as e:
            print(e)
            return False

        cap = torch.cuda.get_device_capability(id)
        if cap[0] < 7:
            return False

        return True

    def getDeviceMemory(self, id: int):
        try:
            return torch.cuda.get_device_properties(id).total_memory
        except Exception as e:
            print(e)
            return 0
