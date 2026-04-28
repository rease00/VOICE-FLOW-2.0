import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AnyRecord = Record<string, unknown>;

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));
const { getCloudflareContextMock, getFirebaseAdminFirestoreMock, getFirebaseAdminAuthMock, verifyFirebaseRequestMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
  getFirebaseAdminFirestoreMock: vi.fn(),
  getFirebaseAdminAuthMock: vi.fn(),
  verifyFirebaseRequestMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock('../src/server/auth/requestAuth.ts', () => ({
  verifyFirebaseRequest: verifyFirebaseRequestMock,
}));

vi.mock('../src/server/firebaseAdmin.ts', () => ({
  getFirebaseAdminAuth: getFirebaseAdminAuthMock,
  getFirebaseAdminFirestore: getFirebaseAdminFirestoreMock,
}));

const createStorageMock = () => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn((key: string) => store.get(String(key)) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(String(key), String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(String(key));
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const createFirestoreMock = () => {
  const collections = new Map<string, Map<string, AnyRecord>>();
  const getCollection = (name: string) => {
    if (!collections.has(name)) {
      collections.set(name, new Map<string, AnyRecord>());
    }
    return collections.get(name)!;
  };
  const makeDoc = (collectionName: string, id: string) => ({
    async get() {
      const row = getCollection(collectionName).get(id) || null;
      return {
        exists: Boolean(row),
        data: () => (row ? structuredClone(row) : undefined),
        ref: makeDoc(collectionName, id),
      };
    },
    async set(value: AnyRecord, options?: { merge?: boolean }) {
      const collection = getCollection(collectionName);
      const previous = collection.get(id) || {};
      collection.set(id, options?.merge ? { ...previous, ...structuredClone(value) } : structuredClone(value));
    },
    async delete() {
      getCollection(collectionName).delete(id);
    },
  });
  const firestore = {
    collection(name: string) {
      const collectionApi = {
        doc(id: string) {
          return makeDoc(name, id);
        },
        async get() {
          const docs = [...getCollection(name).entries()].map(([id, data]) => ({
            id,
            exists: true,
            data: () => structuredClone(data),
            ref: makeDoc(name, id),
          }));
          return { docs, empty: docs.length === 0 };
        },
        where(field: string, operator: string, value: unknown) {
          return {
            limit(limitCount: number) {
              return {
                async get() {
                  const docs = [...getCollection(name).entries()]
                    .filter(([, row]) => operator === '==' && row[field] === value)
                    .slice(0, Math.max(0, limitCount))
                    .map(([id, data]) => ({
                      id,
                      exists: true,
                      data: () => structuredClone(data),
                      ref: makeDoc(name, id),
                    }));
                  return { docs, empty: docs.length === 0 };
                },
              };
            },
          };
        },
      };
      return collectionApi;
    },
  };
  return { collections, firestore };
};

const createD1Mock = () => {
  const tables = {
    accountProfiles: new Map<string, AnyRecord>(),
    accountUserIdIndex: new Map<string, AnyRecord>(),
    accountEntitlements: new Map<string, AnyRecord>(),
  };
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
      const statement: AnyRecord = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first() {
          if (normalized.includes('from account_profiles')) {
            const row = tables.accountProfiles.get(String(bound[0] || ''));
            return row ? { payload_json: row.payload_json } : null;
          }
          if (normalized.includes('from account_user_id_index')) {
            const row = tables.accountUserIdIndex.get(String(bound[0] || ''));
            return row ? { uid: row.uid } : null;
          }
          if (normalized.includes('from account_entitlements')) {
            const row = tables.accountEntitlements.get(String(bound[0] || ''));
            return row ? { payload_json: row.payload_json } : null;
          }
          return null;
        },
        async run() {
          if (normalized.startsWith('insert into account_profiles')) {
            const [uid, payloadJson, updatedAt] = bound;
            tables.accountProfiles.set(String(uid), {
              uid: String(uid),
              payload_json: String(payloadJson),
              updated_at: String(updatedAt),
            });
          } else if (normalized.startsWith('insert into account_user_id_index')) {
            const [userId, uid, updatedAt] = bound;
            tables.accountUserIdIndex.set(String(userId), {
              user_id: String(userId),
              uid: String(uid),
              updated_at: String(updatedAt),
            });
          } else if (normalized.startsWith('delete from account_user_id_index')) {
            tables.accountUserIdIndex.delete(String(bound[0] || ''));
          } else if (normalized.startsWith('insert into account_entitlements')) {
            const [uid, payloadJson, updatedAt] = bound;
            tables.accountEntitlements.set(String(uid), {
              uid: String(uid),
              payload_json: String(payloadJson),
              updated_at: String(updatedAt),
            });
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
  return { db, tables };
};

describe('adminService unlock token storage', () => {
  const legacyAdminUnlockKey = 'vf_admin_unlock_token';
  const originalWindow = globalThis.window;
  const originalSessionStorage = globalThis.sessionStorage;
  const storage = createStorageMock();

  beforeEach(async () => {
    storage.clear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage: storage },
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: storage,
    });
    authFetchMock.mockReset();
    const { clearAdminUnlockToken } = await import('../services/adminService');
    clearAdminUnlockToken();
  });

  afterEach(() => {
    authFetchMock.mockReset();
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: originalSessionStorage,
    });
  });

  it('keeps unlock tokens in memory only and clears legacy storage', async () => {
    const {
      clearAdminUnlockToken,
      createAdminBroadcastNotice,
      getAdminUnlockToken,
      verifyAdminSessionUnlock,
    } = await import('../services/adminService');

    storage.store.set(legacyAdminUnlockKey, 'legacy-token');
    authFetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          uid: 'admin_1',
          unlockToken: 'unlock-token',
          status: {
            isUnlocked: true,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          notice: {
            id: 'notice_1',
            message: 'hello',
          },
        })
      );

    const verifyPayload = await verifyAdminSessionUnlock('unlock-key', 'http://127.0.0.1:7800');
    expect(verifyPayload.unlockToken).toBe('unlock-token');
    expect(getAdminUnlockToken()).toBe('unlock-token');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(legacyAdminUnlockKey);

    await createAdminBroadcastNotice(
      {
        message: 'hello',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
      'http://127.0.0.1:7800'
    );

    expect(authFetchMock).toHaveBeenCalledTimes(2);
    const mutationCall = authFetchMock.mock.calls[1] as [string, RequestInit, { requireAuth: boolean }];
    expect(new Headers(mutationCall[1]?.headers || {}).get('X-Admin-Unlock')).toBe('Bearer unlock-token');

    clearAdminUnlockToken();
    expect(getAdminUnlockToken()).toBe('');
  });
});

