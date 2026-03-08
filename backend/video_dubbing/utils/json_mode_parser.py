from __future__ import annotations

import json
import re
from typing import Any, Literal


JsonExpectation = Literal["container", "object"]
JsonErrorKind = Literal["empty", "invalid", "not_object", "not_container"]


class JsonModeParseError(RuntimeError):
    def __init__(self, error_kind: JsonErrorKind, diagnostics: dict[str, Any]) -> None:
        super().__init__(f"json_parse_failed:{error_kind}")
        self.error_kind: JsonErrorKind = error_kind
        self.diagnostics: dict[str, Any] = dict(diagnostics)


class JsonModePipelineError(RuntimeError):
    def __init__(self, message: str, diagnostics: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.json_diagnostics: list[dict[str, Any]] = [
            dict(item)
            for item in list(diagnostics or [])
            if isinstance(item, dict)
        ]


def _snippet(value: str, limit: int = 240) -> str:
    token = str(value or "").strip().replace("\r", " ").replace("\n", " ")
    if len(token) <= limit:
        return token
    return token[: max(1, limit)].rstrip()


def _strip_code_fence(value: str) -> str:
    text = str(value or "").strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].strip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _replace_smart_quotes(value: str) -> str:
    return (
        str(value or "")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )


def _repair_common_json_issues(value: str) -> str:
    fixed = _replace_smart_quotes(value)
    # Fix keys like { ""index"": 0 }.
    fixed = re.sub(r'"{2,}([A-Za-z0-9_\-\s]+)"{2,}\s*:', r'"\1":', fixed)
    # Remove trailing commas before closing brackets/braces.
    fixed = re.sub(r",\s*([}\]])", r"\1", fixed)
    return fixed


def _extract_balanced_candidates(value: str) -> list[str]:
    text = str(value or "")
    out: list[str] = []
    stack: list[str] = []
    start_idx: int | None = None
    in_string = False
    escaped = False

    for idx, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch in "{[":
            if not stack:
                start_idx = idx
            stack.append(ch)
            continue

        if ch in "}]":
            if not stack:
                continue
            opener = stack.pop()
            if (opener, ch) not in {("{", "}"), ("[", "]")}:
                stack.clear()
                start_idx = None
                continue
            if not stack and start_idx is not None:
                candidate = text[start_idx : idx + 1].strip()
                if candidate:
                    out.append(candidate)
                start_idx = None
    return out


def _parse_json(candidate: str) -> Any:
    return json.loads(candidate)


def _expectation_error(parsed: Any, expect: JsonExpectation) -> JsonErrorKind | None:
    if expect == "object":
        return None if isinstance(parsed, dict) else "not_object"
    return None if isinstance(parsed, (dict, list)) else "not_container"


def parse_json_mode_payload(
    raw_text: str,
    *,
    expect: JsonExpectation = "container",
    attempt: int = 1,
    snippet_chars: int = 240,
) -> tuple[Any, dict[str, Any]]:
    normalized = _strip_code_fence(_replace_smart_quotes(str(raw_text or "").strip()))
    if not normalized:
        diagnostics = {
            "attempt": int(attempt),
            "repaired": False,
            "errorKind": "empty",
            "snippet": "",
        }
        raise JsonModeParseError("empty", diagnostics)

    candidates: list[str] = [normalized]
    candidates.extend(_extract_balanced_candidates(normalized))

    unique_candidates: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        token = str(item or "").strip()
        if not token or token in seen:
            continue
        seen.add(token)
        unique_candidates.append(token)

    observed_type_mismatch: JsonErrorKind | None = None

    for candidate in unique_candidates:
        variants: list[tuple[str, bool]] = [(candidate, False)]
        repaired = _repair_common_json_issues(candidate)
        if repaired != candidate:
            variants.append((repaired, True))

        for token, repaired_flag in variants:
            try:
                parsed = _parse_json(token)
            except Exception:
                continue

            mismatch = _expectation_error(parsed, expect)
            if mismatch is not None:
                observed_type_mismatch = mismatch
                continue

            diagnostics = {
                "attempt": int(attempt),
                "repaired": bool(repaired_flag),
                "errorKind": "",
                "snippet": _snippet(token, limit=snippet_chars),
            }
            return parsed, diagnostics

    error_kind: JsonErrorKind = observed_type_mismatch or "invalid"
    diagnostics = {
        "attempt": int(attempt),
        "repaired": False,
        "errorKind": error_kind,
        "snippet": _snippet(normalized, limit=snippet_chars),
    }
    raise JsonModeParseError(error_kind, diagnostics)
