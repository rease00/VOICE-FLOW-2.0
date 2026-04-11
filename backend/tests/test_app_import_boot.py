from __future__ import annotations

from pathlib import Path
import subprocess
import sys


def test_backend_app_imports_without_boot_errors() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-c", "import app"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, (
        "backend app import failed:\n"
        f"stdout={result.stdout.strip()}\n"
        f"stderr={result.stderr.strip()}"
    )
