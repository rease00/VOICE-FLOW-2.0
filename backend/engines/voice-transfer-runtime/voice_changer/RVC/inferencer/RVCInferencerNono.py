import torch
from const import EnumInferenceTypes

from voice_changer.RVC.deviceManager.DeviceManager import DeviceManager
from voice_changer.RVC.inferencer.Inferencer import Inferencer
from .rvc_models.infer_pack.models import SynthesizerTrnMs256NSFsid_nono


def _load_trusted_checkpoint(path: str):
    load_kwargs = {"map_location": "cpu"}
    try:
        return torch.load(path, weights_only=False, **load_kwargs)
    except TypeError:
        return torch.load(path, **load_kwargs)


class RVCInferencerNono(Inferencer):
    def loadModel(self, file: str, gpu: int):
        self.setProps(EnumInferenceTypes.pyTorchRVCNono, file, True, gpu)

        dev = DeviceManager.get_instance().getDevice(gpu)
        isHalf = DeviceManager.get_instance().halfPrecisionAvailable(gpu)

        cpt = _load_trusted_checkpoint(file)
        model = SynthesizerTrnMs256NSFsid_nono(*cpt["config"], is_half=isHalf)

        model.eval()
        model.load_state_dict(cpt["weight"], strict=False)

        model = model.to(dev)
        if isHalf:
            model = model.half()

        self.model = model
        return self

    def infer(
        self,
        feats: torch.Tensor,
        pitch_length: torch.Tensor,
        pitch: torch.Tensor | None,
        pitchf: torch.Tensor | None,
        sid: torch.Tensor,
        convert_length: int | None,
    ) -> torch.Tensor:
        res = self.model.infer(feats, pitch_length, sid, convert_length=convert_length)
        res = res[0][0, 0].to(dtype=torch.float32)
        res = torch.clip(res, -1.0, 1.0)
        return res  
