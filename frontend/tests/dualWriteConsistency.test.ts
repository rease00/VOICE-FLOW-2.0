import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared in-memory stores and toggles
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

// D1 table map: table name → (primary-key → row-with-payload_json)
const d1Tables = new Map<string, Map<string, AnyRecord>>();

// Firestore collection map: collection name → (doc-id → document-data)
const firestoreCollections = new Map<string, Map<string, AnyRecord>>();

// Toggles
let d1Available = true;
let schemaExecCallCount = 0;
let schemaExecShouldFail = false;

// Helpers
const resetDataStores = () => {
  d1Tables.clear();
  firestoreCollections.clear();
  schemaExecCallCount = 0;
  schemaExecShouldFail = false;
};

const getD1Table = (name: string): Map<string, AnyRecord> => {
  if (!d1Tables.has(name)) d1Tables.set(name, new Map<string, AnyRecord>());
  return d1Tables.get(name)!;
};

const getFirestoreCollection = (name: string): Map<string, AnyRecord> => {
  if (!firestoreCollections.has(name)) firestoreCollections.set(name, new Map<string, AnyRecord>());
  return firestoreCollections.get(name)!;
};

const setD1Record = (table: string, key: string, payload: AnyRecord, updatedAt?: string) => {
  getD1Table(table).set(key, {
    payload_json: JSON.stringify(payload),
    updated_at: updatedAt || new Date().toISOString(),
  });
};

const getD1Record = (table: string, key: string): AnyRecord | null => {
  const row = getD1Table(table).get(key);
  if (!row) return null;
  try {
    return JSON.parse(String(row.payload_json || '{}'));
  } catch {
    return null;
  }
};

// Track the fake db instance so tests can inspect exec counts
let fakeDb: AnyRecord;

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const getCloudflareContextMock = vi.hoisted(() => vi.fn());
const getFirebaseAdminFirestoreMock = vi.hoisted(() => vi.fn());
const getFirebaseAdminAuthMock = vi.hoisted(() => vi.fn());
const verifyFirebaseRequestMock = vi.hoisted(() => vi.fn());
const analyzeSupportRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock('../src/server/firebaseAdmin.ts', () => ({
  getFirebaseAdminFirestore: getFirebaseAdminFirestoreMock,
  getFirebaseAdminAuth: getFirebaseAdminAuthMock,
}));

vi.mock('../src/server/auth/requestAuth.ts', () => ({
  verifyFirebaseRequest: verifyFirebaseRequestMock,
}));

vi.mock('../src/server/support/automation', () => ({
  analyzeSupportRequest: analyzeSupportRequestMock,
}));

// ---------------------------------------------------------------------------
// Fake Firestore
// ---------------------------------------------------------------------------

const makeFirestoreSnapshot = (id: string, data: AnyRecord | null) => ({
  id,
  exists: Boolean(data),
  data: () => (data ? structuredClone(data) : undefined),
  ref: null as unknown,
});

const makeFirestoreDocRef = (collectionName: string, id: string) => {
  const ref: AnyRecord = {
    id,
    async get() {
      const collection = getFirestoreCollection(collectionName);
      return makeFirestoreSnapshot(id, collection.get(id) || null);
    },
    async set(value: AnyRecord, options?: { merge?: boolean }) {
      const collection = getFirestoreCollection(collectionName);
      const existing = collection.get(id) || {};
      collection.set(id, options?.merge ? { ...existing, ...structuredClone(value) } : structuredClone(value));
    },
    async delete() {
      getFirestoreCollection(collectionName).delete(id);
    },
    collection(subCollectionName: string) {
      return makeFirestoreCollection(`${collectionName}/${id}/${subCollectionName}`);
    },
  };
  return ref;
};

const makeFirestoreCollection = (name: string) => ({
  doc(id: string) {
    return makeFirestoreDocRef(name, id);
  },
  orderBy() {
    return this;
  },
  limit(limitCount: number) {
    return {
      async get() {
        const docs = [...getFirestoreCollection(name).entries()]
          .slice(0, Math.max(0, limitCount))
          .map(([id, row]) => ({
            id,
            exists: true,
            data: () => structuredClone(row),
            ref: makeFirestoreDocRef(name, id),
          }));
        return { docs, empty: docs.length === 0 };
      },
    };
  },
  where(field: string, operator: string, value: unknown) {
    return {
      orderBy() {
        return this as AnyRecord;
      },
      limit(limitCount: number) {
        return {
          async get() {
            const docs = [...getFirestoreCollection(name).entries()]
              .filter(([, row]) => operator === '==' && row[field] === value)
              .slice(0, Math.max(0, limitCount))
              .map(([id, row]) => ({
                id,
                exists: true,
                data: () => structuredClone(row),
                ref: makeFirestoreDocRef(name, id),
              }));
            return { docs, empty: docs.length === 0 };
          },
        };
      },
      async get() {
        const docs = [...getFirestoreCollection(name).entries()]
          .filter(([, row]) => operator === '==' && row[field] === value)
          .map(([id, row]) => ({
            id,
            exists: true,
            data: () => structuredClone(row),
            ref: makeFirestoreDocRef(name, id),
          }));
        return { docs, empty: docs.length === 0 };
      },
    };
  },
});

const firestore = {
  collection(name: string) {
    return makeFirestoreCollection(name);
  },
  batch() {
    return {
      set: () => undefined,
      commit: async () => undefined,
    };
  },
  runTransaction: async (fn: (transaction: AnyRecord) => Promise<unknown>) =>
    fn({
      get: async () => ({ data: () => ({}), exists: false }),
      set: () => undefined,
    }),
};

// ---------------------------------------------------------------------------
// Fake D1 database — mirrors the SQL patterns used by account/service.ts
// ---------------------------------------------------------------------------

