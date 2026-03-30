from __future__ import annotations

import math
from typing import Any

import numpy as np


def _max_int_for_width(width: int) -> int:
    safe_width = max(1, int(width or 1))
    return (1 << (safe_width * 8 - 1)) - 1


def _min_int_for_width(width: int) -> int:
    safe_width = max(1, int(width or 1))
    return -(1 << (safe_width * 8 - 1))


def _decode_pcm(frames: bytes, width: int) -> np.ndarray:
    safe_width = max(1, int(width or 1))
    raw = bytes(frames or b"")
    if not raw:
        return np.zeros(0, dtype=np.int64)

    if safe_width == 1:
        samples = np.frombuffer(raw, dtype=np.uint8).astype(np.int64)
        return samples - 128
    if safe_width == 2:
        return np.frombuffer(raw[: len(raw) - (len(raw) % 2)], dtype="<i2").astype(np.int64)
    if safe_width == 4:
        return np.frombuffer(raw[: len(raw) - (len(raw) % 4)], dtype="<i4").astype(np.int64)
    if safe_width == 3:
        usable = len(raw) - (len(raw) % 3)
        if not usable:
            return np.zeros(0, dtype=np.int64)
        triples = np.frombuffer(raw[:usable], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        values = triples[:, 0] | (triples[:, 1] << 8) | (triples[:, 2] << 16)
        sign_bit = 1 << 23
        values = (values ^ sign_bit) - sign_bit
        return values.astype(np.int64)
    raise ValueError(f"Unsupported PCM width: {safe_width}")


def _encode_pcm(samples: np.ndarray, width: int) -> bytes:
    safe_width = max(1, int(width or 1))
    values = np.asarray(samples, dtype=np.int64)
    if values.size == 0:
        return b""

    if safe_width == 1:
        clipped = np.clip(values, -128, 127) + 128
        return clipped.astype(np.uint8).tobytes()
    if safe_width == 2:
        clipped = np.clip(values, _min_int_for_width(2), _max_int_for_width(2)).astype("<i2")
        return clipped.tobytes()
    if safe_width == 4:
        clipped = np.clip(values, _min_int_for_width(4), _max_int_for_width(4)).astype("<i4")
        return clipped.tobytes()
    if safe_width == 3:
        clipped = np.clip(values, _min_int_for_width(3), _max_int_for_width(3)).astype(np.int32)
        out = np.empty((clipped.size, 3), dtype=np.uint8)
        out[:, 0] = clipped & 0xFF
        out[:, 1] = (clipped >> 8) & 0xFF
        out[:, 2] = (clipped >> 16) & 0xFF
        return out.reshape(-1).tobytes()
    raise ValueError(f"Unsupported PCM width: {safe_width}")


def _reshape_frames(frames: bytes, width: int, channels: int) -> np.ndarray:
    safe_channels = max(1, int(channels or 1))
    samples = _decode_pcm(frames, width)
    if safe_channels <= 1:
        return samples.reshape(-1, 1)
    usable = samples.size - (samples.size % safe_channels)
    if usable <= 0:
        return np.zeros((0, safe_channels), dtype=np.int64)
    return samples[:usable].reshape(-1, safe_channels)


def _pack_frames(samples: np.ndarray, width: int) -> bytes:
    flattened = np.asarray(samples, dtype=np.int64).reshape(-1)
    return _encode_pcm(flattened, width)


def lin2lin(frames: bytes, width: int, target_width: int) -> bytes:
    source_width = max(1, int(width or 1))
    safe_target_width = max(1, int(target_width or 1))
    if source_width == safe_target_width:
        return bytes(frames or b"")
    samples = _decode_pcm(frames, source_width)
    if samples.size == 0:
        return b""
    source_peak = max(1, _max_int_for_width(source_width))
    target_peak = max(1, _max_int_for_width(safe_target_width))
    scaled = np.rint(samples.astype(np.float64) * (float(target_peak) / float(source_peak)))
    return _encode_pcm(scaled.astype(np.int64), safe_target_width)


def tomono(frames: bytes, width: int, lfactor: float, rfactor: float) -> bytes:
    samples = _reshape_frames(frames, width, 2)
    if samples.size == 0:
        return b""
    mixed = np.rint(samples[:, 0].astype(np.float64) * float(lfactor) + samples[:, 1].astype(np.float64) * float(rfactor))
    return _encode_pcm(mixed.astype(np.int64), width)


def tostereo(frames: bytes, width: int, lfactor: float, rfactor: float) -> bytes:
    mono = _reshape_frames(frames, width, 1).reshape(-1)
    if mono.size == 0:
        return b""
    left = np.rint(mono.astype(np.float64) * float(lfactor))
    right = np.rint(mono.astype(np.float64) * float(rfactor))
    stereo = np.column_stack([left, right]).astype(np.int64)
    return _pack_frames(stereo, width)


def ratecv(
    frames: bytes,
    width: int,
    channels: int,
    inrate: int,
    outrate: int,
    state: Any = None,
) -> tuple[bytes, Any]:
    _ = state
    safe_inrate = max(1, int(inrate or 1))
    safe_outrate = max(1, int(outrate or 1))
    safe_channels = max(1, int(channels or 1))
    if safe_inrate == safe_outrate:
        return bytes(frames or b""), None

    samples = _reshape_frames(frames, width, safe_channels)
    if samples.size == 0:
        return b"", None

    frame_count = int(samples.shape[0])
    target_frames = max(1, int(round(frame_count * float(safe_outrate) / float(safe_inrate))))
    if target_frames == frame_count:
        return _pack_frames(samples, width), None

    source_x = np.arange(frame_count, dtype=np.float64)
    target_x = np.linspace(0.0, max(frame_count - 1, 0), target_frames, dtype=np.float64)
    resampled = np.empty((target_frames, safe_channels), dtype=np.float64)
    for idx in range(safe_channels):
        resampled[:, idx] = np.interp(target_x, source_x, samples[:, idx].astype(np.float64))
    return _pack_frames(np.rint(resampled).astype(np.int64), width), None


def rms(frames: bytes, width: int) -> int:
    samples = _decode_pcm(frames, width)
    if samples.size == 0:
        return 0
    return int(round(math.sqrt(float(np.mean(np.square(samples.astype(np.float64)))))))


def mul(frames: bytes, width: int, factor: float) -> bytes:
    samples = _decode_pcm(frames, width)
    if samples.size == 0:
        return b""
    scaled = np.rint(samples.astype(np.float64) * float(factor))
    return _encode_pcm(scaled.astype(np.int64), width)
