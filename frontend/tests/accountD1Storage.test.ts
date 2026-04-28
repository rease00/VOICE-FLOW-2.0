import { beforeEach, describe, expect, it, vi } from 'vitest';

type AnyRecord = Record<string, unknown>;

const accountTables = {
  profiles: new Map<string, AnyRecord>(),
  userIdIndex: new Map<string, AnyRecord>(),
  entitlements: new Map<string, AnyRecord>(),
  notificationPreferences: new Map<string, AnyRecord>(),
  supportConversations: new Map<string, AnyRecord>(),
  supportMessages: new Map<string, AnyRecord>(),
  readerLegalAck: new Map<string, AnyRecord>(),
};

const firestoreCollections = new Map<string, Map<string, AnyRecord>>();

const analyzeSupportRequestMock = vi.hoisted(() => vi.fn());
const getCloudflareContextMock = vi.hoisted(() => vi.fn());
const getFirebaseAdminFirestoreMock = vi.hoisted(() => vi.fn());
const getFirebaseAdminAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock('../src/server/support/automation', () => ({
  analyzeSupportRequest: analyzeSupportRequestMock,
}));

vi.mock('../src/server/firebaseAdmin.ts', () => ({
  getFirebaseAdminAuth: getFirebaseAdminAuthMock,
  getFirebaseAdminFirestore: getFirebaseAdminFirestoreMock,
}));

const resetTables = () => {
  for (const table of Object.values(accountTables)) table.clear();
  firestoreCollections.clear();
};

const makeSnapshot = (id: string, data: AnyRecord | null) => ({
  id,
  exists: Boolean(data),
  data: () => (data ? structuredClone(data) : undefined),
  ref: null,
});

const getCollection = (name: string): Map<string, AnyRecord> => {
  if (!firestoreCollections.has(name)) {
    firestoreCollections.set(name, new Map<string, AnyRecord>());
  }
  return firestoreCollections.get(name)!;
};

const makeDocRef = (collectionName: string, id: string) => {
  const ref: AnyRecord = {
    id,
    async get() {
      const collection = getCollection(collectionName);
      return makeSnapshot(id, collection.get(id) || null);
    },
    async set(value: AnyRecord, options?: { merge?: boolean }) {
      const collection = getCollection(collectionName);
      const existing = collection.get(id) || {};
      collection.set(id, options?.merge ? { ...existing, ...structuredClone(value) } : structuredClone(value));
    },
    async delete() {
      getCollection(collectionName).delete(id);
    },
    collection(subCollectionName: string) {
      return makeCollection(`${collectionName}/${id}/${subCollectionName}`);
    },
  };
  return ref;
};

const makeCollection = (name: string) => ({
  doc(id: string) {
    return makeDocRef(name, id);
  },
  where(field: string, operator: string, value: unknown) {
    return {
      limit(limitCount: number) {
        return {
          async get() {
            const docs = [...getCollection(name).entries()]
              .filter(([, row]) => operator === '==' && row[field] === value)
              .slice(0, Math.max(0, limitCount))
              .map(([id, row]) => ({
                id,
                exists: true,
                data: () => structuredClone(row),
                ref: makeDocRef(name, id),
              }));
            return { docs, empty: docs.length === 0 };
          },
        };
      },
      async get() {
        const docs = [...getCollection(name).entries()]
          .filter(([, row]) => operator === '==' && row[field] === value)
          .map(([id, row]) => ({
            id,
            exists: true,
            data: () => structuredClone(row),
            ref: makeDocRef(name, id),
          }));
        return { docs, empty: docs.length === 0 };
      },
    };
  },
});

