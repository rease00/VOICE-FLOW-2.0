import { describe, expect, it } from 'vitest';

describe('voice clone stem separation request builder', () => {
  it('defaults the compressed upload cap above a common 10 minute mp3 size', async () => {
    const previousNext = process.env.NEXT_PUBLIC_VOICE_CLONE_MAX_AUDIO_BYTES;
    const previousVite = process.env.VITE_VOICE_CLONE_MAX_AUDIO_BYTES;
    process.env.NEXT_PUBLIC_VOICE_CLONE_MAX_AUDIO_BYTES = '';
    process.env.VITE_VOICE_CLONE_MAX_AUDIO_BYTES = '';

    try {
      const { getVoiceCloneStemExtractionMaxBytes, getOpenVoiceStemExtractionMaxBytes } = await import('../src/features/voice-cloning/stemSeparation');
      expect(getVoiceCloneStemExtractionMaxBytes()).toBe(12 * 1024 * 1024);
      expect(getOpenVoiceStemExtractionMaxBytes()).toBe(12 * 1024 * 1024);
    } finally {
      if (typeof previousNext === 'undefined') {
        delete process.env.NEXT_PUBLIC_VOICE_CLONE_MAX_AUDIO_BYTES;
      } else {
        process.env.NEXT_PUBLIC_VOICE_CLONE_MAX_AUDIO_BYTES = previousNext;
      }
      if (typeof previousVite === 'undefined') {
        delete process.env.VITE_VOICE_CLONE_MAX_AUDIO_BYTES;
      } else {
        process.env.VITE_VOICE_CLONE_MAX_AUDIO_BYTES = previousVite;
      }
    }
  });

  it('sends the original compressed source and preserves trim metadata', async () => {
    const { buildVoiceCloneStemSeparationRequest, buildOpenVoiceStemSeparationRequest, isFullDurationTrimRange } = await import(
      '../src/features/voice-cloning/stemSeparation'
    );

    const sourceBytes = new Uint8Array([0x49, 0x44, 0x33, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const sourceAudio = new File([sourceBytes], 'mix.mp3', { type: 'audio/mpeg' });

    const request = await buildVoiceCloneStemSeparationRequest({
      sourceAudio,
      requestId: 'req_trim_123',
      sourceSeparationModel: 'htdemucs_ft',
      sourceSeparationDevice: 'cpu_only',
      trimRange: { startSec: 12.5, endSec: 42.25 },
    });

    expect(request.sourceAudioName).toBe('mix.mp3');
    expect(request.sourceAudioBase64).toBe('SUQzAQIDBAU=');
    expect(request.sourceTrimStartSec).toBe(12.5);
    expect(request.sourceTrimEndSec).toBe(42.25);
    expect(request.sourceSeparationModel).toBe('htdemucs_ft');
    expect(request.sourceSeparationDevice).toBe('cpu_only');
    expect(request.requestId).toBe('req_trim_123');
    expect(request.traceId).toBe('req_trim_123');
    const legacyRequest = await buildOpenVoiceStemSeparationRequest({
      sourceAudio,
      requestId: 'req_trim_123',
      sourceSeparationModel: 'htdemucs_ft',
      sourceSeparationDevice: 'cpu_only',
      trimRange: { startSec: 12.5, endSec: 42.25 },
    });
    expect(legacyRequest).toMatchObject(request);
  });

  it('treats the full source range as no trim', async () => {
    const { isFullDurationTrimRange } = await import('../src/features/voice-cloning/stemSeparation');

    expect(isFullDurationTrimRange(0, 600, 600)).toBe(true);
    expect(isFullDurationTrimRange(0.25, 600, 600)).toBe(false);
  });
});
