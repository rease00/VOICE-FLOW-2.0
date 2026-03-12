from __future__ import annotations

import importlib.util
from pathlib import Path

import app as backend_app
from services.reader_domain import build_text_windows


_BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _load_module(module_name: str, relative_path: str):
    module_path = _BACKEND_ROOT / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_GEMINI_SEGMENTATION = _load_module("test_gemini_runtime_segmentation", "engines/gemini-runtime/segmentation.py")
_KOKORO_SEGMENTATION = _load_module("test_kokoro_runtime_segmentation", "engines/kokoro-runtime/segmentation.py")


def _build_sentence(count: int, prefix: str, punctuation: str = ".") -> str:
    return f"{' '.join(f'{prefix}{index:02d}' for index in range(count))}{punctuation}"


def test_gateway_live_chunker_keeps_slightly_oversized_sentence_intact() -> None:
    sentence = _build_sentence(50, "segment")
    assert len(sentence) > 420

    chunks = backend_app._split_plain_text_live_chunks(sentence, max_chars=420, max_words=80)

    assert chunks == [{"text": sentence, "textChars": len(sentence), "wordCount": 50}]


def test_gateway_live_chunker_never_slices_a_single_long_word() -> None:
    long_word = "supercalifragilisticexpialidocious" * 8

    chunks = backend_app._split_plain_text_live_chunks(long_word, max_chars=120, max_words=12)

    assert len(chunks) == 1
    assert chunks[0]["text"] == long_word
    assert chunks[0]["wordCount"] == 1


def test_gateway_live_chunker_targets_sentence_safe_100_150_window() -> None:
    text = " ".join(
        [
            _build_sentence(8, "chunka"),
            _build_sentence(8, "chunkb"),
            _build_sentence(8, "chunkc"),
            _build_sentence(8, "chunkd"),
        ]
    )

    chunks = backend_app._split_plain_text_live_chunks(text, max_chars=150, max_words=26)

    assert len(chunks) == 2
    assert [chunk["wordCount"] for chunk in chunks] == [16, 16]
    assert all(100 <= int(chunk["textChars"]) <= 150 for chunk in chunks)
    assert all(int(chunk["wordCount"]) <= 26 for chunk in chunks)


def test_gateway_live_chunker_splits_oversized_sentence_by_word_fallback() -> None:
    oversized_sentence = _build_sentence(24, "oversized")

    chunks = backend_app._split_plain_text_live_chunks(oversized_sentence, max_chars=150, max_words=26)

    assert len(chunks) >= 2
    assert sum(int(chunk["wordCount"]) for chunk in chunks) == 24
    assert all(100 <= int(chunk["textChars"]) <= 150 for chunk in chunks)
    assert all(int(chunk["wordCount"]) <= 26 for chunk in chunks)


def test_gateway_live_chunker_word_fallback_preserves_single_token_boundaries() -> None:
    long_word = "ultralongcompoundtoken" * 20

    chunks = backend_app._split_plain_text_live_chunks(long_word, max_chars=150, max_words=26)

    assert len(chunks) == 1
    assert chunks[0]["text"] == long_word
    assert chunks[0]["wordCount"] == 1


def test_reader_text_windows_keep_slightly_oversized_sentence_together() -> None:
    sentence = _build_sentence(45, "bhaag", punctuation="\u0964")
    assert len(sentence) > 220

    windows = build_text_windows(sentence, window_chars=220)

    assert len(windows) == 1
    assert windows[0]["text"] == sentence
    assert windows[0]["charCount"] == len(sentence)


def test_gemini_runtime_segmentation_keeps_sentence_intact() -> None:
    sentence = _build_sentence(70, "segment")

    chunks = _GEMINI_SEGMENTATION.chunk_text_for_tts(sentence, "en")

    assert chunks == [sentence]


def test_kokoro_runtime_segmentation_avoids_mid_word_cuts() -> None:
    long_word = "ultralongcompoundtoken" * 14
    assert len(long_word) > 220

    chunks = _KOKORO_SEGMENTATION.chunk_text_for_tts(long_word, "en")

    assert chunks == [long_word]
