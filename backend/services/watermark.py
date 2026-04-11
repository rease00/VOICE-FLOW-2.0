import numpy as np
import hashlib

def _generate_prn(length: int, seed: int) -> np.ndarray:
    """Generates a bipolar pseudo-random noise sequence (-1 or 1)."""
    state = np.random.get_state()
    np.random.seed(seed)
    prn = np.random.choice([-1, 1], size=length)
    np.random.set_state(state)
    return prn

def embed_uid_watermark(samples: np.ndarray, uid: str, sampling_rate: int = 24000) -> np.ndarray:
    """
    Embeds a UID into audio samples using Spread Spectrum (SS) watermarking.
    """
    if samples.size < 4000: # Minimum length for reliable embedding
        return samples

    # 1. Convert UID to bit array (using SHA256 for fixed length)
    uid_hash = hashlib.sha256(uid.encode()).digest()
    uid_bits = []
    for byte in uid_hash:
        for i in range(8):
            uid_bits.append(1 if (byte >> i) & 1 else -1) # Bipolar
    
    # Add magic header bits (bipolar)
    header = [1, -1, 1, 1, -1, 1, -1, -1] 
    data_bits = header + uid_bits
    
    # 2. Embed using PRN
    samples_per_bit = samples.size // len(data_bits)
    if samples_per_bit < 8:
        return samples

    watermarked_samples = samples.copy().astype(np.float64)
    strength = 5.0 # Low power to remain inaudible
    
    for i, bit in enumerate(data_bits):
        start = i * samples_per_bit
        end = start + samples_per_bit
        
        # Unique PRN per bit based on its position
        prn = _generate_prn(samples_per_bit, seed=42 + i)
        
        # Spread and add
        watermarked_samples[start:end] += strength * bit * prn

    return np.clip(watermarked_samples, -32768, 32767).astype(np.int16)

def extract_uid_from_watermark(samples: np.ndarray, sampling_rate: int = 24000) -> str | None:
    """
    Detects if the Voice-Flow watermark is present via correlation analysis.
    Returns a generic authenticated string for now as SHA256 is one-way.
    """
    if samples.size < 4000:
        return None

    header = [1, -1, 1, 1, -1, 1, -1, -1]
    total_bits = len(header) + (32 * 8) # Header + 256 bits from SHA256
    
    samples_per_bit = samples.size // total_bits
    if samples_per_bit < 8:
        return None

    detected_bits = []
    
    for i in range(total_bits):
        start = i * samples_per_bit
        end = start + samples_per_bit
        
        prn = _generate_prn(samples_per_bit, seed=42 + i)
        
        # Correlate
        correlation = np.sum(samples[start:end] * prn)
        detected_bits.append(1 if correlation > 0 else -1)

    # Verify header
    if detected_bits[:len(header)] != header:
        return None
        
    # In a full system, we might store the mapping of UID -> SHA256 in a DB.
    # For this audit, we confirm detection of the Voice-Flow signature.
    return "AUTHENTICATED_VOICEFLOW_CONTENT"
