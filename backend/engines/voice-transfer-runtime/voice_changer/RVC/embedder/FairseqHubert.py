import inspect

import torch
from torch import device
from voice_changer.RVC.embedder.Embedder import Embedder
from fairseq import checkpoint_utils


def _load_model_ensemble_with_torch_compat(file: str):
    original_torch_load = torch.load

    def _torch_load_compat(*args, **kwargs):
        # Torch 2.6+ defaults weights_only=True, but fairseq hubert checkpoints
        # rely on loading the full serialized object graph.
        if "weights_only" in inspect.signature(original_torch_load).parameters:
            kwargs.setdefault("weights_only", False)
        return original_torch_load(*args, **kwargs)

    try:
        torch.load = _torch_load_compat
        return checkpoint_utils.load_model_ensemble_and_task(
            [file],
            suffix="",
        )
    finally:
        torch.load = original_torch_load


class FairseqHubert(Embedder):
    def loadModel(self, file: str, dev: device, isHalf: bool = True) -> Embedder:
        super().setProps("hubert_base", file, dev, isHalf)

        models, saved_cfg, task = _load_model_ensemble_with_torch_compat(file)
        model = models[0]
        model.eval()

        model = model.to(dev)
        if isHalf:
            model = model.half()

        self.model = model
        return self

    def extractFeatures(
        self, feats: torch.Tensor, embOutputLayer=9, useFinalProj=True
    ) -> torch.Tensor:
        padding_mask = torch.BoolTensor(feats.shape).to(self.dev).fill_(False)

        # オリジナル_v1は L9にfinal_projをかけていた。(-> 256)
        # オリジナル_v2は L12にfinal_projをかけない。(-> 768)

        inputs = {
            "source": feats.to(self.dev),
            "padding_mask": padding_mask,
            "output_layer": embOutputLayer,  # 9 or 12
        }

        with torch.no_grad():
            logits = self.model.extract_features(**inputs)
            if useFinalProj:
                feats = self.model.final_proj(logits[0])
            else:
                feats = logits[0]
        return feats
