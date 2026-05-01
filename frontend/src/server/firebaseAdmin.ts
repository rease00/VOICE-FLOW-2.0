import { randomUUID } from 'node:crypto';

import { getCloudflareContext } from '@opennextjs/cloudflare';

import { getD1AuthService } from './auth/d1Auth.ts';

export type App = { readonly __compat?: true };

type CompatDocRow = {
  path: string;
  collectionPath: string;
  docId: string;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
};

type CompatDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
      run: () => Promise<unknown>;
    };
  };
  exec: (sql: string) => Promise<unknown>;
};

type FirestoreLikeQuery = {
  get: () => Promise<FirestoreLikeQuerySnapshot>;
  where: (field: string, op: string, value: unknown) => FirestoreLikeQuery;
  orderBy: (field: string, direction?: 'asc' | 'desc') => FirestoreLikeQuery;
  limit: (count: number) => FirestoreLikeQuery;
};

type FirestoreLikeDocument = {
  id: string;
  path: string;
  parent: FirestoreLikeCollection;
  firestore: FirestoreLikeDb;
  withConverter: () => FirestoreLikeDocument;
  get: () => Promise<FirestoreLikeDocumentSnapshot>;
  set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>;
  update: (data: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
  collection: (name: string) => FirestoreLikeCollection;
};

type FirestoreLikeCollection = FirestoreLikeQuery & {
  id: string;
  path: string;
  parent: FirestoreLikeDocument | null;
  firestore: FirestoreLikeDb;
  doc: (id?: string) => FirestoreLikeDocument;
  withConverter: () => FirestoreLikeCollection;
};

type FirestoreLikeDocumentSnapshot = {
  id: string;
  exists: boolean;
  ref: FirestoreLikeDocument;
  data: () => Record<string, unknown> | undefined;
  get: (field: string) => unknown;
};

type FirestoreLikeQuerySnapshot = {
  docs: FirestoreLikeDocumentSnapshot[];
  empty: boolean;
  size: number;
  forEach: (callback: (snapshot: FirestoreLikeDocumentSnapshot) => void) => void;
};

type FirestoreLikeTransaction = {
  get: (ref: FirestoreLikeDocument) => Promise<FirestoreLikeDocumentSnapshot>;
  set: (ref: FirestoreLikeDocument, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
  delete: (ref: FirestoreLikeDocument) => void;
};

type FirestoreLikeBatch = {
  set: (ref: FirestoreLikeDocument, data: Record<string, unknown>, options?: { merge?: boolean }) => FirestoreLikeBatch;
  delete: (ref: FirestoreLikeDocument) => FirestoreLikeBatch;
  commit: () => Promise<void>;
};

type FirestoreLikeDb = {
  collection: (path: string) => FirestoreLikeCollection;
  batch: () => FirestoreLikeBatch;
  runTransaction: <T>(callback: (transaction: FirestoreLikeTransaction) => Promise<T>) => Promise<T>;
};

const FIRESTORE_COMPAT_TABLE = 'firebase_compat_documents';
const memoryDocs = new Map<string, CompatDocRow>();
let compatDbPromise: Promise<CompatDb | null> | null = null;
let compatSchemaPromise: Promise<void> | null = null;

const normalizePath = (...parts: string[]): string => parts.map((part) => String(part || '').trim()).filter(Boolean).join('/');

const nowIso = (): string => new Date().toISOString();

const getCompatDb = async (): Promise<CompatDb | null> => {
  if (!compatDbPromise) {
    compatDbPromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: CompatDb }).DB;
        return db && typeof db.prepare === 'function' ? db : null;
      } catch {
        return null;
      }
    })();
  }
  return compatDbPromise;
};

const ensureCompatSchema = async (db: CompatDb): Promise<void> => {
  if (!compatSchemaPromise) {
    compatSchemaPromise = db.exec(`
CREATE TABLE IF NOT EXISTS ${FIRESTORE_COMPAT_TABLE} (
  path TEXT PRIMARY KEY NOT NULL,
  collection_path TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ${FIRESTORE_COMPAT_TABLE}_collection_path_idx
  ON ${FIRESTORE_COMPAT_TABLE} (collection_path, doc_id);
`).then(() => undefined).catch((error: unknown) => {
      compatSchemaPromise = null;
      throw error;
    });
  }
  await compatSchemaPromise;
};

