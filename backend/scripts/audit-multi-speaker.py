#!/usr/bin/env python
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from video_dubbing.pipeline import stage6_tts


def _build_sample_segments() -> list[dict[str, object]]:
    speakers = ["A", "B", "C", "D", "A", "C", "B", "D"]
    segments: list[dict[str, object]] = []
    for index, speaker in enumerate(speakers):
        segments.append(
            {
                "speaker": speaker,
                "voice_id": "alloy",
                "text": f"line {index} for {speaker}",
                "translated_text": f"line {index} for {speaker}",
            }
        )
    return segments


def _audit_group_plan() -> dict[str, object]:
    segments = _build_sample_segments()
    started = time.perf_counter()
    plan = stage6_tts._build_grouped_plan(segments)  # noqa: SLF001
    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 3)

    if not isinstance(plan, dict):
        return {
            "ok": False,
            "reason": "grouped_plan_not_built",
            "elapsedMs": elapsed_ms,
        }

    line_map = list(plan.get("line_map") or [])
    groups = list(plan.get("groups") or [])
    line_indexes = [int(item.get("lineIndex", -1)) for item in line_map]
    contiguous = line_indexes == list(range(len(line_indexes)))
    group_speakers = [list(group.get("speakers") or []) for group in groups]
    group_sizes = [len(item) for item in group_speakers]

    return {
        "ok": bool(contiguous and len(groups) >= 2),
        "elapsedMs": elapsed_ms,
        "lineCount": len(line_map),
        "groupCount": len(groups),
        "groupSpeakerCounts": group_sizes,
        "lineIndexesContiguous": contiguous,
        "lineIndexes": line_indexes,
        "groups": group_speakers,
    }


def main() -> int:
    artifacts_dir = BACKEND_ROOT / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    report_path = artifacts_dir / "multi_speaker_audit.json"

    report = {
        "ok": True,
        "generatedAtMs": int(time.time() * 1000),
        "checks": {
            "groupPlan": _audit_group_plan(),
        },
    }
    if not bool(((report.get("checks") or {}).get("groupPlan") or {}).get("ok")):
        report["ok"] = False

    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"multi-speaker audit: {'PASS' if report['ok'] else 'FAIL'} -> {report_path}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
