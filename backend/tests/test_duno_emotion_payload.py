from __future__ import annotations

import app as backend_app


def test_prepare_duno_runtime_payload_uses_native_tags_for_turbo_model() -> None:
    payload = backend_app._prepare_duno_runtime_payload(
        {
            "engine": "DUNO",
            "text": "Hello world",
            "emotion": "Happy",
            "style": "default",
            "model": "ResembleAI/chatterbox-turbo",
        }
    )

    assert payload["model"] == "ResembleAI/chatterbox-turbo"
    assert payload["emotion"] == "Happy"
    assert payload["text"].startswith("[laugh] ")


def test_prepare_duno_runtime_payload_uses_text_cues_for_non_turbo_model() -> None:
    payload = backend_app._prepare_duno_runtime_payload(
        {
            "engine": "DUNO",
            "text": "Hello world",
            "emotion": "Happy",
            "style": "whispering",
            "model": "ResembleAI/chatterbox-multilingual",
        }
    )

    assert payload["model"] == "ResembleAI/chatterbox-multilingual"
    assert payload["emotion"] == "Happy"
    assert payload["text"].startswith("[tone:happy] [energy:bright] [delivery:smiling] [style:whispering] ")
    assert "[laugh]" not in payload["text"]


def test_prepare_duno_runtime_payload_uses_text_cues_for_non_english_turbo_requests() -> None:
    payload = backend_app._prepare_duno_runtime_payload(
        {
            "engine": "DUNO",
            "text": "Namaste duniya",
            "emotion": "Crying",
            "style": "breathless",
            "language": "hi",
            "model": "ResembleAI/chatterbox-turbo",
        }
    )

    assert payload["model"] == "ResembleAI/chatterbox-turbo"
    assert payload["emotion"] == "Crying"
    assert payload["text"].startswith("[tone:sad] [delivery:broken] [event:crying] [style:breathless] ")
    assert "[laugh]" not in payload["text"]
