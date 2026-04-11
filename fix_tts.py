import os

file_path = r'c:\Users\1wasi\OneDrive\Desktop\voice-Flow\backend\services\tts_v2_engine.py'

with open(file_path, 'rb') as f:
    content = f.read()

# Fix 1: _normalize_wav_for_stitch return value
old_norm_ret = b'''    out = BytesIO()
    with wave.open(out, "wb") as wav_out:
        wav_out.setnchannels(channels)
        wav_out.setsampwidth(width)
        wav_out.setframerate(rate)
        wav_out.writeframes(frames)
    return out.getvalue(), (channels, width, rate), rms'''

new_norm_ret = b'''    return frames, (channels, width, rate), rms'''

# Fix 2: _concat_wav target_rms logic
old_rms_logic = b'''        if target_rms is None:
            target_rms = normalized_rms'''

new_rms_logic = b'''        if target_rms is None and normalized_rms > 0:
            target_rms = normalized_rms'''

# Perform replacements (handling both \n and \r\n)
def smart_replace(data, old, new):
    # Try literal match first
    if old in data:
        return data.replace(old, new)
    # Try with \r\n
    old_rn = old.replace(b'\n', b'\r\n')
    if old_rn in data:
        return data.replace(old_rn, new.replace(b'\n', b'\r\n'))
    return data

content = smart_replace(content, old_norm_ret.strip(), new_norm_ret.strip())
content = smart_replace(content, old_rms_logic.strip(), new_rms_logic.strip())

with open(file_path, 'wb') as f:
    f.write(content)

print("Applied fixes to tts_v2_engine.py")
