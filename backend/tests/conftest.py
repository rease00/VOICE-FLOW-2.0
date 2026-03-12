from __future__ import annotations

import hashlib
import os
import sys
import tempfile
from pathlib import Path

import pytest


_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_GUARDED_CONFIG_FILES: tuple[Path, ...] = (
    _BACKEND_ROOT / "config" / "gemini_api_pools.json",
)
_SESSION_GEMINI_POOLS_FILE = Path(tempfile.gettempdir()) / "voiceflow_pytest_gemini_api_pools.json"


def _write_isolated_gemini_pools_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        '{"version":1,"pools":{"free":{"keys":[]}}}\n',
        encoding="utf-8",
    )


# Set import-time defaults so module-level constants in app.py bind to isolated test paths.
_write_isolated_gemini_pools_file(_SESSION_GEMINI_POOLS_FILE)
os.environ["GEMINI_API_POOLS_FILE"] = str(_SESSION_GEMINI_POOLS_FILE)
os.environ["VF_GEMINI_AUTO_ROTATE_ON_POOL_EXHAUSTED"] = "0"


def _digest_file(path: Path) -> str:
    if not path.exists() or not path.is_file():
        return "<missing>"
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(autouse=True)
def _isolate_gemini_pools_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    pools_path = tmp_path / "gemini_api_pools.json"
    _write_isolated_gemini_pools_file(pools_path)
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    monkeypatch.setenv("VF_GEMINI_AUTO_ROTATE_ON_POOL_EXHAUSTED", "0")
    backend_app = sys.modules.get("app")
    if backend_app is not None:
        monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_FILE", str(pools_path), raising=False)
        monkeypatch.setattr(backend_app, "VF_GEMINI_AUTO_ROTATE_ON_POOL_EXHAUSTED", False, raising=False)


@pytest.fixture(scope="session", autouse=True)
def _guard_tracked_config_files() -> None:
    before = {str(path): _digest_file(path) for path in _GUARDED_CONFIG_FILES}
    yield
    changed: list[str] = []
    for path in _GUARDED_CONFIG_FILES:
        key = str(path)
        after_digest = _digest_file(path)
        if after_digest != before.get(key, ""):
            changed.append(f"{key} (before={before.get(key)}, after={after_digest})")
    if changed:
        details = "\n".join(changed)
        pytest.fail(
            "Tracked config files changed during pytest run. "
            "Tests must isolate GEMINI_API_POOLS_FILE and related manifests.\n"
            f"{details}",
            pytrace=False,
        )