const firestore = {
  collection(name: string) {
    return makeCollection(name);
  },
  batch() {
    return {
      set: () => undefined,
      commit: async () => undefined,
    };
  },
  runTransaction: async (fn: (transaction: AnyRecord) => Promise<unknown>) => fn({
    get: async () => ({ data: () => ({}), exists: false }),
    set: () => undefined,
  }),
};

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
        if (normalized.includes('from account_profiles')) {
          const row = accountTables.profiles.get(String(bound[0] || ''));
          return row ? { payload_json: row.payload_json } : null;
        }
        if (normalized.includes('from account_user_id_index')) {
          const row = accountTables.userIdIndex.get(String(bound[0] || ''));
          return row ? { uid: row.uid } : null;
        }
        if (normalized.includes('from account_entitlements')) {
          const row = accountTables.entitlements.get(String(bound[0] || ''));
          return row ? { payload_json: row.payload_json } : null;
        }
        if (normalized.includes('from account_notification_preferences')) {
          const row = accountTables.notificationPreferences.get(String(bound[0] || ''));
          return row ? { payload_json: row.payload_json } : null;
        }
        if (normalized.includes('from account_support_conversations')) {
          const table = accountTables.supportConversations;
          if (normalized.includes('where conversation_id = ?')) {
            const row = table.get(String(bound[0] || ''));
            return row ? {
              conversation_id: row.conversation_id,
              uid: row.uid,
              payload_json: row.payload_json,
              updated_at: row.updated_at,
            } : null;
          }
          return null;
        }
        if (normalized.includes('from reader_legal_ack')) {
          const row = accountTables.readerLegalAck.get(String(bound[0] || ''));
          return row ? { payload_json: row.payload_json } : null;
        }
        return null;
      },
      async all() {
        if (normalized.includes('from account_support_conversations')) {
          const uid = String(bound[0] || '');
          const limit = Number(bound[1] || 100);
          const results = [...accountTables.supportConversations.values()]
            .filter((row) => row.uid === uid)
            .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')) || String(right.conversation_id || '').localeCompare(String(left.conversation_id || '')))
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
          const results = [...accountTables.supportMessages.values()]
            .filter((row) => row.conversation_id === conversationId)
            .sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')) || String(left.message_id || '').localeCompare(String(right.message_id || '')))
            .map((row) => ({
              message_id: row.message_id,
              conversation_id: row.conversation_id,
              uid: row.uid,
              payload_json: row.payload_json,
              created_at: row.created_at,
            }));
          return { results };
        }
        return { results: [] };
      },
      async run() {
        if (normalized.startsWith('insert into account_profiles')) {
          const [uid, payloadJson, updatedAt] = bound;
          accountTables.profiles.set(String(uid), {
            uid: String(uid),
            payload_json: String(payloadJson),
            updated_at: String(updatedAt),
          });
        } else if (normalized.startsWith('insert into account_user_id_index')) {
          const [userId, uid, updatedAt] = bound;
          accountTables.userIdIndex.set(String(userId), {
            user_id: String(userId),
            uid: String(uid),
            updated_at: String(updatedAt),
          });
        } else if (normalized.startsWith('insert into account_entitlements')) {
          const [uid, payloadJson, updatedAt] = bound;
          accountTables.entitlements.set(String(uid), {
            uid: String(uid),
            payload_json: String(payloadJson),
            updated_at: String(updatedAt),
          });
        } else if (normalized.startsWith('delete from account_profiles')) {
          accountTables.profiles.delete(String(bound[0] || ''));
        } else if (normalized.startsWith('delete from account_user_id_index')) {
          accountTables.userIdIndex.delete(String(bound[0] || ''));
        } else if (normalized.startsWith('delete from account_entitlements')) {
          accountTables.entitlements.delete(String(bound[0] || ''));
        } else if (normalized.startsWith('insert into account_notification_preferences')) {
          const [uid, payloadJson, updatedAt] = bound;
          accountTables.notificationPreferences.set(String(uid), {
            uid: String(uid),
            payload_json: String(payloadJson),
            updated_at: String(updatedAt),
          });
        } else if (normalized.startsWith('delete from account_notification_preferences')) {
          accountTables.notificationPreferences.delete(String(bound[0] || ''));
        } else if (normalized.startsWith('insert into account_support_conversations')) {
          const [conversationId, uid, payloadJson, updatedAt] = bound;
          accountTables.supportConversations.set(String(conversationId), {
            conversation_id: String(conversationId),
            uid: String(uid),
            payload_json: String(payloadJson),
            updated_at: String(updatedAt),
          });
        } else if (normalized.startsWith('delete from account_support_conversations')) {
          if (normalized.includes('where uid = ?')) {
            const uid = String(bound[0] || '');
            for (const [conversationId, row] of accountTables.supportConversations.entries()) {
              if (row.uid === uid) accountTables.supportConversations.delete(conversationId);
            }
          } else {
            accountTables.supportConversations.delete(String(bound[0] || ''));
          }
        } else if (normalized.startsWith('insert into account_support_messages')) {
          const [messageId, conversationId, uid, payloadJson, createdAt] = bound;
          accountTables.supportMessages.set(String(messageId), {
            message_id: String(messageId),
            conversation_id: String(conversationId),
            uid: String(uid),
            payload_json: String(payloadJson),
            created_at: String(createdAt),
          });
        } else if (normalized.startsWith('delete from account_support_messages')) {
          if (normalized.includes('where uid = ?')) {
            const uid = String(bound[0] || '');
            for (const [messageId, row] of accountTables.supportMessages.entries()) {
              if (row.uid === uid) accountTables.supportMessages.delete(messageId);
            }
          } else if (normalized.includes('where conversation_id = ?')) {
            const conversationId = String(bound[0] || '');
            for (const [messageId, row] of accountTables.supportMessages.entries()) {
              if (row.conversation_id === conversationId) accountTables.supportMessages.delete(messageId);
            }
          } else {
            accountTables.supportMessages.delete(String(bound[0] || ''));
          }
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

describe('account server D1 storage', () => {
  beforeEach(() => {
    resetTables();
    getCloudflareContextMock.mockResolvedValue({ env: { DB: fakeDb } });
    getFirebaseAdminFirestoreMock.mockReturnValue(firestore);
    getFirebaseAdminAuthMock.mockReturnValue({
      deleteUser: vi.fn(async () => undefined),
    });
    analyzeSupportRequestMock.mockReturnValue({
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
    });

    accountTables.profiles.set('uid-1', {
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
  });

  it('reads and patches notification preferences from D1', async () => {
    accountTables.notificationPreferences.set('uid-1', {
      uid: 'uid-1',
      payload_json: JSON.stringify({
        uid: 'uid-1',
        emailAsyncJobs: false,
        emailBilling: true,
        emailSupport: false,
        emailAdminAlerts: false,
        updatedAt: '2026-04-28T01:00:00.000Z',
      }),
      updated_at: '2026-04-28T01:00:00.000Z',
    });

    const { getNotificationPreferences, patchNotificationPreferences } = await import('../src/server/account/service');

    await expect(getNotificationPreferences({ uid: 'uid-1', decodedToken: {}, userData: null } as any)).resolves.toMatchObject({
      uid: 'uid-1',
      emailAsyncJobs: false,
      emailBilling: true,
      emailSupport: false,
      emailAdminAlerts: false,
    });

    await expect(patchNotificationPreferences({ uid: 'uid-1', decodedToken: {}, userData: null } as any, {
      emailBilling: false,
      emailSupport: true,
    })).resolves.toMatchObject({
      uid: 'uid-1',
      emailAsyncJobs: false,
      emailBilling: false,
      emailSupport: true,
      emailAdminAlerts: false,
    });

    expect(JSON.parse(String(accountTables.notificationPreferences.get('uid-1')?.payload_json || '{}'))).toMatchObject({
      uid: 'uid-1',
      emailBilling: false,
      emailSupport: true,
    });
  });

  it('stores support conversations and messages in D1 while preserving the response shape', async () => {
    const { createSupportMessage, listSupportConversations } = await import('../src/server/account/service');

    const created = await createSupportMessage({ uid: 'uid-1', decodedToken: {}, userData: { displayName: 'Reader One', userId: 'reader_one', email: 'reader@example.com' } } as any, {
      text: 'I need help with billing.',
    });

    expect(created.conversation.uid).toBe('uid-1');
    expect(created.conversation.status).toBe('open');
    expect(created.messages).toHaveLength(1);
    expect(created.messages[0]?.text).toBe('I need help with billing.');

    expect(accountTables.supportConversations.size).toBe(1);
    expect(accountTables.supportMessages.size).toBe(1);

    const items = await listSupportConversations({ uid: 'uid-1', decodedToken: {}, userData: { displayName: 'Reader One', userId: 'reader_one', email: 'reader@example.com' } } as any, 10);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      conversationId: created.conversation.conversationId,
      uid: 'uid-1',
      status: 'open',
      priority: 'yellow',
    });
  });

  it('forces userId updates through the D1 profile and user-id index mirrors', async () => {
    const { upsertAccountProfile } = await import('../src/server/account/service');

    const profile = await upsertAccountProfile({ uid: 'uid-1', decodedToken: {}, userData: null } as any, {
      userId: 'reader_two',
      forceUserId: true,
    });

    expect(profile).toMatchObject({
      uid: 'uid-1',
      userId: 'reader_two',
    });
    expect(accountTables.userIdIndex.has('reader_one')).toBe(false);
    expect(accountTables.userIdIndex.get('reader_two')).toMatchObject({
      user_id: 'reader_two',
      uid: 'uid-1',
    });
    expect(JSON.parse(String(accountTables.profiles.get('uid-1')?.payload_json || '{}'))).toMatchObject({
      uid: 'uid-1',
      userId: 'reader_two',
    });
    expect(firestoreCollections.get('user_profiles')?.get('uid-1')).toMatchObject({
      uid: 'uid-1',
      userId: 'reader_two',
    });
  });
});
