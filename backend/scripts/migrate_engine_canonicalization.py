#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import app as backend_app


def main() -> int:
    parser = argparse.ArgumentParser(description="Rewrite legacy engine tokens to canonical VECTOR/PRIME values.")
    parser.add_argument("--mode", choices=("dry_run", "apply", "verify"), default="dry_run")
    parser.add_argument("--requested-by", dest="requested_by", default="cli")
    args = parser.parse_args()

    try:
        summary = backend_app._engine_canonicalization_migration(mode=args.mode, requested_by=args.requested_by)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        return 1

    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if bool(summary.get("ok", False)) else 2


if __name__ == "__main__":
    raise SystemExit(main())