describe('adminService D1-backed account mutations', () => {
  const d1 = createD1Mock();
  const { collections, firestore } = createFirestoreMock();
  const unlockToken = 'unlock-token';

  beforeEach(() => {
    d1.tables.accountProfiles.clear();
    d1.tables.accountUserIdIndex.clear();
    d1.tables.accountEntitlements.clear();
    collections.clear();
    getCloudflareContextMock.mockResolvedValue({ env: { DB: d1.db } });
    getFirebaseAdminFirestoreMock.mockReturnValue(firestore);
    getFirebaseAdminAuthMock.mockReturnValue({
      updateUser: vi.fn(async () => undefined),
      revokeRefreshTokens: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined),
    });
    verifyFirebaseRequestMock.mockResolvedValue({ uid: 'admin-1', admin: true } as never);

    collections.set('admin_session_unlock', new Map([
      ['admin-1', {
        recordId: 'unlock_admin-1',
        uid: 'admin-1',
        unlockToken,
        unlockExpiresAtMs: Date.now() + 60_000,
        keyExpiresAtMs: Date.now() + 60_000,
        failedAttempts: 0,
        lockedUntilMs: 0,
      }],
    ]));
    collections.set('users', new Map([
      ['uid-1', {
        uid: 'uid-1',
        userId: 'reader_one',
        email: 'reader@example.com',
        displayName: 'Reader One',
        role: 'user',
        isAdmin: false,
      }],
    ]));
    collections.set('user_profiles', new Map());
    collections.set('entitlements', new Map());

    d1.tables.accountProfiles.set('uid-1', {
      uid: 'uid-1',
      payload_json: JSON.stringify({
        uid: 'uid-1',
        userId: 'reader_one',
        displayName: 'Reader One',
        email: 'reader@example.com',
        status: 'active',
        createdAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
      }),
      updated_at: '2026-04-28T00:00:00.000Z',
    });
    d1.tables.accountUserIdIndex.set('reader_one', {
      user_id: 'reader_one',
      uid: 'uid-1',
      updated_at: '2026-04-28T00:00:00.000Z',
    });
    d1.tables.accountEntitlements.set('uid-1', {
      uid: 'uid-1',
      payload_json: JSON.stringify({
        uid: 'uid-1',
        plan: 'Free',
        status: 'free_active',
        monthlyVfLimit: 10000,
        paidVfBalance: 0,
        vffBalance: 0,
        vcFreeBalance: 0,
        vcGrantedBalance: 0,
        vcPaidBalance: 0,
        vcSpendableBalance: 0,
        earlyAccess: false,
        updatedAt: '2026-04-28T00:00:00.000Z',
      }),
      updated_at: '2026-04-28T00:00:00.000Z',
    });
  });

  it('reads D1-backed profiles and writes admin user updates back through the D1 account helpers', async () => {
    const { handleAdminRoute } = await import('../src/server/admin/service');

    const forceResponse = await handleAdminRoute(
      new Request('http://localhost/api/admin/users/uid-1/force-user-id', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-unlock': `Bearer ${unlockToken}`,
        },
        body: JSON.stringify({ userId: 'reader_two' }),
      }) as never,
      ['users', 'uid-1', 'force-user-id']
    );

    expect(forceResponse.status).toBe(200);
    const forcedBody = await forceResponse.json() as { profile?: AnyRecord };
    expect(forcedBody.profile).toMatchObject({
      uid: 'uid-1',
      userId: 'reader_two',
      displayName: 'Reader One',
      email: 'reader@example.com',
    });
    expect(JSON.parse(String(d1.tables.accountProfiles.get('uid-1')?.payload_json || '{}'))).toMatchObject({
      uid: 'uid-1',
      userId: 'reader_two',
    });
    expect(d1.tables.accountUserIdIndex.has('reader_one')).toBe(false);
    expect(d1.tables.accountUserIdIndex.get('reader_two')).toMatchObject({
      user_id: 'reader_two',
      uid: 'uid-1',
    });
    expect(collections.get('user_profiles')?.get('uid-1')).toMatchObject({
      uid: 'uid-1',
      userId: 'reader_two',
    });

    const patchResponse = await handleAdminRoute(
      new Request('http://localhost/api/admin/users/uid-1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-admin-unlock': `Bearer ${unlockToken}`,
        },
        body: JSON.stringify({ plan: 'Pro', paidVfDelta: 250, vffDelta: 50 }),
      }) as never,
      ['users', 'uid-1']
    );

    expect(patchResponse.status).toBe(200);
    const patchBody = await patchResponse.json() as { entitlements?: AnyRecord };
    expect(patchBody.entitlements).toMatchObject({
      uid: 'uid-1',
      plan: 'Pro',
    });
    expect(JSON.parse(String(d1.tables.accountEntitlements.get('uid-1')?.payload_json || '{}'))).toMatchObject({
      uid: 'uid-1',
      plan: 'Pro',
      paidVfBalance: 250,
      vffBalance: 50,
    });
    expect(collections.get('entitlements')?.get('uid-1')).toMatchObject({
      uid: 'uid-1',
      plan: 'Pro',
      paidVfBalance: 250,
      vffBalance: 50,
    });
  });
});