const readCompatRow = async (path: string): Promise<CompatDocRow | null> => {
  const db = await getCompatDb();
  if (!db) {
    return memoryDocs.get(path) || null;
  }
  await ensureCompatSchema(db);
  const row = await db.prepare(`SELECT * FROM ${FIRESTORE_COMPAT_TABLE} WHERE path = ? LIMIT 1`).bind(path).first<CompatDocRow>();
  return row || null;
};

const listCompatRows = async (collectionPath: string): Promise<CompatDocRow[]> => {
  const db = await getCompatDb();
  if (!db) {
    return Array.from(memoryDocs.values()).filter((row) => row.collectionPath === collectionPath);
  }
  await ensureCompatSchema(db);
  const result = await db.prepare(`SELECT * FROM ${FIRESTORE_COMPAT_TABLE} WHERE collection_path = ? ORDER BY doc_id ASC`)
    .bind(collectionPath)
    .all<CompatDocRow>();
  return Array.isArray(result.results) ? result.results : [];
};

const writeCompatRow = async (row: CompatDocRow, merge = false): Promise<void> => {
  const db = await getCompatDb();
  const existing = await readCompatRow(row.path);
  const next = merge && existing
    ? {
        ...existing,
        payloadJson: JSON.stringify({
          ...(existing.payloadJson ? JSON.parse(existing.payloadJson) : {}),
          ...(row.payloadJson ? JSON.parse(row.payloadJson) : {}),
        }),
        updatedAt: row.updatedAt || nowIso(),
      }
    : {
        ...row,
        createdAt: existing?.createdAt || row.createdAt || nowIso(),
        updatedAt: row.updatedAt || nowIso(),
      };

  if (!db) {
    memoryDocs.set(row.path, next);
    return;
  }

  await ensureCompatSchema(db);
  await db.prepare(`
    INSERT INTO ${FIRESTORE_COMPAT_TABLE} (path, collection_path, doc_id, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      collection_path = excluded.collection_path,
      doc_id = excluded.doc_id,
      payload_json = excluded.payload_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).bind(
    next.path,
    next.collectionPath,
    next.docId,
    next.payloadJson,
    next.createdAt,
    next.updatedAt,
  ).run();
};

const deleteCompatRow = async (path: string): Promise<void> => {
  const db = await getCompatDb();
  if (!db) {
    memoryDocs.delete(path);
    return;
  }
  await ensureCompatSchema(db);
  await db.prepare(`DELETE FROM ${FIRESTORE_COMPAT_TABLE} WHERE path = ?`).bind(path).run();
};

const createSnapshot = (ref: FirestoreLikeDocument, row: CompatDocRow | null): FirestoreLikeDocumentSnapshot => {
  const data = row ? (JSON.parse(row.payloadJson) as Record<string, unknown>) : undefined;
  return {
    id: ref.id,
    exists: Boolean(row),
    ref,
    data: () => data,
    get: (field: string) => (data && typeof data === 'object' ? data[field] : undefined),
  };
};

const applyQuery = async (
  collectionPath: string,
  filters: Array<{ field: string; value: unknown }>,
  orderBy?: { field: string; direction: 'asc' | 'desc' },
  limitCount?: number,
): Promise<FirestoreLikeDocumentSnapshot[]> => {
  const rows = await listCompatRows(collectionPath);
  const records = rows
    .map((row) => {
      const ref = makeDocumentRef(collectionPath, row.docId, null as unknown as FirestoreLikeDb);
      return createSnapshot(ref, row);
    })
    .filter((snapshot) => filters.every((filter) => {
      const payload = snapshot.data() || {};
      return payload[filter.field] === filter.value;
    }))
    .sort((left, right) => {
      if (!orderBy) return 0;
      const leftValue = left.data()?.[orderBy.field];
      const rightValue = right.data()?.[orderBy.field];
      const leftString = String(leftValue ?? '');
      const rightString = String(rightValue ?? '');
      if (leftString === rightString) return 0;
      const comparison = leftString < rightString ? -1 : 1;
      return orderBy.direction === 'desc' ? -comparison : comparison;
    });

  return typeof limitCount === 'number' && limitCount >= 0 ? records.slice(0, limitCount) : records;
};

const makeDocumentRef = (collectionPath: string, docId: string, firestore: FirestoreLikeDb): FirestoreLikeDocument => {
  const path = normalizePath(collectionPath, docId || randomUUID());
  const resolvedDocId = String(docId || path.split('/').pop() || '').trim();
  return {
    id: resolvedDocId,
    path,
    parent: makeCollectionRef(collectionPath, firestore, null),
    firestore,
    withConverter: () => makeDocumentRef(collectionPath, resolvedDocId, firestore),
    get: async () => createSnapshot(makeDocumentRef(collectionPath, resolvedDocId, firestore), await readCompatRow(path)),
    set: async (data, options) => {
      const existing = await readCompatRow(path);
      const payload = options?.merge && existing
        ? { ...(existing.payloadJson ? JSON.parse(existing.payloadJson) : {}), ...data }
        : data;
      await writeCompatRow({
        path,
        collectionPath,
        docId: resolvedDocId,
        payloadJson: JSON.stringify(payload ?? {}),
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso(),
      }, false);
    },
    update: async (data) => {
      await writeCompatRow({
        path,
        collectionPath,
        docId: resolvedDocId,
        payloadJson: JSON.stringify(data ?? {}),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }, true);
    },
    delete: async () => deleteCompatRow(path),
    collection: (name: string) => makeCollectionRef(normalizePath(path, name), firestore, makeDocumentRef(collectionPath, resolvedDocId, firestore)),
  };
};

const makeCollectionRef = (collectionPath: string, firestore: FirestoreLikeDb, parent: FirestoreLikeDocument | null): FirestoreLikeCollection => {
  const path = String(collectionPath || '').trim();
  const queryState = {
    filters: [] as Array<{ field: string; value: unknown }>,
    orderBy: undefined as { field: string; direction: 'asc' | 'desc' } | undefined,
    limitCount: undefined as number | undefined,
  };

  const makeQuery = (): FirestoreLikeQuery => ({
    get: async () => {
      const docs = await applyQuery(path, queryState.filters, queryState.orderBy, queryState.limitCount);
      return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (callback) => docs.forEach(callback),
      };
    },
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') {
        throw new Error(`Unsupported compat query operator: ${op}`);
      }
      queryState.filters.push({ field, value });
      return makeQuery();
    },
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => {
      queryState.orderBy = { field, direction };
      return makeQuery();
    },
    limit: (count: number) => {
      queryState.limitCount = count;
      return makeQuery();
    },
  });

  return {
    id: path.split('/').pop() || path,
    path,
    parent,
    firestore,
    doc: (id?: string) => makeDocumentRef(path, String(id || randomUUID()), firestore),
    withConverter: () => makeCollectionRef(path, firestore, parent),
    ...makeQuery(),
  };
};

const makeFirestore = (): any => {
  const firestore: FirestoreLikeDb = {
    collection: (path: string) => makeCollectionRef(String(path || '').trim(), firestore, null),
    batch: (): FirestoreLikeBatch => {
      const ops: Array<() => Promise<void>> = [];
      const batch: FirestoreLikeBatch = {
        set: (ref, data, options) => {
          ops.push(() => ref.set(data, options));
          return batch;
        },
        delete: (ref) => {
          ops.push(() => ref.delete());
          return batch;
        },
        commit: async () => {
          for (const op of ops) {
            await op();
          }
        },
      };
      return batch;
    },
    runTransaction: async <T>(callback: (transaction: FirestoreLikeTransaction) => Promise<T>) => {
      const writes: Array<() => Promise<void>> = [];
      const transaction: FirestoreLikeTransaction = {
        get: async (ref) => ref.get(),
        set: (ref, data, options) => {
          writes.push(() => ref.set(data, options));
        },
        delete: (ref) => {
          writes.push(() => ref.delete());
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        await write();
      }
      return result;
    },
  };
  return firestore;
};

const authShim: any = {
  verifyIdToken: async (token: string) => {
    const context = await getD1AuthService().resolveSessionToken(String(token || '').trim());
    if (!context) {
      throw new Error('Invalid session token');
    }
    return context.decodedToken;
  },
  deleteUser: async () => undefined,
  updateUser: async () => undefined,
  revokeRefreshTokens: async () => undefined,
};

export const getFirebaseAdminApp = (): any => ({ __compat: true });

export const getFirebaseAdminAuth = (): any => authShim;

export const getFirebaseAdminFirestore = (): any => makeFirestore();
