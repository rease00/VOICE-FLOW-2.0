import os
import sys
from pathlib import Path


def test_video_dubbing_import_path() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    previous = os.getcwd()
    try:
        os.chdir(str(backend_root))
        if os.getcwd() not in sys.path:
            sys.path.insert(0, os.getcwd())
        import app  # noqa: F401
        from video_dubbing.main import run_pipeline  # noqa: F401
    finally:
        os.chdir(previous)
