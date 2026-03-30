import { describe, expect, it } from 'vitest';

import {
  canViewVoiceCloneStressControls,
  deriveStressRpmFromConcurrency,
  getStressRuntimeDeviceLabel,
  getStressValidationMessage,
  mapVoiceCloneStressError,
  shouldPollVoiceCloneStressStatus,
} from '../src/features/voice-cloning/VoiceCloningTabContent';

describe('voice cloning stress helpers', () => {
  const baseConfig = {
    startRpm: 20,
    stepRpm: 10,
    maxRpm: 40,
    stepDurationSec: 15,
    concurrency: 2,
    maxFailureRate: 0.05,
    maxP95Ms: 20000,
    warmupRequests: 2,
    requestTimeoutSec: 60,
  };

  it('validates OpenVoice file requirements and Gemini text requirements', () => {
    const fakeFile = {} as File;

    expect(
      getStressValidationMessage('OPENVOICE_L4_VC', baseConfig, null, fakeFile, 'text', 'Fenrir')
    ).toContain('Reference audio is required');
    expect(
      getStressValidationMessage('OPENVOICE_L4_VC', baseConfig, fakeFile, null, 'text', 'Fenrir')
    ).toContain('Target audio is required');
    expect(
      getStressValidationMessage('GEMINI_FLASH_TTS', baseConfig, null, null, '', 'Fenrir')
    ).toContain('benchmark text is required');
    expect(
      getStressValidationMessage('GEMINI_FLASH_TTS', baseConfig, null, null, 'hello', '')
    ).toContain('voice name is required');
    expect(
      getStressValidationMessage('GEMINI_FLASH_TTS', baseConfig, null, null, 'hello', 'Fenrir')
    ).toBe('');
  });

  it('applies runtime device fallback logic', () => {
    expect(
      getStressRuntimeDeviceLabel(
        {
          ok: true,
          jobId: 'v1',
          benchmarkTarget: 'OPENVOICE_L4_VC',
          status: 'running',
          createdAtMs: 0,
          updatedAtMs: 0,
          runtimeDeviceSamples: ['cuda:0'],
        },
        'OPENVOICE_L4_VC'
      )
    ).toBe('cuda:0');

    expect(
      getStressRuntimeDeviceLabel(
        {
          ok: true,
          jobId: 'v2',
          benchmarkTarget: 'GEMINI_FLASH_TTS',
          status: 'running',
          createdAtMs: 0,
          updatedAtMs: 0,
          runtimePreflight: { device: 'gemini-runtime' },
        },
        'GEMINI_FLASH_TTS'
      )
    ).toBe('gemini-runtime');

    expect(getStressRuntimeDeviceLabel(null, 'OPENVOICE_L4_VC')).toBe('Modal VC (configured target)');
  });

  it('auto-derives stress RPM values from concurrency', () => {
    expect(deriveStressRpmFromConcurrency(2)).toEqual({ startRpm: 20, stepRpm: 10, maxRpm: 40 });
    expect(deriveStressRpmFromConcurrency(1)).toEqual({ startRpm: 10, stepRpm: 5, maxRpm: 20 });
    expect(deriveStressRpmFromConcurrency(999)).toEqual({ startRpm: 1280, stepRpm: 640, maxRpm: 2560 });
  });

  it('decides poll lifecycle based on modal state and terminal status', () => {
    expect(shouldPollVoiceCloneStressStatus(false, { jobId: 'v1', status: 'running' } as any)).toBe(false);
    expect(shouldPollVoiceCloneStressStatus(true, { jobId: '', status: 'running' } as any)).toBe(false);
    expect(shouldPollVoiceCloneStressStatus(true, { jobId: 'v1', status: 'queued' } as any)).toBe(true);
    expect(shouldPollVoiceCloneStressStatus(true, { jobId: 'v1', status: 'running' } as any)).toBe(true);
    expect(shouldPollVoiceCloneStressStatus(true, { jobId: 'v1', status: 'completed' } as any)).toBe(false);
  });

  it('maps stress API errors for 401/403/404/429/5xx', () => {
    expect(mapVoiceCloneStressError({ status: 401, detail: '' })).toContain('Authentication is required');
    expect(mapVoiceCloneStressError({ status: 403, detail: '' })).toContain('do not have permission');
    expect(mapVoiceCloneStressError({ status: 429, detail: '' })).toContain('rate-limited');
    expect(mapVoiceCloneStressError({ status: 404, detail: 'Not Found' })).toContain('unavailable on the connected backend');
    expect(mapVoiceCloneStressError({ status: 500, detail: '' })).toContain('temporarily unavailable');
    expect(mapVoiceCloneStressError({ status: 503, detail: 'upstream down' })).toBe('upstream down');
  });

  it('allows stress controls only for admin users', () => {
    expect(canViewVoiceCloneStressControls({ isAdmin: true })).toBe(true);
    expect(canViewVoiceCloneStressControls({ isAdmin: false })).toBe(false);
    expect(canViewVoiceCloneStressControls(null)).toBe(false);
  });

});
