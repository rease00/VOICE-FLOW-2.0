from __future__ import annotations

import importlib.util
import os
from pathlib import Path

os.environ.setdefault("VF_RUNTIME_NAME", "vertex-text-runtime")
os.environ.setdefault("VF_RUNTIME_ROLE", "text_only")
os.environ.setdefault("VF_RUNTIME_FORCE_AUTH_MODE", "vertex")

GEMINI_RUNTIME_APP = Path(__file__).resolve().parents[1] / "gemini-runtime" / "app.py"

spec = importlib.util.spec_from_file_location("voiceflow_vertex_text_runtime_impl", GEMINI_RUNTIME_APP)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

app = module.app
