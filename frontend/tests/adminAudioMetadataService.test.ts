import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthFetch } = vi.hoisted(() => ({
  mockAuthFetch: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: mockAuthFetch,
}));

vi.mock('../src/shared/api/httpClient', () => ({
  parseResponseError: async (response: Response) => new Error(`HTTP ${response.status}`),
  readJsonOrThrow: async <T>(response: Response) => response.json() as Promise<T>,
}));

vi.mock('../src/shared/api/config', () => ({
  resolveApiBaseUrl: (input?: string) => input || 'http://backend.test',
}));

import { exportAdminAudioMetadataCsv, fetchAdminAudioMetadata, fetchAdminAudioMetadataById } from '../services/adminService';

describe('admin audio metadata service', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it('serializes audio metadata filters for list requests', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, items: [], count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchAdminAudioMetadata('http://backend.test', {
      uid: 'uid_1',
      userId: 'user_1',
      identityValue: 'user@example.com',
      paymentRef: 'pi_123',
      status: 'completed',
      engine: 'PRIME',
      outputSha256: 'abcd1234',
      watermarkId: 'wmark_42',
      c2paStatus: 'applied',
      from: '2026-03-01',
      to: '2026-03-07',
      cursor: 'cursor_1',
      limit: 50,
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      'http://backend.test/admin/audio-metadata/records?uid=uid_1&userId=user_1&identityValue=user%40example.com&paymentRef=pi_123&status=completed&engine=PRIME&outputSha256=abcd1234&watermarkId=wmark_42&c2paStatus=applied&from=2026-03-01&to=2026-03-07&cursor=cursor_1&limit=50',
      undefined,
      expect.objectContaining({ requireAuth: true, timeoutMs: 12_000 })
    );
    const listRequestOptions = mockAuthFetch.mock.calls[0]?.[2] as { timeoutMs?: number } | undefined;
    expect(listRequestOptions?.timeoutMs).toBe(12_000);
  });

  it('serializes export filters and returns the CSV blob', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response('auditId,uid\n1,user_1\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      })
    );

    const blob = await exportAdminAudioMetadataCsv('http://backend.test', {
      uid: 'uid_1',
      status: 'failed',
      engine: 'DUNO',
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      'http://backend.test/admin/audio-metadata/export.csv?uid=uid_1&status=failed&engine=DUNO',
      undefined,
      expect.objectContaining({ requireAuth: true, timeoutMs: 12_000 })
    );
    await expect(blob.text()).resolves.toContain('auditId,uid');
  });

  it('preserves provenance metadata fields in record payloads', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({
        record: {
          auditId: 'audit_1',
          uid: 'uid_1',
          status: 'completed',
          outputSha256: 'sha256-abc',
          audibleLabelApplied: true,
          watermarkMode: 'audible_latent',
          watermarkId: 'watermark-1',
          watermarkVersion: 'v1',
          watermarkDetectable: true,
          c2paStatus: 'applied',
          c2paManifestRef: 'manifest://ref',
          provenanceVersion: '2026.04',
          provenanceError: '',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const record = await fetchAdminAudioMetadataById('audit_1', 'http://backend.test');
    expect(record.outputSha256).toBe('sha256-abc');
    expect(record.audibleLabelApplied).toBe(true);
    expect(record.watermarkId).toBe('watermark-1');
    expect(record.watermarkVersion).toBe('v1');
    expect(record.watermarkDetectable).toBe(true);
    expect(record.c2paStatus).toBe('applied');
    expect(record.c2paManifestRef).toBe('manifest://ref');
    expect(record.provenanceVersion).toBe('2026.04');
  });
});