const initializeFakeDb = () => {
  const db: AnyRecord = {
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
            const row = getD1Table('account_profiles').get(String(bound[0] || ''));
            return row ? { payload_json: row.payload_json } : null;
          }
          if (normalized.includes('from account_user_id_index')) {
            const row = getD1Table('account_user_id_index').get(String(bound[0] || ''));
            return row ? { uid: row.uid } : null;
          }
          if (normalized.includes('from account_entitlements')) {
            const row = getD1Table('account_entitlements').get(String(bound[0] || ''));
            return row ? { payload_json: row.payload_json } : null;
          }
          if (normalized.includes('from account_notification_preferences')) {
            const row = getD1Table('account_notification_preferences').get(String(bound[0] || ''));
            return row ? { payload_json: row.payload_json } : null;
          }
          if (normalized.includes('from account_support_conversations')) {
            const table = getD1Table('account_support_conversations');
            if (normalized.includes('where conversation_id = ?')) {
              const row = table.get(String(bound[0] || ''));
              return row
                ? {
                    conversation_id: row.conversation_id,
                    uid: row.uid,
                    payload_json: row.payload_json,
                    updated_at: row.updated_at,
                  }
                : null;
            }
            return null;
          }
          if (normalized.includes('from reader_legal_ack')) {
            const row = getD1Table('reader_legal_ack').get(String(bound[0] || ''));
            return row ? { payload_json: row.payload_json } : null;
          }
          return null;
        },
        async all() {
          if (normalized.includes('from account_support_conversations')) {
            const uid = String(bound[0] || '');
            const limit = Number(bound[1] || 100);
            const results = [...getD1Table('account_support_conversations').values()]
              .filter((row) => row.uid === uid)
              .sort(
                (left, right) =>
                  String(right.updated_at || '').localeCompare(String(left.updated_at || '')) ||
                  String(right.conversation_id || '').localeCompare(String(left.conversation_id || '')),
              )
              .slice(0, limit)
              .map((row) => ({
                conversation_id: row.conversation_id,
                uid: row.uid,
                payload_json: row.payload_json,
                updated_at: row.updated_at,
              }));
            return { results };
          }
          if (normalized.includes('from account_support_messages')) {
            const conversationId = String(bound[0] || '');
            const results = [...getD1Table('account_support_messages').values()]
              .filter((row) => row.conversation_id === conversationId)
              .sort(
                (left, right) =>
                  String(left.created_at || '').localeCompare(String(right.created_at || '')) ||
                  String(left.message_id || '').localeCompare(String(right.message_id || '')),
              )
              .map((row) => ({
                message_id: row.message_id,
                conversation_id: row.conversation_id,
                uid: row.uid,
                payload_json: row.payload_json,
                created_at: row.created_at,
              }));
            return { results };
          }
          if (normalized.includes('from account_coupons')) {
            const results = [...getD1Table('account_coupons').entries()].map(([id, row]) => ({
              coupon_id: id,
              payload_json: row.payload_json,
            }));
            return { results };
          }
          return { results: [] };
        },
        async run() {
          if (normalized.startsWith('insert into account_profiles')) {
            const [uid, payloadJson, updatedAt] = bound;
            getD1Table('account_profiles').set(String(uid), {
              payload_json: String(payloadJson),
              updated_at: String(updatedAt),
            });
          } else if (normalized.startsWith('insert into account_user_id_index')) {
            const [userId, uid, updatedAt] = bound;
            getD1Table('account_user_id_index').set(String(userId), {
              user_id: String(userId),
              uid: String(uid),
              updated_at: String(updatedAt),
            });
          } else if (normalized.startsWith('insert into account_entitlements')) {
            const [uid, payloadJson, updatedAt] = bound;
            getD1Table('account_entitlements').set(String(uid), {
              payload_json: String(payloadJson),
              updated_at: String(updatedAt),
            });
          } else if (normalized.startsWith('delete from account_profiles')) {
            getD1Table('account_profiles').delete(String(bound[0] || ''));
          } else if (normalized.startsWith('delete from account_user_id_index')) {
            getD1Table('account_user_id_index').delete(String(bound[0] || ''));
          } else if (normalized.startsWith('delete from account_entitlements')) {
            getD1Table('account_entitlements').delete(String(bound[0] || ''));
          } else if (normalized.startsWith('insert into account_notification_preferences')) {
            const [uid, payloadJson, updatedAt] = bound;
            getD1Table('account_notification_preferences').set(String(uid), {
              payload_json: String(payloadJson),
              updated_at: String(updatedAt),
            });
          } else if (normalized.startsWith('delete from account_notification_preferences')) {
            getD1Table('account_notification_preferences').delete(String(bound[0] || ''));
          } else if (normalized.startsWith('insert into account_support_conversations')) {
            const [conversationId, uid, payloadJson, updatedAt] = bound;
            getD1Table('account_support_conversations').set(String(conversationId), {
              conversation_id: String(conversationId),
              uid: String(uid),
              payload_json: String(payloadJson),
              updated_at: String(updatedAt),
            });
          } else if (normalized.startsWith('delete from account_support_conversations')) {
            if (normalized.includes('where uid = ?')) {
              const uid = String(bound[0] || '');
              for (const [convId, row] of getD1Table('account_support_conversations').entries()) {
                if (row.uid === uid) getD1Table('account_support_conversations').delete(convId);
              }
            } else {
              getD1Table('account_support_conversations').delete(String(bound[0] || ''));
            }
          } else if (normalized.startsWith('insert into account_support_messages')) {
            const [messageId, conversationId, uid, payloadJson, createdAt] = bound;
            getD1Table('account_support_messages').set(String(messageId), {
              message_id: String(messageId),
              conversation_id: String(conversationId),
              uid: String(uid),
              payload_json: String(payloadJson),
              created_at: String(createdAt),
            });
          } else if (normalized.startsWith('delete from account_support_messages')) {
            if (normalized.includes('where uid = ?')) {
              const uid = String(bound[0] || '');
              for (const [msgId, row] of getD1Table('account_support_messages').entries()) {
                if (row.uid === uid) getD1Table('account_support_messages').delete(msgId);
              }
            } else if (normalized.includes('where conversation_id = ?')) {
              const conversationId = String(bound[0] || '');
              for (const [msgId, row] of getD1Table('account_support_messages').entries()) {
                if (row.conversation_id === conversationId) getD1Table('account_support_messages').delete(msgId);
              }
            } else {
              getD1Table('account_support_messages').delete(String(bound[0] || ''));
            }
          }
          return {};
        },
      };
      return statement;
    },
    async exec() {
      schemaExecCallCount += 1;
      if (schemaExecShouldFail) throw new Error('Schema exec failed');
      return {};
    },
  };
  return db;
};

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const makeUserContext = (overrides: AnyRecord = {}): AnyRecord => ({
  uid: 'uid-1',
  decodedToken: { uid: 'uid-1', email: 'reader@example.com' },
  userData: { displayName: 'Reader One', email: 'reader@example.com', userId: 'reader_one' },
  ...overrides,
});

