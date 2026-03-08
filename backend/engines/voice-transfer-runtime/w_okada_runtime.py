from __future__ import annotations

import copy
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Optional


def _normalize_backend_mode(raw: Any, *, default: str = "auto") -> str:
    _ = raw
    _ = default
    return "onnx"


def _onnx_export_has_dynamic_axis(path: Path, *, input_name: str, axis: int) -> bool:
    try:
        import onnx
    except Exception:
        return False

    try:
        model = onnx.load(str(path))
    except Exception:
        return False

    for value in model.graph.input:
        if str(value.name or "").strip() != str(input_name or "").strip():
            continue
        dims = list(value.type.tensor_type.shape.dim)
        if axis < 0 or axis >= len(dims):
            return False
        return bool(dims[axis].dim_param)
    return False


class WOkadaOnnxRuntime:
    def __init__(self, *, models_dir: Path, device_token: str, default_backend_mode: str = "auto") -> None:
        self.models_dir = Path(models_dir).resolve()
        self.device_token = str(device_token or "cpu").strip() or "cpu"
        self._lock = threading.RLock()
        self._convert_lock = threading.Lock()
        self._active_signature: tuple[Any, ...] | None = None
        self._params: Any = None
        self._slot_info: Any = None
        self._onnx_slot_info: Any = None
        self._default_backend_mode = _normalize_backend_mode(default_backend_mode, default="onnx")
        self._backend_mode = "w_okada_rvc_onnx"
        self.import_error: Optional[str] = None

    def _runtime_models_dir(self) -> Path:
        return (self.models_dir / "models").resolve()

    def _slot_index(self) -> str:
        return str(Path("models") / "rvc")

    def _resolve_gpu_index(self) -> int:
        token = self.device_token.lower()
        if not token.startswith("cuda"):
            return -1
        if ":" not in token:
            return 0
        try:
            return max(0, int(token.split(":", 1)[1].strip() or "0"))
        except Exception:
            return 0

    def _is_cpu_device(self) -> bool:
        return self._resolve_gpu_index() < 0

    def _resolve_extra_convert_size(self) -> int:
        default_value = 256 if self._is_cpu_device() else 1024
        raw_value = (
            os.getenv("VF_VOICE_TRANSFER_EXTRA_CONVERT_SIZE")
            or os.getenv("VF_VOICE_TRANSFER_CHUNK_FACTOR")
            or str(default_value)
        )
        try:
            resolved = int(str(raw_value).strip() or str(default_value))
        except Exception:
            resolved = default_value
        return max(128, resolved)

    def _resolve_f0_method(self, raw_method: Optional[str]) -> str:
        method = str(raw_method or "rmvpe").strip().lower()
        if method == "pm":
            return "dio"

        allowed_methods = {"rmvpe", "rmvpe_onnx", "harvest", "dio", "crepe", "crepe_tiny", "crepe_full"}
        if method not in allowed_methods:
            return "rmvpe"

        if self._is_cpu_device() and method not in {"rmvpe", "rmvpe_onnx", "dio"}:
            return "rmvpe"
        return method

    def _ensure_support_assets(self, *, assets: Any) -> Path:
        runtime_models_dir = self._runtime_models_dir()
        if not runtime_models_dir.exists():
            raise RuntimeError(f"voice_transfer_models_dir_missing:{runtime_models_dir}")

        hubert_alias = (runtime_models_dir / "hubert_base.pt").resolve()
        if not hubert_alias.exists():
            hubert_source = (runtime_models_dir / "embeddings" / "hubert_base_ls960.pt").resolve()
            if not hubert_source.exists():
                hubert_source = Path(str(getattr(assets, "embedder_path", "") or "")).resolve()
            if not hubert_source.exists():
                raise RuntimeError(f"voice_transfer_hubert_missing:{hubert_source}")
            shutil.copy2(hubert_source, hubert_alias)

        rmvpe_alias = (runtime_models_dir / "rmvpe.pt").resolve()
        if not rmvpe_alias.exists():
            f0_source = Path(str(getattr(assets, "f0_path", "") or "")).resolve()
            if not f0_source.exists():
                f0_source = (runtime_models_dir / "f0" / "rmvpe.pt").resolve()
            if not f0_source.exists():
                raise RuntimeError(f"voice_transfer_rmvpe_missing:{f0_source}")
            shutil.copy2(f0_source, rmvpe_alias)

        return runtime_models_dir

    def _build_params(self, *, assets: Any) -> Any:
        runtime_models_dir = self._ensure_support_assets(assets=assets)
        try:
            from voice_changer.VoiceChangerParamsManager import VoiceChangerParamsManager
            from voice_changer.utils.VoiceChangerParams import VoiceChangerParams
        except Exception as exc:
            self.import_error = f"w_okada_params_import_failed:{exc}"
            raise RuntimeError(self.import_error) from exc

        content_vec = (runtime_models_dir / "embeddings" / "checkpoint_best_legacy_500.pt").resolve()
        if not content_vec.exists():
            content_vec = Path(str(getattr(assets, "embedder_path", "") or "")).resolve()
        hubert_base = (runtime_models_dir / "hubert_base.pt").resolve()
        rmvpe = (runtime_models_dir / "rmvpe.pt").resolve()

        params = VoiceChangerParams(
            model_dir=str(self.models_dir),
            content_vec_500=str(content_vec),
            content_vec_500_onnx="",
            content_vec_500_onnx_on=False,
            hubert_base=str(hubert_base),
            hubert_base_jp=str(hubert_base),
            hubert_soft=str(hubert_base),
            nsf_hifigan="",
            sample_mode="production",
            crepe_onnx_full="",
            crepe_onnx_tiny="",
            rmvpe=str(rmvpe),
            rmvpe_onnx="",
            whisper_tiny="",
        )
        VoiceChangerParamsManager.get_instance().setParams(params)
        return params

    def _exported_onnx_path(self, *, assets: Any) -> Path:
        checkpoint_path = Path(str(getattr(assets, "checkpoint_path", ""))).resolve()
        return checkpoint_path.with_name(f"{checkpoint_path.stem}_simple.onnx")

    def _build_signature(self, *, assets: Any) -> tuple[Any, ...]:
        checkpoint_path = Path(str(getattr(assets, "checkpoint_path", ""))).resolve()
        index_path = Path(str(getattr(assets, "index_path", ""))).resolve() if getattr(assets, "index_path", None) else None
        return (
            str(checkpoint_path),
            checkpoint_path.stat().st_mtime_ns if checkpoint_path.exists() else 0,
            str(index_path) if index_path else "",
            index_path.stat().st_mtime_ns if index_path and index_path.exists() else 0,
            self.device_token,
        )

    def _onnx_export_is_compatible(self, *, exported_onnx: Path, requires_pitch: bool) -> bool:
        if not exported_onnx.exists():
            return False
        if not _onnx_export_has_dynamic_axis(exported_onnx, input_name="feats", axis=1):
            return False
        if requires_pitch:
            if not _onnx_export_has_dynamic_axis(exported_onnx, input_name="pitch", axis=1):
                return False
            if not _onnx_export_has_dynamic_axis(exported_onnx, input_name="pitchf", axis=1):
                return False
        return True

    def _label_backend_mode(self, backend_mode: str) -> str:
        _ = backend_mode
        return "w_okada_rvc_onnx"

    def _resolve_requested_backend(self, backend_mode: Optional[str]) -> str:
        _ = backend_mode
        return "onnx"

    def _invalidate_loaded_state(self) -> None:
        with self._lock:
            self._active_signature = None
            self._slot_info = None
            self._onnx_slot_info = None
            self._params = None
            self._backend_mode = self._label_backend_mode("onnx")

    def _should_retry_with_fresh_export(self, exc: Exception) -> bool:
        detail = str(exc).strip().lower()
        return (
            "onnxruntimeerror" in detail
            and "invalid dimensions" in detail
            and "pitchf" in detail
        )

    def _run_rvc_inference(
        self,
        *,
        params: Any,
        slot_info: Any,
        audio: Any,
        source_sr: int,
        target_sr: int,
        safe_pitch: int,
        method: str,
        idx_rate: float,
    ) -> Any:
        from voice_changer.RVC.RVCr2 import RVCr2

        with self._convert_lock:
            converter = RVCr2(params, slot_info)
            converter.settings.gpu = self._resolve_gpu_index()
            converter.settings.f0Detector = method
            converter.settings.tran = safe_pitch
            converter.settings.indexRatio = idx_rate
            converter.settings.protect = 0.33
            converter.settings.silenceFront = 0
            converter.settings.extraConvertSize = self._resolve_extra_convert_size()
            converter.initialize()
            converter.setSamplingRate(int(source_sr), int(target_sr))
            return converter.inference(audio.astype("int16"), 0, 0)

    def backend_mode(self) -> str:
        return str(self._backend_mode or "w_okada_rvc_onnx")

    def configured_backend_mode(self) -> str:
        return str(self._default_backend_mode or "auto")

    def ensure_loaded(self, *, assets: Any, backend_mode: Optional[str] = None) -> None:
        with self._lock:
            signature = self._build_signature(assets=assets)
            has_cached_state = (
                self._active_signature == signature
                and self._params is not None
                and self._onnx_slot_info is not None
            )
            if has_cached_state:
                self._slot_info = self._onnx_slot_info
                self._backend_mode = self._label_backend_mode("onnx")
                return

            try:
                from const import TMP_DIR
                from data.ModelSlot import RVCModelSlot
                from voice_changer.RVC.RVCModelSlotGenerator import RVCModelSlotGenerator
                from voice_changer.RVC.onnxExporter.export2onnx import export2onnx
            except Exception as exc:
                self.import_error = f"w_okada_runtime_import_failed:{exc}"
                raise RuntimeError(self.import_error) from exc

            checkpoint_path = Path(str(getattr(assets, "checkpoint_path", ""))).resolve()
            if not checkpoint_path.exists():
                raise RuntimeError(f"voice_transfer_checkpoint_missing:{checkpoint_path}")

            index_path = Path(str(getattr(assets, "index_path", ""))).resolve() if getattr(assets, "index_path", None) else None
            self._params = self._build_params(assets=assets)

            slot_info = RVCModelSlot(
                slotIndex=self._slot_index(),
                modelFile=checkpoint_path.name,
                indexFile=index_path.name if index_path and index_path.exists() else "",
            )
            base_slot_info = RVCModelSlotGenerator._setInfoByPytorch(str(checkpoint_path), slot_info)
            base_slot_info.slotIndex = self._slot_index()
            base_slot_info.modelFile = checkpoint_path.name
            base_slot_info.indexFile = index_path.name if index_path and index_path.exists() else ""

            try:
                exported_onnx = self._exported_onnx_path(assets=assets)
                needs_export = (
                    not exported_onnx.exists()
                    or exported_onnx.stat().st_mtime_ns < checkpoint_path.stat().st_mtime_ns
                    or not self._onnx_export_is_compatible(
                        exported_onnx=exported_onnx,
                        requires_pitch=bool(getattr(base_slot_info, "f0", False)),
                    )
                )
                if needs_export:
                    output_name = export2onnx(self._resolve_gpu_index(), base_slot_info)
                    tmp_output = Path(TMP_DIR) / output_name
                    if not tmp_output.exists():
                        raise RuntimeError(f"w_okada_export_missing_output:{tmp_output}")
                    shutil.copy2(tmp_output, exported_onnx)

                onnx_slot_info = copy.deepcopy(base_slot_info)
                onnx_slot_info.modelFile = exported_onnx.name
                onnx_slot_info = RVCModelSlotGenerator._setInfoByONNX(str(exported_onnx), onnx_slot_info)
                onnx_slot_info.slotIndex = self._slot_index()
                onnx_slot_info.modelFile = exported_onnx.name
                onnx_slot_info.indexFile = index_path.name if index_path and index_path.exists() else ""
                self._onnx_slot_info = onnx_slot_info
            except Exception as exc:
                raise RuntimeError(f"w_okada_onnx_prepare_failed:{exc}") from exc

            self._slot_info = self._onnx_slot_info
            self._backend_mode = self._label_backend_mode("onnx")
            self._active_signature = signature
            self.import_error = None

    def convert(
        self,
        *,
        assets: Any,
        input_wav: str,
        output_wav: str,
        pitch_shift: int,
        f0_method: str,
        index_rate: Optional[float],
        backend_mode: Optional[str] = None,
    ) -> dict[str, Any]:
        _ = backend_mode
        self.ensure_loaded(assets=assets, backend_mode="onnx")

        try:
            import numpy as np
            import soundfile as sf
        except Exception as exc:
            self.import_error = f"w_okada_convert_import_failed:{exc}"
            raise RuntimeError(self.import_error) from exc

        params = self._params
        if params is None:
            raise RuntimeError("w_okada_runtime_not_initialized")

        slot_info = self._onnx_slot_info
        active_backend = "onnx"

        if slot_info is None:
            raise RuntimeError(f"w_okada_runtime_backend_unavailable:{active_backend}")

        safe_pitch = max(-24, min(24, int(pitch_shift)))
        method = self._resolve_f0_method(f0_method)

        idx_rate = 0.0
        if index_rate is not None:
            try:
                idx_rate = max(0.0, min(1.0, float(index_rate)))
            except Exception:
                idx_rate = 0.0

        audio, source_sr = sf.read(str(input_wav), dtype="int16", always_2d=False)
        if getattr(audio, "ndim", 1) > 1:
            audio = np.mean(audio, axis=1)
        audio = np.asarray(audio)
        if audio.dtype != np.int16:
            audio = np.clip(audio, -32768, 32767).astype(np.int16)

        target_sr = int(getattr(slot_info, "samplingRate", 0) or getattr(assets, "sample_rate", 0) or source_sr)
        self._slot_info = slot_info
        self._backend_mode = self._label_backend_mode(active_backend)

        try:
            converted = self._run_rvc_inference(
                params=params,
                slot_info=slot_info,
                audio=audio,
                source_sr=int(source_sr),
                target_sr=int(target_sr),
                safe_pitch=safe_pitch,
                method=method,
                idx_rate=idx_rate,
            )
        except Exception as exc:
            onnx_exc: Exception = exc
            if active_backend == "onnx" and self._should_retry_with_fresh_export(exc):
                self._invalidate_loaded_state()
                self.ensure_loaded(assets=assets, backend_mode="onnx")
                retry_slot_info = self._onnx_slot_info
                retry_params = self._params
                if retry_slot_info is not None and retry_params is not None:
                    target_sr = int(
                        getattr(retry_slot_info, "samplingRate", 0)
                        or getattr(assets, "sample_rate", 0)
                        or source_sr
                    )
                    try:
                        converted = self._run_rvc_inference(
                            params=retry_params,
                            slot_info=retry_slot_info,
                            audio=audio,
                            source_sr=int(source_sr),
                            target_sr=int(target_sr),
                            safe_pitch=safe_pitch,
                            method=method,
                            idx_rate=idx_rate,
                        )
                        self._slot_info = retry_slot_info
                        self._backend_mode = self._label_backend_mode("onnx")
                        onnx_exc = None  # type: ignore[assignment]
                    except Exception as retry_exc:
                        onnx_exc = retry_exc

            if onnx_exc is not None:
                raise RuntimeError(f"w_okada_inference_failed:{onnx_exc}") from onnx_exc

        converted = np.nan_to_num(np.asarray(converted, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
        if converted.dtype != np.int16:
            converted = np.clip(converted, -32768, 32767).astype(np.int16)

        sf.write(str(output_wav), converted, int(target_sr), subtype="PCM_16")
        return {
            "resolvedModelId": str(getattr(assets, "resolved_model_id", "") or ""),
            "indexUsed": bool(getattr(assets, "index_path", None) and idx_rate > 0.0),
            "f0Method": method,
            "exportedOnnxPath": str(self._exported_onnx_path(assets=assets)),
        }
