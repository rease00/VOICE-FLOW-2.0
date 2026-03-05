from __future__ import annotations

import hashlib
from pathlib import Path

import pytest


_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_GUARDED_CONFIG_FILES: tuple[Path, ...] = (
    _BACKEND_ROOT / "config" / "gemini_api_pools.json",
    _BACKEND_ROOT / "config" / "video_pipeline_asset_sources.json",
)


def _digest_file(path: Path) -> str:
    if not path.exists() or not path.is_file():
        return "<missing>"
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(autouse=True)
def _isolate_gemini_pools_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        '{"version":1,"pools":{"free":{"keys":[]}}}\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))


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
