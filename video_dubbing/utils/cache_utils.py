from __future__ import annotations

import hashlib
from pathlib import Path


def file_md5(path: Path, chunk_size: int = 1024 * 1024) -> str:
    md5 = hashlib.md5()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            md5.update(chunk)
    return md5.hexdigest()


def cache_path(cache_root: Path, source_path: Path, suffix: str) -> Path:
    digest = file_md5(source_path)
    return cache_root / f"{digest}.{suffix.lstrip('.')}"
