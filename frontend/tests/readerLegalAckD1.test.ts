import { beforeEach, describe, expect, it, vi } from 'vitest';

type AnyRecord = Record<string, unknown>;

const readerLegalAckRows = new Map<string, AnyRecord>();

const getCloudflareContextMock = vi.hoisted(() => vi.fn());
const getFirebaseAdminFirestoreMock = vi.hoisted(() => vi.fn());

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock('../src/server/firebaseAdmin.ts', () => ({
  getFirebaseAdminFirestore: getFirebaseAdminFirestoreMock,
}));

const fakeDb = {
  prepare(sql: string) {
    let bound: unknown[] = [];
    const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
    const statement: AnyRecord = {
      bind(...values: unknown[]) {
        bound = values;
        return statement;
      },
      async first() {
        if (normalized.includes('from reader_legal_ack')) {
          const row = readerLegalAckRows.get(String(bound[0] || ''));
          return row ? { payload_json: row.payload_json } : null;
        }
        return null;
      },
      async run() {
        if (normalized.startsWith('insert into reader_legal_ack')) {
          const [uid, payloadJson, updatedAt] = bound;
          readerLegalAckRows.set(String(uid), {
            uid: String(uid),
            payload_json: String(payloadJson),
            updated_at: String(updatedAt),
          });
        } else if (normalized.startsWith('delete from reader_legal_ack')) {
          readerLegalAckRows.delete(String(bound[0] || ''));
        }
        return {};
      },
    };
    return statement;
  },
  async exec() {
    return {};
  },
};

const firestore = {
  collection: () => ({
    doc: () => ({
      async get() {
        return { exists: false, data: () => undefined };
      },
      async set() {
        return undefined;
      },
    }),
  }),
};

describe('reader legal ack D1 storage', () => {
  beforeEach(() => {
    readerLegalAckRows.clear();
    getCloudflareContextMock.mockResolvedValue({ env: { DB: fakeDb } });
    getFirebaseAdminFirestoreMock.mockReturnValue(firestore);
  });

  it('persists and reads the reader legal ack from D1', async () => {
    const { getReaderLegalAck, setReaderLegalAck, buildReaderLegalAckEnvelope } = await import('../src/server/account/readerLegalAck');

    await expect(setReaderLegalAck('uid-1', true)).resolves.toMatchObject({
      uid: 'uid-1',
      accepted: true,
    });
    await expect(getReaderLegalAck('uid-1')).resolves.toMatchObject({
      uid: 'uid-1',
      accepted: true,
    });
    expect(readerLegalAckRows.get('uid-1')).toMatchObject({
      uid: 'uid-1',
    });
    expect(buildReaderLegalAckEnvelope(await getReaderLegalAck('uid-1'))).toMatchObject({
      ok: true,
      ack: {
        accepted: true,
      },
      billing: {
        vfPerChar: 0.5,
      },
    });
  });
});