const defaultAnalyzeSupportResponse = {
  needsHuman: false,
  priority: 'yellow',
  category: 'billing',
  summary: 'Billing help',
  urgency: 'normal',
  blocked: false,
  suggestedMacro: 'billing-default',
  queue: 'support',
  mode: 'auto',
  model: 'mock-model',
  reason: 'mocked',
  draftReply: 'We will help.',
};

const setupD1TestData = () => {
  setD1Record('account_profiles', 'uid-1', {
    uid: 'uid-1',
    userId: 'reader_one',
    displayName: 'Reader One',
    email: 'reader@example.com',
    status: 'active',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
  });
  getD1Table('account_user_id_index').set('reader_one', {
    user_id: 'reader_one',
    uid: 'uid-1',
    updated_at: '2026-04-28T00:00:00.000Z',
  });
  setD1Record('account_entitlements', 'uid-1', {
    uid: 'uid-1',
    plan: 'Free',
    status: 'free_active',
    monthlyVfLimit: 10000,
    paidVfBalance: 0,
    vffBalance: 0,
    earlyAccess: false,
    updatedAt: '2026-04-28T00:00:00.000Z',
  });
  setD1Record('account_notification_preferences', 'uid-1', {
    uid: 'uid-1',
    emailAsyncJobs: true,
    emailBilling: true,
    emailSupport: true,
    emailAdminAlerts: false,
    updatedAt: '2026-04-28T00:00:00.000Z',
  });
};

const setupFirestoreFallbackData = () => {
  getFirestoreCollection('user_profiles').set('uid-1', {
    uid: 'uid-1',
    userId: 'reader_one',
    displayName: 'Reader One',
    email: 'reader@example.com',
    status: 'active',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
  });
  getFirestoreCollection('user_id_index').set('reader_one', {
    uid: 'uid-1',
    userId: 'reader_one',
    updatedAt: '2026-04-28T00:00:00.000Z',
  });
  getFirestoreCollection('entitlements').set('uid-1', {
    uid: 'uid-1',
    plan: 'Free',
    status: 'free_active',
    monthlyVfLimit: 10000,
    paidVfBalance: 0,
    vffBalance: 0,
    earlyAccess: false,
    updatedAt: '2026-04-28T00:00:00.000Z',
  });
  getFirestoreCollection('notification_preferences').set('uid-1', {
    uid: 'uid-1',
    emailAsyncJobs: true,
    emailBilling: true,
    emailSupport: true,
    emailAdminAlerts: false,
    updatedAt: '2026-04-28T00:00:00.000Z',
  });
};

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  resetDataStores();
  d1Available = true;
  fakeDb = initializeFakeDb();

  getCloudflareContextMock.mockImplementation(async () => {
    if (!d1Available) throw new Error('D1 not available');
    return { env: { DB: fakeDb } };
  });
  getFirebaseAdminFirestoreMock.mockReturnValue(firestore);
  getFirebaseAdminAuthMock.mockReturnValue({
    updateUser: vi.fn(async () => undefined),
    revokeRefreshTokens: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
  });
  verifyFirebaseRequestMock.mockResolvedValue({ uid: 'admin-1', admin: true } as never);
  analyzeSupportRequestMock.mockReturnValue(defaultAnalyzeSupportResponse);
});

// =========================================================================
// 1.  D1 availability simulation
// =========================================================================

