from __future__ import annotations

from shared.tts_chunk_scheduler import (
    build_multi_speaker_chunk_plan,
    build_single_speaker_chunk_plan,
    normalize_text,
)


def _long_sentence(label: str) -> str:
    return (
        f"{label} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu "
        f"nu xi omicron pi rho sigma tau upsilon phi chi psi omega."
    )


def test_single_speaker_chunk_plan_uses_seeded_lane_sequence() -> None:
    text = " ".join(_long_sentence("Narrator") for _ in range(140))

    plan = build_single_speaker_chunk_plan(text)

    assert len(plan) >= 6
    assert [str(item.get("laneId") or "") for item in plan[:6]] == ["L1", "L1", "L2", "L2", "L3", "L3"]
    assert all(len(str(item.get("text") or "")) <= 700 for item in plan[:2])
    assert len(str(plan[2].get("text") or "")) <= 2600
    assert all(len(str(item.get("text") or "")) <= 5200 for item in plan[3:])
    rebuilt = normalize_text(" ".join(str(item.get("text") or "") for item in plan))
    assert rebuilt == normalize_text(text)


def test_multi_speaker_chunk_plan_round_robins_dialog_lanes_and_keeps_speaker_voice() -> None:
    line_map = [
        {"lineIndex": 0, "speaker": "Host", "text": " ".join(_long_sentence("Host") for _ in range(90))},
        {"lineIndex": 1, "speaker": "Guest", "text": " ".join(_long_sentence("Guest") for _ in range(20))},
        {"lineIndex": 2, "speaker": "Analyst", "text": " ".join(_long_sentence("Analyst") for _ in range(18))},
        {"lineIndex": 3, "speaker": "Caller", "text": " ".join(_long_sentence("Caller") for _ in range(16))},
    ]
    speaker_voices = [
        {"speaker": "Host", "voiceName": "Fenrir"},
        {"speaker": "Guest", "voiceName": "Kore"},
        {"speaker": "Analyst", "voiceName": "Aoede"},
        {"speaker": "Caller", "voiceName": "Puck"},
    ]

    plan = build_multi_speaker_chunk_plan(line_map=line_map, speaker_voices=speaker_voices)

    first_dialog_chunks = [item for item in plan if int(item.get("dialogueIndex", -1)) == 0]
    assert len(first_dialog_chunks) >= 3
    assert [str(item.get("laneId") or "") for item in first_dialog_chunks[:3]] == ["L1", "L1", "L1"]
    assert str(first_dialog_chunks[0].get("speaker") or "") == "Host"
    assert str(((first_dialog_chunks[0].get("speakerVoices") or [{}])[0]).get("voiceName") or "") == "Fenrir"

    first_chunk_by_dialog = {}
    for item in plan:
        dialogue_index = int(item.get("dialogueIndex", -1))
        first_chunk_by_dialog.setdefault(dialogue_index, item)

    assert str(first_chunk_by_dialog[1].get("laneId") or "") == "L2"
    assert str(first_chunk_by_dialog[2].get("laneId") or "") == "L3"
    assert str(first_chunk_by_dialog[3].get("laneId") or "") == "L1"

    rebuilt_dialogues = {}
    for item in plan:
        dialogue_index = int(item.get("dialogueIndex", -1))
        rebuilt_dialogues.setdefault(dialogue_index, []).append(str(item.get("text") or ""))
    for index, source in enumerate(line_map):
        rebuilt = normalize_text(" ".join(rebuilt_dialogues.get(index) or []))
        assert rebuilt == normalize_text(str(source.get("text") or ""))
