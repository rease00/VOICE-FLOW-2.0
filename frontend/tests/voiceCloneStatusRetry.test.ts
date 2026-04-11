import { describe, expect, it } from 'vitest';
import {
  formatVoiceCloneStatusRetryDelayLabel,
  resolveVoiceCloneStatusRetryDelayMs,
  VOICE_CLONE_STATUS_RETRY_INTERVAL_MS,
  VOICE_CLONE_STATUS_UNHEALTHY_RETRY_INTERVAL_MS,
} from '../src/features/voice-cloning/voiceCloneStatusRetry';

describe('voice clone status retry policy', () => {
  it('keeps fast polling when the runtime reports not ready', () => {
    expect(resolveVoiceCloneStatusRetryDelayMs({ ready: false } as any)).toBe(VOICE_CLONE_STATUS_RETRY_INTERVAL_MS);
    expect(formatVoiceCloneStatusRetryDelayLabel(VOICE_CLONE_STATUS_RETRY_INTERVAL_MS)).toBe('15s');
  });

  it('backs off after a status request failure', () => {
    expect(resolveVoiceCloneStatusRetryDelayMs(null, new Error('Service unavailable'))).toBe(
      VOICE_CLONE_STATUS_UNHEALTHY_RETRY_INTERVAL_MS
    );
    expect(formatVoiceCloneStatusRetryDelayLabel(VOICE_CLONE_STATUS_UNHEALTHY_RETRY_INTERVAL_MS)).toBe('5m');
  });

  it('stops polling once the runtime is ready', () => {
    expect(resolveVoiceCloneStatusRetryDelayMs({ ready: true } as any)).toBe(0);
    expect(formatVoiceCloneStatusRetryDelayLabel(0)).toBe('now');
  });
});