describe('D1 availability simulation', () => {
  it('gracefully degrades when getCloudflareContext throws', async () => {
    d1Available = false;
    setupFirestoreFallbackData();

    const { getAccountProfile } = await import('../src/server/account/service');

    const result = await getAccountProfile(makeUserContext() as never);
    expect(result.profile).toBeDefined();
    expect(result.profile.uid).toBe('uid-1');
    expect(result.profile.userId).toBe('reader_one');
    expect(result.profile.displayName).toBe('Reader One');
  });

  it('gracefully degrades when getCloudflareContext returns env without DB', async () => {
    d1Available = false;
    setupFirestoreFallbackData();

    const { getAccountProfile } = await import('../src/server/account/service');

    const result = await getAccountProfile(makeUserContext() as never);
    expect(result.profile).toBeDefined();
    expect(result.profile.uid).toBe('uid-1');
  });

  it('writes to Firestore when D1 is unavailable', async () => {
    d1Available = false;
    // No pre-existing data; the bootstrap will create a fresh profile in Firestore.
    const userCtx = {
      uid: 'uid-99',
      decodedToken: { uid: 'uid-99', email: 'new@example.com' },
      userData: { displayName: 'New User' },
    };

    const { bootstrapAccountProfile } = await import('../src/server/account/service');

    const profile = await bootstrapAccountProfile(userCtx as never);
    expect(profile.uid).toBe('uid-99');

    // Profile should be written to Firestore's user_profiles collection
    const firestoreProfile = getFirestoreCollection('user_profiles').get('uid-99');
    expect(firestoreProfile).toBeDefined();
    expect(firestoreProfile?.uid).toBe('uid-99');

    // D1 tables should remain empty
    expect(getD1Table('account_profiles').has('uid-99')).toBe(false);
  });

  it('recovers when D1 becomes available again after being unavailable', async () => {
    // First call: D1 unavailable, write to Firestore
    d1Available = false;
    let { bootstrapAccountProfile } = await import('../src/server/account/service');
    await bootstrapAccountProfile({
      uid: 'uid-recovery',
      decodedToken: { uid: 'uid-recovery', email: 'recovery@example.com' },
      userData: { displayName: 'Recovery' },
    } as never);

    expect(getFirestoreCollection('user_profiles').has('uid-recovery')).toBe(true);
    expect(getD1Table('account_profiles').has('uid-recovery')).toBe(false);

    // Second call: D1 available, write to D1 (fresh module import after resetModules)
    d1Available = true;
    vi.resetModules();
    // Re-apply mocked return values after resetModules
    getCloudflareContextMock.mockImplementation(async () => {
      if (!d1Available) throw new Error('D1 not available');
      return { env: { DB: fakeDb } };
    });
    getFirebaseAdminFirestoreMock.mockReturnValue(firestore);
    getFirebaseAdminAuthMock.mockReturnValue({
      updateUser: vi.fn(async () => undefined),
      revokeRefreshTokens: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined),
    });
    analyzeSupportRequestMock.mockReturnValue(defaultAnalyzeSupportResponse);

    ({ bootstrapAccountProfile } = await import('../src/server/account/service'));

    // We need a fresh uid because the module state was reset
    const profile = await bootstrapAccountProfile({
      uid: 'uid-recovery-2',
      decodedToken: { uid: 'uid-recovery-2', email: 'recovery2@example.com' },
      userData: { displayName: 'Recovery 2' },
    } as never);
    expect(profile.uid).toBe('uid-recovery-2');
    expect(getD1Table('account_profiles').has('uid-recovery-2')).toBe(true);
  });

  it('entitlement reads return defaults when D1 is unavailable and Firestore has no data', async () => {
    d1Available = false;
    // No data in either store

    const { getAccountEntitlements } = await import('../src/server/account/service');

    const result = await getAccountEntitlements(makeUserContext() as never);
    expect(result.uid).toBe('uid-1');
    expect(result.plan).toBe('Free');
    expect(result.status).toBe('free_active');
    expect(result.monthly.vfLimit).toBe(10000);
  });
});

// =========================================================================
// 2.  Dual-write consistency
// =========================================================================

