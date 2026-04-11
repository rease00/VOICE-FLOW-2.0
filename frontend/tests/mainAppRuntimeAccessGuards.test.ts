import { describe, expect, it } from 'vitest';

import {
  buildVoiceSampleSingleFlightKey,
  isFalseFrontendOnlyRuntimeRestriction,
} from '../src/app/workspace/MainApp';

describe('MainApp runtime access guards', () => {
  it('suppresses frontend-only restricted copy without explicit permission signals', () => {
    expect(
      isFalseFrontendOnlyRuntimeRestriction({
        rawMessage: '403 Forbidden',
        publicMessage: 'This action is restricted for your account permissions.',
      })
    ).toBe(true);

    expect(
      isFalseFrontendOnlyRuntimeRestriction({
        rawMessage: 'Backend path is not allowed by proxy policy.',
        publicMessage: 'This action is restricted for your current account permissions.',
      })
    ).toBe(true);
  });

  it('preserves explicit runtime permission failures', () => {
    expect(
      isFalseFrontendOnlyRuntimeRestriction({
        rawMessage: 'Missing permission: ops.mutate',
        publicMessage: 'This action is restricted for your account permissions.',
      })
    ).toBe(false);

    expect(
      isFalseFrontendOnlyRuntimeRestriction({
        rawMessage: 'x-admin-unlock bearer token is required',
        publicMessage: 'This action requires an active admin session unlock.',
      })
    ).toBe(false);
  });

  it('builds a single-flight voice preview key by engine + voice id', () => {
    const primeKey = buildVoiceSampleSingleFlightKey('voice-123', 'PRIME');
    const vectorKey = buildVoiceSampleSingleFlightKey('voice-123', 'VECTOR');
    const trimmedKey = buildVoiceSampleSingleFlightKey('  voice-123  ', 'PRIME');

    expect(primeKey).toBe('PRIME:voice-123');
    expect(vectorKey).toBe('VECTOR:voice-123');
    expect(trimmedKey).toBe(primeKey);
  });
});
