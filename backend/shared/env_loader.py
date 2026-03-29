from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


def _parse_env_value(raw_value: str) -> str:
    trimmed = str(raw_value or "").strip()
    if not trimmed:
        return ""

    quote = trimmed[:1]
    is_quoted = (
        (quote == '"' and trimmed.endswith('"'))
        or (quote == "'" and trimmed.endswith("'"))
    )
    if not is_quoted:
        return trimmed

    inner = trimmed[1:-1]
    if quote == '"':
        inner = (
            inner.replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )
    return inner


def _load_env_file(path: Path) -> None:
    if not path.exists() or not path.is_file():
        return

    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return

    for line in lines:
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue

        normalized = trimmed[7:].strip() if trimmed.startswith("export ") else trimmed
        equals_index = normalized.find("=")
        if equals_index <= 0:
            continue

        key = normalized[:equals_index].strip()
        if not key:
            continue
        if not key.replace("_", "A").isalnum() or key[0].isdigit():
            continue

        raw_value = normalized[equals_index + 1 :]
        parsed_value = _parse_env_value(raw_value)

        existing = os.getenv(key)
        if existing is not None and str(existing).strip() != "":
            # Allow .env fallback when a pre-set credential path is stale/missing.
            if key == "GOOGLE_APPLICATION_CREDENTIALS":
                candidate = Path(str(existing).strip()).expanduser()
                if candidate.exists() and candidate.is_file():
                    continue
            elif key in {"GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"}:
                # Prefer workspace/project-local project id over machine-global defaults.
                if str(parsed_value).strip() == str(existing).strip():
                    continue
            else:
                continue

        os.environ[key] = parsed_value


def _resolve_backend_root(current_file: Path) -> Path:
    probe = current_file.resolve()
    for parent in [probe.parent, *probe.parents]:
        if parent.name.lower() == "backend":
            return parent
    return probe.parent


def load_backend_env_files(current_file: Optional[Path] = None) -> list[Path]:
    anchor = Path(current_file or __file__).resolve()
    backend_root = _resolve_backend_root(anchor)
    workspace_root = backend_root.parent
    env_files = [
        backend_root / ".env.local",
        workspace_root / ".env.local",
        backend_root / ".env",
        workspace_root / ".env",
    ]
    for env_path in env_files:
        _load_env_file(env_path)
    return env_files