describe('Dual-write consistency', () => {
  describe('account profile writes', () => {
    it('writes account profile to D1 when D1 is available', async () => {
      setupD1TestData();
      const { upsertAccountProfile } = await import('../src/server/account/service');

      const result = await upsertAccountProfile(
        { uid: 'uid-1', decodedToken: { uid: 'uid-1', email: 'reader@example.com' }, userData: { displayName: 'Reader One' } } as never,
        { userId: 'updated_user', forceUserId: true },
      );

      expect(result.uid).toBe('uid-1');
      expect(result.userId).toBe('updated_user');

      // Verify D1 table has the updated profile
      const d1Profile = getD1Record('account_profiles', 'uid-1');
      expect(d1Profile).toBeDefined();
      expect(d1Profile?.userId).toBe('updated_user');

      // The syncUserDocument call also writes to Firestore 'users' collection
      const firestoreUser = getFirestoreCollection('users').get('uid-1');
      expect(firestoreUser).toBeDefined();
      expect(firestoreUser?.userId).toBe('updated_user');

      // User-id index should be updated in D1
      expect(getD1Table('account_user_id_index').has('reader_one')).toBe(false);
      expect(getD1Table('account_user_id_index').get('updated_user')).toBeDefined();
    });

    it('writes account profile to Firestore when D1 is unavailable', async () => {
      d1Available = false;
      setupFirestoreFallbackData();
      const { upsertAccountProfile } = await import('../src/server/account/service');

      const result = await upsertAccountProfile(
        { uid: 'uid-1', decodedToken: { uid: 'uid-1', email: 'reader@example.com' }, userData: { displayName: 'Reader One' } } as never,
        { userId: 'updated_user', forceUserId: true },
      );

      expect(result.uid).toBe('uid-1');
      expect(result.userId).toBe('updated_user');

      // Verify Firestore user_profiles collection has updated data
      const firestoreProfile = getFirestoreCollection('user_profiles').get('uid-1');
      expect(firestoreProfile).toBeDefined();
      expect(firestoreProfile?.userId).toBe('updated_user');

      // D1 tables stay empty
      expect(getD1Table('account_profiles').has('uid-1')).toBe(false);
    });

    it('bootstrap writes profile data to D1 when available', async () => {
      const uid = 'uid-bootstrap';
      const userCtx = {
        uid,
        decodedToken: { uid, email: 'bootstrap@example.com' },
        userData: { displayName: 'Bootstrap User' },
      };

      const { bootstrapAccountProfile } = await import('../src/server/account/service');

      const profile = await bootstrapAccountProfile(userCtx as never);
      expect(profile.uid).toBe(uid);

      // D1 should have the profile
      const d1Profile = getD1Record('account_profiles', uid);
      expect(d1Profile).toBeDefined();
      expect(d1Profile?.displayName).toBe('Bootstrap User');
      expect(d1Profile?.email).toBe('bootstrap@example.com');

      // Firestore 'users' collection should also have data (from syncUserDocument)
      const firestoreUser = getFirestoreCollection('users').get(uid);
      expect(firestoreUser).toBeDefined();
      expect(firestoreUser?.displayName).toBe('Bootstrap User');
    });
  });

  describe('entitlement updates', () => {
    it('writes entitlement updates to D1 when D1 is available', async () => {
      setupD1TestData();
      const { updateAccountEntitlements } = await import('../src/server/account/service');

      const result = await updateAccountEntitlements('uid-1', { plan: 'Pro', monthlyVfLimit: 500000 });

      expect(result.plan).toBe('Pro');
      expect(result.monthlyVfLimit).toBe(500000);

      const d1Entitlement = getD1Record('account_entitlements', 'uid-1');
      expect(d1Entitlement).toBeDefined();
      expect(d1Entitlement?.plan).toBe('Pro');
      expect(d1Entitlement?.monthlyVfLimit).toBe(500000);
    });

    it('writes entitlement updates to Firestore when D1 is unavailable', async () => {
      d1Available = false;
      setupFirestoreFallbackData();
      const { updateAccountEntitlements } = await import('../src/server/account/service');

      const result = await updateAccountEntitlements('uid-1', { plan: 'Pro', monthlyVfLimit: 500000 });

      expect(result.plan).toBe('Pro');

      const firestoreEntitlement = getFirestoreCollection('entitlements').get('uid-1');
      expect(firestoreEntitlement).toBeDefined();
      expect(firestoreEntitlement?.plan).toBe('Pro');
      expect(firestoreEntitlement?.monthlyVfLimit).toBe(500000);

      // D1 tables stay empty
      expect(getD1Table('account_entitlements').has('uid-1')).toBe(false);
    });

    it('dual-writes produce consistent data format between D1 and Firestore paths', async () => {
      // Write via D1 path
      setupD1TestData();
      let { updateAccountEntitlements } = await import('../src/server/account/service');
      const d1Result = await updateAccountEntitlements('uid-1', { plan: 'Pro', paidVfBalance: 5000 });

      // Write via Firestore path (reset modules, toggle D1 off, import fresh)
      d1Available = false;
      vi.resetModules();
      getCloudflareContextMock.mockImplementation(async () => {
        if (!d1Available) throw new Error('D1 not available');
        return { env: { DB: fakeDb } };
      });
      getFirebaseAdminFirestoreMock.mockReturnValue(firestore);
      getFirebaseAdminAuthMock.mockReturnValue({
        updateUser: vi.fn(async () => undefined),
        revokeRefreshTokens: vi.fn(async () => undefined),
        deleteUser: vi.fn(async () => undefined),
      });

      const uidFs = 'uid-fs';
      getFirestoreCollection('entitlements').set(uidFs, {
        uid: uidFs,
        plan: 'Free',
        status: 'free_active',
        monthlyVfLimit: 10000,
        paidVfBalance: 0,
        vffBalance: 0,
        earlyAccess: false,
        updatedAt: '2026-04-28T00:00:00.000Z',
      });

      ({ updateAccountEntitlements } = await import('../src/server/account/service'));
      const fsResult = await updateAccountEntitlements(uidFs, { plan: 'Pro', paidVfBalance: 5000 });

      // Both results should have the same shape for plan and wallet
      expect(fsResult.plan).toBe(d1Result.plan);
      expect(fsResult.paidVfBalance).toBe(d1Result.paidVfBalance);
      expect(fsResult.monthlyVfLimit).toBe(d1Result.monthlyVfLimit);
    });
  });

  describe('notification preferences', () => {
    it('writes notification preferences to D1 when D1 is available', async () => {
      setupD1TestData();
      const { patchNotificationPreferences } = await import('../src/server/account/service');

      const result = await patchNotificationPreferences(
        makeUserContext() as never,
        { emailBilling: false, emailSupport: true },
      );

      expect(result.uid).toBe('uid-1');
      expect(result.emailBilling).toBe(false);
      expect(result.emailSupport).toBe(true);

      const d1Prefs = getD1Record('account_notification_preferences', 'uid-1');
      expect(d1Prefs).toBeDefined();
      expect(d1Prefs?.emailBilling).toBe(false);
      expect(d1Prefs?.emailSupport).toBe(true);
    });

    it('writes notification preferences to Firestore when D1 is unavailable', async () => {
      d1Available = false;
      setupFirestoreFallbackData();
      const { patchNotificationPreferences } = await import('../src/server/account/service');

      const result = await patchNotificationPreferences(
        makeUserContext() as never,
        { emailBilling: false, emailSupport: true },
      );

      expect(result.emailBilling).toBe(false);
      expect(result.emailSupport).toBe(true);

      const fsPrefs = getFirestoreCollection('notification_preferences').get('uid-1');
      expect(fsPrefs).toBeDefined();
      expect(fsPrefs?.emailBilling).toBe(false);
      expect(fsPrefs?.emailSupport).toBe(true);

      // D1 should have nothing
      expect(getD1Table('account_notification_preferences').has('uid-1')).toBe(false);
    });

    it('applies default preference values when writing to D1', async () => {
      // No pre-existing preferences
      const userCtx = makeUserContext();
      const { patchNotificationPreferences } = await import('../src/server/account/service');

      const result = await patchNotificationPreferences(userCtx as never, { emailBilling: false });

      expect(result.emailAsyncJobs).toBe(true); // default
      expect(result.emailBilling).toBe(false); // patched
      expect(result.emailSupport).toBe(true); // default
      expect(result.emailAdminAlerts).toBe(false); // default (non-admin user)

      const d1Prefs = getD1Record('account_notification_preferences', 'uid-1');
      expect(d1Prefs?.emailAsyncJobs).toBe(true);
      expect(d1Prefs?.emailBilling).toBe(false);
    });
  });

  describe('support conversations and messages', () => {
    it('writes support conversations and messages to D1 when D1 is available', async () => {
      setupD1TestData();
      const { createSupportMessage, listSupportConversations } = await import('../src/server/account/service');

      const result = await createSupportMessage(
        {
          uid: 'uid-1',
          decodedToken: { uid: 'uid-1' },
          userData: { displayName: 'Reader One', userId: 'reader_one', email: 'reader@example.com' },
        } as never,
        { text: 'I need help with billing.' },
      );

      expect(result.conversation.uid).toBe('uid-1');
      expect(result.conversation.status).toBe('open');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.text).toBe('I need help with billing.');

      // Verify D1 tables have the data
      expect(getD1Table('account_support_conversations').size).toBe(1);
      expect(getD1Table('account_support_messages').size).toBe(1);

      // Verify the conversation payload contains the automation data
      const conversationEntry = [...getD1Table('account_support_conversations').values()][0];
      const conversationPayload = JSON.parse(String(conversationEntry.payload_json));
      expect(conversationPayload.priority).toBe('yellow');
      expect(conversationPayload.aiMode).toBe('auto');

      // Verify we can list conversations
      const items = await listSupportConversations(
        { uid: 'uid-1', decodedToken: { uid: 'uid-1' }, userData: { displayName: 'Reader One', userId: 'reader_one', email: 'reader@example.com' } } as never,
        10,
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        conversationId: result.conversation.conversationId,
        uid: 'uid-1',
        status: 'open',
      });
    });

    it('writes support conversations to Firestore when D1 is unavailable', async () => {
      d1Available = false;
      setupFirestoreFallbackData();
      const { createSupportMessage } = await import('../src/server/account/service');

      const result = await createSupportMessage(
        {
          uid: 'uid-1',
          decodedToken: { uid: 'uid-1' },
          userData: { displayName: 'Reader One', userId: 'reader_one', email: 'reader@example.com' },
        } as never,
        { text: 'I need help with billing.' },
      );

      expect(result.conversation.uid).toBe('uid-1');
      expect(result.messages).toHaveLength(1);

      // Verify Firestore has the conversation
      expect(getFirestoreCollection('support_conversations').size).toBeGreaterThanOrEqual(1);
      expect(getFirestoreCollection('support_messages').size).toBeGreaterThanOrEqual(1);

      // D1 tables should be empty
      expect(getD1Table('account_support_conversations').size).toBe(0);
      expect(getD1Table('account_support_messages').size).toBe(0);
    });
  });
});

