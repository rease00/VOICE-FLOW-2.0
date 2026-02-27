from __future__ import annotations

import os
from pathlib import Path

from shared.env_loader import load_backend_env_files


def test_env_loader_fills_empty_values_and_keeps_non_empty(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    backend = workspace / "backend"
    backend.mkdir(parents=True, exist_ok=True)

    (backend / ".env").write_text(
        "\n".join(
            [
                "FOO=backend_foo",
                "BAR=backend_bar",
                "BACK_ONLY=backend_only",
            ]
        ),
        encoding="utf-8",
    )
    (workspace / ".env").write_text(
        "\n".join(
            [
                "BAR=root_bar",
                "ROOT_ONLY=root_only",
            ]
        ),
        encoding="utf-8",
    )

    app_path = backend / "app.py"
    app_path.write_text("# test anchor\n", encoding="utf-8")

    monkeypatch.setenv("FOO", "external_non_empty")
    monkeypatch.setenv("BAR", "")
    monkeypatch.setenv("ROOT_ONLY", "")
    monkeypatch.delenv("BACK_ONLY", raising=False)

    load_backend_env_files(app_path)

    assert os.environ.get("FOO") == "external_non_empty"
    assert os.environ.get("BAR") == "backend_bar"
    assert os.environ.get("BACK_ONLY") == "backend_only"
    assert os.environ.get("ROOT_ONLY") == "root_only"
