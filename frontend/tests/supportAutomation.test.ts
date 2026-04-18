import { describe, expect, it } from 'vitest';

import { analyzeSupportRequest } from '../src/server/support/automation';

describe('support automation policy', () => {
  it('routes billing issues into the critical human queue with a billing draft reply', () => {
    const result = analyzeSupportRequest({
      text: 'I was charged twice for my subscription and need a refund now.',
      userName: 'rahul',
    });

    expect(result).toMatchObject({
      category: 'billing',
      urgency: 'critical',
      needsHuman: true,
      queue: 'critical',
      priority: 'red',
      mode: 'rules_first',
      model: 'gemini-2.5-flash-lite',
    });
    expect(result.draftReply).toContain('billing review');
    expect(result.reason).toBe('rules_first:billing_triage');
  });

  it('keeps generation issues on the cheap rules-first path with retry guidance', () => {
    const result = analyzeSupportRequest({
      text: 'Studio TTS generation failed and the audio export is stuck.',
      userName: 'creator01',
    });

    expect(result).toMatchObject({
      category: 'generation',
      urgency: 'high',
      queue: 'blocked',
      priority: 'orange',
      mode: 'rules_first',
    });
    expect(result.draftReply).toContain('runtime or generation issue');
    expect(result.reason).toBe('rules_first:generation_retry');
  });
});