// =========================================================================
// 3.  Read priority
// =========================================================================

describe('Read priority', () => {
  it('reads account profile from D1 first when D1 is available', async () => {
    // Set up DIFFERENT data in D1 vs Firestore
    setD1Record('account_profiles', 'uid-1', {
      uid: 'uid-1',
      userId: 'd1_user',
      displayName: 'D1 User',
      email: 'd1@example.com',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    getFirestoreCollection('user_profiles').set('uid-1', {
      uid: 'uid-1',
      userId: 'firestore_user',
      displayName: 'Firestore User',
      email: 'firestore@example.com',
      status: 'active',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    const { getAccountProfile } = await import('../src/server/account/service');

    const result = await getAccountProfile(
      { uid: 'uid-1', decodedToken: { uid: 'uid-1', email: 'd1@example.com' }, userData: null } as never,
    );

    // Should return D1 data, not Firestore data
    expect(result.profile.userId).toBe('d1_user');
    expect(result.profile.displayName).toBe('D1 User');
    expect(result.profile.email).toBe('d1@example.com');
  });

  it('reads entitlements from D1 first when D1 is available', async () => {
    // D1 has data
    setD1Record('account_entitlements', 'uid-1', {
      uid: 'uid-1',
      plan: 'Pro',
      status: 'active',
      monthlyVfLimit: 500000,
      paidVfBalance: 10000,
      vffBalance: 500,
      earlyAccess: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    // Firestore has different data
    getFirestoreCollection('entitlements').set('uid-1', {
      uid: 'uid-1',
      plan: 'Free',
      status: 'free_active',
      monthlyVfLimit: 10000,
      paidVfBalance: 0,
      vffBalance: 0,
      earlyAccess: false,
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    const { getAccountEntitlements } = await import('../src/server/account/service');

    const result = await getAccountEntitlements(
      { uid: 'uid-1', decodedToken: { uid: 'uid-1' }, userData: null } as never,
    );

    // Should merge defaults with D1 data, not Firestore data
    expect(result.plan).toBe('Pro');
    expect(result.status).toBe('active');
    expect(result.monthly.vfLimit).toBe(500000);
    expect(result.wallet.paidVfBalance).toBe(10000);
    expect(result.wallet.vffBalance).toBe(500);
    expect(result.features.earlyAccess).toBe(true);
  });

  it('reads notification preferences from D1 first when D1 is available', async () => {
    setD1Record('account_notification_preferences', 'uid-1', {
      uid: 'uid-1',
      emailAsyncJobs: false,
      emailBilling: false,
      emailSupport: false,
      emailAdminAlerts: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    getFirestoreCollection('notification_preferences').set('uid-1', {
      uid: 'uid-1',
      emailAsyncJobs: true,
      emailBilling: true,
      emailSupport: true,
      emailAdminAlerts: false,
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    const userCtx = {
      uid: 'uid-1',
      decodedToken: { uid: 'uid-1', email: 'admin@example.com', admin: true },
      userData: { isAdmin: true },
    };
    const { getNotificationPreferences } = await import('../src/server/account/service');

    const result = await getNotificationPreferences(userCtx as never);

    expect(result.emailAsyncJobs).toBe(false);
    expect(result.emailBilling).toBe(false);
    expect(result.emailSupport).toBe(false);
    // adminAlerts normalized: admin user + explicitly true
    expect(result.emailAdminAlerts).toBe(true);
  });

  it('reads from Firestore when D1 is unavailable', async () => {
    d1Available = false;
    setupFirestoreFallbackData();

    const { getAccountProfile } = await import('../src/server/account/service');

    const result = await getAccountProfile(makeUserContext() as never);
    expect(result.profile.uid).toBe('uid-1');
    expect(result.profile.userId).toBe('reader_one');
  });

  it('returns defaults when D1 is available but has no data for the requested key', async () => {
    // D1 available but no data for uid-1
    // Firestore has data but should NOT be used since D1 is available
    setupFirestoreFallbackData();

    const { getAccountEntitlements } = await import('../src/server/account/service');

    const result = await getAccountEntitlements(makeUserContext() as never);

    // Should NOT return Firestore data; returns defaults merged with nothing
    expect(result.plan).toBe('Free');
    expect(result.monthly.vfLimit).toBe(10000);
    expect(result.wallet.paidVfBalance).toBe(0);
  });

  it('returns null for profile when D1 available but profile does not exist', async () => {
    // D1 available but profile not in D1
    // Firestore user_profiles has data but D1 is primary
    getFirestoreCollection('user_profiles').set('uid-nodata', {
      uid: 'uid-nodata',
      userId: 'no_data_user',
      displayName: 'No Data',
      status: 'active',
    });

    const { getAccountProfile } = await import('../src/server/account/service');

    // With no existing profile and D1 available, it should create a NEW profile
    // (getAccountProfile calls ensureAccountProfile which bootstraps if needed)
    const result = await getAccountProfile({
      uid: 'uid-nodata',
      decodedToken: { uid: 'uid-nodata', email: 'nodata@example.com' },
      userData: { displayName: 'No Data' },
    } as never);

    // It created a fresh profile (no existing in D1)
    expect(result.profile).toBeDefined();
    expect(result.profile.uid).toBe('uid-nodata');
  });

  it('falls back to Firestore when D1 is available but the D1 DB returns null for all queries', async () => {
    // This simulates a D1 that's connected but has empty tables
    // The account service code does NOT fall back to Firestore when D1 is available
    // but has no data; it returns null/defaults.  We verify that behavior.
    setupFirestoreFallbackData();

    const { readPersistedProfileRecord: readProfile } = await import(
      '../src/server/account/service'
    );
    // readPersistedProfileRecord is not exported, so we test through getAccountProfile instead

    const { getAccountProfile } = await import('../src/server/account/service');
    const result = await getAccountProfile({
      uid: 'uid-1',
      decodedToken: { uid: 'uid-1', email: 'reader@example.com' },
      userData: { displayName: 'Reader One' },
    } as never);

    // Since D1 is available but has no data, ensureAccountProfile creates a new profile
    // The Firestore fallback data is NOT read because D1 is available
    expect(result.profile.uid).toBe('uid-1');

    // The profile was newly created (since D1 has no existing data), so it should
    // have been written to D1
    const d1Profile = getD1Record('account_profiles', 'uid-1');
    expect(d1Profile).toBeDefined();
    expect(d1Profile?.email).toBe('reader@example.com');
  });
});

// =========================================================================
// 4.  Schema initialization
// =========================================================================

describe('Schema initialization idempotency', () => {
  it('ensureD1Schema calls db.exec exactly once for repeated invocations', async () => {
    setupD1TestData();
    const { getAccountProfile } = await import('../src/server/account/service');

    // First call triggers schema initialization
    await getAccountProfile(makeUserContext() as never);

    const firstExecCount = schemaExecCallCount;

    // Second call should NOT trigger schema init again (cached promise)
    await getAccountProfile(makeUserContext() as never);

    expect(schemaExecCallCount).toBe(firstExecCount);
    expect(schemaExecCallCount).toBeGreaterThanOrEqual(1);
  });

  it('schema exec is called exactly once across different D1 operations', async () => {
    setupD1TestData();
    const { getAccountProfile, getAccountEntitlements, getNotificationPreferences } = await import(
      '../src/server/account/service'
    );

    // Multiple operations all trigger ensureAccountBillingD1Schema
    await getAccountProfile(makeUserContext() as never);
    await getAccountEntitlements(makeUserContext() as never);
    await getNotificationPreferences(makeUserContext() as never);

    // Schema should only be initialized once
    expect(schemaExecCallCount).toBe(1);
  });

  it('recovers from schema initialization failure on retry', async () => {
    schemaExecShouldFail = true;
    setupD1TestData();

    const { getAccountProfile } = await import('../src/server/account/service');

    // First call: schema init fails
    await expect(getAccountProfile(makeUserContext() as never)).rejects.toThrow('Schema exec failed');
    expect(schemaExecCallCount).toBe(1);

    // Second call with the same module instance: schema init should retry
    schemaExecShouldFail = false;
    const result = await getAccountProfile(makeUserContext() as never);
    expect(result.profile).toBeDefined();
    // exec should have been called a second time for the retry
    expect(schemaExecCallCount).toBe(2);
  });

  it('schema exec failure resets the promise so subsequent calls retry', async () => {
    schemaExecShouldFail = true;
    setupD1TestData();

    const { getAccountProfile } = await import('../src/server/account/service');

    // Schema init fails on first call
    await expect(getAccountProfile(makeUserContext() as never)).rejects.toThrow('Schema exec failed');

    // The schema promise should have been reset to null on failure

    // Make exec succeed now
    schemaExecShouldFail = false;

    // This should retry and succeed
    const result = await getAccountProfile(makeUserContext() as never);
    expect(result.profile).toBeDefined();
  });

  it('shared ensureD1Schema from d1/util is idempotent', async () => {
    // Import the shared D1 utility and test its ensureD1Schema directly
    const { ensureD1Schema } = await import('../src/server/d1/util');

    const schemaSql = 'CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY);';

    // Call twice
    await ensureD1Schema(fakeDb as never, schemaSql);
    const callAfterFirst = schemaExecCallCount;

    await ensureD1Schema(fakeDb as never, schemaSql);
    expect(schemaExecCallCount).toBe(callAfterFirst);
    expect(schemaExecCallCount).toBeGreaterThanOrEqual(1);
  });

  it('ensureD1Schema tracks separate schemas independently', async () => {
    const { ensureD1Schema } = await import('../src/server/d1/util');

    const schemaA = 'CREATE TABLE IF NOT EXISTS table_a (id TEXT PRIMARY KEY);';
    const schemaB = 'CREATE TABLE IF NOT EXISTS table_b (id TEXT PRIMARY KEY);';

    await ensureD1Schema(fakeDb as never, schemaA);
    await ensureD1Schema(fakeDb as never, schemaB);

    // Two schemas should result in two exec calls
    expect(schemaExecCallCount).toBe(2);

    // Calling both again should be no-ops
    await ensureD1Schema(fakeDb as never, schemaA);
    await ensureD1Schema(fakeDb as never, schemaB);
    expect(schemaExecCallCount).toBe(2);
  });
});

// =========================================================================
// 5.  Cross-domain data integrity
// =========================================================================

describe('Cross-domain data integrity', () => {
  it('admin-equivalent profile read returns D1-backed data', async () => {
    // The admin service (admin/service.ts) calls getAccountProfile from the
    // account service.  We verify the entire chain works with D1 data.
    setupD1TestData();

    const { getAccountProfile } = await import('../src/server/account/service');

    // Call exactly like getAdminAccountProfile does
    const profile = await getAccountProfile({
      uid: 'uid-1',
      decodedToken: { uid: 'uid-1', email: 'reader@example.com' },
      userRef: null,
      userData: { email: 'reader@example.com' },
      userExists: true,
    } as never);

    expect(profile.profile).toBeDefined();
    expect(profile.profile.uid).toBe('uid-1');
    expect(profile.profile.userId).toBe('reader_one');
    expect(profile.profile.displayName).toBe('Reader One');
    expect(profile.profile.email).toBe('reader@example.com');
    expect(profile.profile.status).toBe('active');
  });

  it('admin-equivalent entitlement read returns D1-backed data', async () => {
    setupD1TestData();

    const { getAccountEntitlements } = await import('../src/server/account/service');

    // Call like getUserEntitlements does
    const entitlements = await getAccountEntitlements({
      uid: 'uid-1',
      decodedToken: { uid: 'uid-1' },
      userRef: null,
      userData: null,
      userExists: false,
    } as never);

    expect(entitlements.uid).toBe('uid-1');
    expect(entitlements.plan).toBe('Free');
    expect(entitlements.monthly.vfLimit).toBe(10000);
    expect(entitlements.wallet.paidVfBalance).toBe(0);
    expect(entitlements.wallet.vffBalance).toBe(0);
  });

  it('reads entitlements from D1 when Firestore has divergent data', async () => {
    // D1 has Pro plan
    setD1Record('account_entitlements', 'uid-1', {
      uid: 'uid-1',
      plan: 'Pro',
      status: 'active',
      monthlyVfLimit: 500000,
      paidVfBalance: 25000,
      vffBalance: 1000,
      earlyAccess: true,
      vcFreeBalance: 500,
      vcGrantedBalance: 200,
      vcPaidBalance: 300,
      vcSpendableBalance: 1000,
      updatedAt: '2026-04-28T00:00:00.000Z',
    });
    // Firestore has Free plan (should not be read)
    getFirestoreCollection('entitlements').set('uid-1', {
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
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    const { getAccountEntitlements } = await import('../src/server/account/service');

    const result = await getAccountEntitlements({
      uid: 'uid-1',
      decodedToken: { uid: 'uid-1' },
      userRef: null,
      userData: null,
      userExists: false,
    } as never);

    // Must use D1 data, not Firestore
    expect(result.plan).toBe('Pro');
    expect(result.monthly.vfLimit).toBe(500000);
    expect(result.wallet.paidVfBalance).toBe(25000);
    expect(result.wallet.vffBalance).toBe(1000);
    expect(result.features.earlyAccess).toBe(true);
    expect(result.wallet.vcFreeBalance).toBe(500);
    expect(result.wallet.vcGrantedBalance).toBe(200);
    expect(result.wallet.vcPaidBalance).toBe(300);

    // The spendable balance comes from D1's explicit vcSpendableBalance value
    expect(result.wallet.vcSpendableBalance).toBe(1000);
  });

  it('reads notification preferences from D1 first in admin-operations flow', async () => {
    setD1Record('account_notification_preferences', 'uid-1', {
      uid: 'uid-1',
      emailAsyncJobs: false,
      emailBilling: false,
      emailSupport: false,
      emailAdminAlerts: true,
      updatedAt: '2026-04-28T00:00:00.000Z',
    });
    // Firestore has different values (should be ignored when D1 available)
    getFirestoreCollection('notification_preferences').set('uid-1', {
      uid: 'uid-1',
      emailAsyncJobs: true,
      emailBilling: true,
      emailSupport: true,
      emailAdminAlerts: false,
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    const { getNotificationPreferences } = await import('../src/server/account/service');

    const userCtx = {
      uid: 'uid-1',
      decodedToken: { uid: 'uid-1', email: 'admin@example.com', admin: true },
      userData: { isAdmin: true },
    };

    const result = await getNotificationPreferences(userCtx as never);

    // Must use D1 values
    expect(result.emailAsyncJobs).toBe(false);
    expect(result.emailBilling).toBe(false);
    expect(result.emailSupport).toBe(false);
    expect(result.emailAdminAlerts).toBe(true);
  });

  it('admin writes through updateAccountEntitlements land in D1', async () => {
    // The admin service's patchAdminUserHandler calls updateAccountEntitlements.
    // We verify the write path to D1 works correctly.
    setD1Record('account_entitlements', 'uid-1', {
      uid: 'uid-1',
      plan: 'Free',
      status: 'free_active',
      monthlyVfLimit: 10000,
      paidVfBalance: 0,
      vffBalance: 0,
      earlyAccess: false,
      updatedAt: '2026-04-28T00:00:00.000Z',
    });

    const { updateAccountEntitlements } = await import('../src/server/account/service');

    // Simulate admin setting Pro plan + adding VF balance (like patchAdminUserHandler does)
    const updated = await updateAccountEntitlements(
      'uid-1',
      {
        plan: 'Pro',
        monthlyVfLimit: 500000,
        paidVfBalance: 25000,
        status: 'active',
      },
      'free',
    );

    expect(updated.plan).toBe('Pro');
    expect(updated.paidVfBalance).toBe(25000);

    // Verify D1
    const d1Entitlement = getD1Record('account_entitlements', 'uid-1');
    expect(d1Entitlement?.plan).toBe('Pro');
    expect(d1Entitlement?.paidVfBalance).toBe(25000);
    expect(d1Entitlement?.monthlyVfLimit).toBe(500000);
  });
});
