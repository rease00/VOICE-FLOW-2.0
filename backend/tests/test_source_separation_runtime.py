import sys
import types

import app as backend_app


class _FakeDemucsModel:
    def cpu(self):
        return self

    def eval(self):
        return self


def test_source_separation_runtime_falls_back_from_quantized_model(monkeypatch):
    runtime = backend_app.SourceSeparationRuntime()
    monkeypatch.setattr(runtime, "ensure_available", lambda: True)

    calls: list[str] = []
    fake_model = _FakeDemucsModel()

    def fake_get_model(*, name, repo=None):
        calls.append(str(name))
        if name == "mdx_extra_q":
            raise SystemExit(1)
        if name == "mdx_extra":
            return fake_model
        raise AssertionError(f"unexpected model name: {name}")

    monkeypatch.setitem(sys.modules, "demucs", types.SimpleNamespace())
    monkeypatch.setitem(sys.modules, "demucs.pretrained", types.SimpleNamespace(get_model=fake_get_model))

    resolved = runtime.get_model("mdx_extra_q")

    assert resolved is fake_model
    assert calls == ["mdx_extra_q", "mdx_extra"]
    assert runtime._models["mdx_extra_q"] is fake_model
    assert runtime._models["mdx_extra"] is fake_model
