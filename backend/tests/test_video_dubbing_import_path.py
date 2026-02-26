import os
import sys


def test_video_dubbing_import_path() -> None:
    previous = os.getcwd()
    try:
        os.chdir("backend")
        if os.getcwd() not in sys.path:
            sys.path.insert(0, os.getcwd())
        import app  # noqa: F401
        from video_dubbing.main import run_pipeline  # noqa: F401
    finally:
        os.chdir(previous)
