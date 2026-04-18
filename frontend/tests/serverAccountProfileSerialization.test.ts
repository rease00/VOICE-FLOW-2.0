import { describe, expect, it } from 'vitest';

import { buildGenerationHistoryItemId, serializeAccountProfileForFirestore } from '../src/server/account/service';

describe('serializeAccountProfileForFirestore', () => {
  it('removes undefined optional fields before Firestore writes', () => {
    const payload = serializeAccountProfileForFirestore({
      uid: 'uid-1',
      userId: '',
      displayName: undefined,
      email: undefined,
      billingProfile: null,
      status: 'admin',
      createdAt: '',
      updatedAt: '',
    });

    expect(payload).toMatchObject({
      uid: 'uid-1',
      userId: '',
      displayName: '',
      email: '',
      billingProfile: null,
      status: 'admin',
    });
    expect(payload.createdAt).toEqual(expect.any(String));
    expect(payload.updatedAt).toEqual(expect.any(String));
    expect(Object.values(payload)).not.toContain(undefined);
  });

  it('builds a stable generation history id from retry-safe request metadata', () => {
    const source = {
      requestId: 'req-123',
      traceId: 'trace-123',
      engine: 'VECTOR',
      title: 'Launch demo',
      audioUrl: 'https://cdn.example/audio/123.wav',
    };

    expect(buildGenerationHistoryItemId(source, 1710000000000)).toBe(
      buildGenerationHistoryItemId({ ...source, timestamp: 1710000000500 }, 1710000000500),
    );
    expect(buildGenerationHistoryItemId(source, 1710000000000)).toMatch(/^history-/);
  });
});
