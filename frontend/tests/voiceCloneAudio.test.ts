import { describe, expect, it, vi, beforeEach } from 'vitest';

const { authFetchMock } = vi.hoisted(() => {
  const authFetch = vi.fn();
  return { authFetchMock: authFetch };
});

vi.mock('../services/authHttpClient', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

describe('voice clone audio helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetchUrlToBase64 uses authenticated fetch for protected URLs', async () => {
    const { fetchUrlToBase64 } = await import('../src/shared/audio/base64');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    authFetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as Response);

    const encoded = await fetchUrlToBase64('https://backend.example/voice-lab/openvoice/artifacts/abc.wav?sig=123');

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock.mock.calls[0]?.[0]).toContain('/voice-lab/openvoice/artifacts/abc.wav');
    expect(encoded).toBe('AQIDBA==');
  });

  it('builds inline result audio urls and ignores backend artifact urls for playback', async () => {
    const { resolveVoiceClonePlayableAudioUrl } = await import('../src/features/voice-cloning/audio');

    const url = resolveVoiceClonePlayableAudioUrl({
      audioBase64: 'AQIDBA==',
      artifact: { downloadUrl: 'https://backend.example/protected/artifact.wav?sig=123' },
      clonedVoice: { previewUrl: 'https://backend.example/protected/preview.wav?sig=456' },
    }, 'audio/wav');

    expect(url).toBe('data:audio/wav;base64,AQIDBA==');
  });

  it('falls back to authenticated fetch when inline audio is missing', async () => {
    const { resolveVoiceClonePlayableAudioUrlWithFallback } = await import('../src/features/voice-cloning/audio');
    const bytes = new Uint8Array([5, 6, 7, 8]);
    authFetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as Response);

    const url = await resolveVoiceClonePlayableAudioUrlWithFallback({
      artifact: { downloadUrl: 'https://backend.example/voice-lab/openvoice/artifacts/abc.wav?sig=123' },
    }, 'audio/wav');

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(url).toBe('data:audio/wav;base64,BQYHCA==');
  });
});
