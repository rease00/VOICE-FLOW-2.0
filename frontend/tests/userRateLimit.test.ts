import { describe, expect, it } from 'vitest';

import {
  consumeUniversalTtsRateLimit,
  resetUniversalTtsRateLimitState,
  universalTtsRateLimit,
} from '../src/server/tts/userRateLimit';

describe('universal TTS rate limit', () => {
  it('applies per user rather than globally', () => {
    resetUniversalTtsRateLimitState();

    for (let index = 0; index < universalTtsRateLimit.limit; index += 1) {
      expect(consumeUniversalTtsRateLimit('user-a').allowed).toBe(true);
    }

    const blocked = consumeUniversalTtsRateLimit('user-a');
    const freshUser = consumeUniversalTtsRateLimit('user-b');

    expect(blocked.allowed).toBe(false);
    expect(freshUser.allowed).toBe(true);
  });
});
