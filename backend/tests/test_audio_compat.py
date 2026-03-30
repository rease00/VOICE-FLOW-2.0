from __future__ import annotations

from io import BytesIO
import wave

from services.audio_compat import lin2lin, mul, ratecv, rms, tomono, tostereo
from services.tts_v2_engine import _normalize_wav_for_stitch


def _build_wav_bytes(*, samples: list[tuple[int, int]] | list[int], sample_rate: int = 24_000, sample_width: int = 2) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1 if not samples or isinstance(samples[0], int) else 2)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        if samples and isinstance(samples[0], tuple):
            pcm = bytearray()
            for left, right in samples:  # type: ignore[misc]
                pcm.extend(int(left).to_bytes(sample_width, byteorder="little", signed=True))
                pcm.extend(int(right).to_bytes(sample_width, byteorder="little", signed=True))
            wav_file.writeframes(bytes(pcm))
        else:
            pcm = bytearray()
            for sample in samples:  # type: ignore[assignment]
                pcm.extend(int(sample).to_bytes(sample_width, byteorder="little", signed=True))
            wav_file.writeframes(bytes(pcm))
    return output.getvalue()


def _read_wav_header(wav_bytes: bytes) -> tuple[int, int, int, int]:
    with wave.open(BytesIO(wav_bytes), "rb") as wav_file:
        return (
            wav_file.getnchannels(),
            wav_file.getsampwidth(),
            wav_file.getframerate(),
            wav_file.getnframes(),
        )


def test_pcm_helpers_cover_width_conversion_and_gain_adjustment() -> None:
    mono = b"\x00\x00\xe8\x03\x18\xfc"
    stereo = tostereo(mono, 2, 1.0, 1.0)
    assert tomono(stereo, 2, 0.5, 0.5) == mono
    assert lin2lin(mono, 2, 2) == mono
    louder = mul(mono, 2, 2.0)
    assert len(louder) == len(mono)
    assert rms(louder, 2) >= rms(mono, 2)


def test_pcm_ratecv_resamples_pcm16_frames() -> None:
    frames = b"".join(int(value).to_bytes(2, byteorder="little", signed=True) for value in (0, 1000, 2000, 3000))
    resampled, state = ratecv(frames, 2, 1, 4, 8, None)
    assert state is None
    assert len(resampled) == 16
    assert rms(resampled, 2) > 0


def test_normalize_wav_for_stitch_rewrites_channel_count_and_rate() -> None:
    wav_bytes = _build_wav_bytes(samples=[(1000, 1000), (1000, 1000), (1000, 1000), (1000, 1000)], sample_rate=24_000)
    stitched, params, stitched_rms = _normalize_wav_for_stitch(wav_bytes, target_params=(1, 2, 12_000), target_rms=1000)
    assert params == (1, 2, 12_000)
    assert stitched_rms > 0
    channels, width, rate, frame_count = _read_wav_header(stitched)
    assert (channels, width, rate) == (1, 2, 12_000)
    assert frame_count > 0
