import { getCloudflareContext } from '@opennextjs/cloudflare';

import { getFirebaseAdminFirestore } from '../firebaseAdmin';

const READER_LEGAL_ACK_COLLECTION = 'reader_legal_ack';
const READER_LEGAL_ACK_D1_TABLE = 'reader_legal_ack';
const memoryReaderLegalAck = new Map<string, ReaderLegalAckRecord>();

type ReaderLegalAckD1Statement = {
  bind: (...values: unknown[]) => ReaderLegalAckD1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type ReaderLegalAckD1Database = {
  prepare: (sql: string) => ReaderLegalAckD1Statement;
  exec: (sql: string) => Promise<unknown>;
};

let readerLegalAckD1DatabasePromise: Promise<ReaderLegalAckD1Database | null> | null = null;
let readerLegalAckD1SchemaPromise: Promise<void> | null = null;

export const READER_BILLING_VF_PER_CHAR = 0.5;

export interface ReaderLegalAckRecord {
  uid: string;
  accepted: boolean;
  updatedAt: string;
  acceptedAt: string;
}

const getFirestoreHandle = () => {
  try {
    return getFirebaseAdminFirestore();
  } catch {
    return null;
  }
};

const parsePersistedJsonRecord = (value: string | null | undefined): Record<string, unknown> | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const emptyAck = (uid: string): ReaderLegalAckRecord => ({
  uid,
  accepted: false,
  updatedAt: '',
  acceptedAt: '',
});

const getReaderLegalAckD1Database = async (): Promise<ReaderLegalAckD1Database | null> => {
  if (!readerLegalAckD1DatabasePromise) {
    readerLegalAckD1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: ReaderLegalAckD1Database }).DB;
        return db && typeof db.prepare === 'function' ? db : null;
      } catch {
        return null;
      }
    })();
  }
  return readerLegalAckD1DatabasePromise;
};

const ensureReaderLegalAckD1Schema = async (db: ReaderLegalAckD1Database): Promise<void> => {
  if (!readerLegalAckD1SchemaPromise) {
    readerLegalAckD1SchemaPromise = db.exec(`
CREATE TABLE IF NOT EXISTS ${READER_LEGAL_ACK_D1_TABLE} (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`).then(() => undefined).catch((error: unknown) => {
      readerLegalAckD1SchemaPromise = null;
      throw error;
    });
  }
  await readerLegalAckD1SchemaPromise;
};

const readReaderLegalAckD1Record = async (uid: string): Promise<Record<string, unknown> | null> => {
  const db = await getReaderLegalAckD1Database();
  if (!db) return null;
  await ensureReaderLegalAckD1Schema(db);
  const row = await db.prepare(`SELECT payload_json FROM ${READER_LEGAL_ACK_D1_TABLE} WHERE uid = ? LIMIT 1`)
    .bind(uid)
    .first<{ payload_json?: string }>();
  return parsePersistedJsonRecord(row?.payload_json || null);
};

const writeReaderLegalAckD1Record = async (record: ReaderLegalAckRecord): Promise<void> => {
  const db = await getReaderLegalAckD1Database();
  if (!db) return;
  await ensureReaderLegalAckD1Schema(db);
  await db.prepare(`
    INSERT INTO ${READER_LEGAL_ACK_D1_TABLE} (uid, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `)
    .bind(record.uid, JSON.stringify(record), record.updatedAt)
    .run();
};

const deleteReaderLegalAckD1Record = async (uid: string): Promise<number> => {
  const db = await getReaderLegalAckD1Database();
  if (!db) return 0;
  await ensureReaderLegalAckD1Schema(db);
  const existing = await readReaderLegalAckD1Record(uid);
  await db.prepare(`DELETE FROM ${READER_LEGAL_ACK_D1_TABLE} WHERE uid = ?`)
    .bind(uid)
    .run();
  return existing ? 1 : 0;
};

export const getReaderLegalAck = async (uid: string): Promise<ReaderLegalAckRecord> => {
  const safeUid = String(uid || '').trim();
  if (!safeUid) {
    return emptyAck('');
  }

  const d1Record = await readReaderLegalAckD1Record(safeUid);
  if (d1Record) {
    const record = {
      uid: safeUid,
      accepted: Boolean(d1Record.accepted),
      updatedAt: String(d1Record.updatedAt || ''),
      acceptedAt: String(d1Record.acceptedAt || ''),
    };
    const firestore = getFirestoreHandle();
    if (firestore) {
      await firestore.collection(READER_LEGAL_ACK_COLLECTION).doc(safeUid).set(record, { merge: true });
    }
    memoryReaderLegalAck.set(safeUid, record);
    return record;
  }

  const firestore = getFirestoreHandle();
  if (firestore) {
    const snapshot = await firestore.collection(READER_LEGAL_ACK_COLLECTION).doc(safeUid).get();
    if (!snapshot.exists) {
      return memoryReaderLegalAck.get(safeUid) || emptyAck(safeUid);
    }

    const payload = snapshot.data() as Partial<ReaderLegalAckRecord> | undefined;
    const record = {
      uid: safeUid,
      accepted: Boolean(payload?.accepted),
      updatedAt: String(payload?.updatedAt || ''),
      acceptedAt: String(payload?.acceptedAt || ''),
    };
    await writeReaderLegalAckD1Record(record);
    memoryReaderLegalAck.set(safeUid, record);
    return record;
  }

  return memoryReaderLegalAck.get(safeUid) || emptyAck(safeUid);
};

export const setReaderLegalAck = async (uid: string, accepted: boolean): Promise<ReaderLegalAckRecord> => {
  const safeUid = String(uid || '').trim();
  const nowIso = new Date().toISOString();
  const payload: ReaderLegalAckRecord = {
    uid: safeUid,
    accepted: Boolean(accepted),
    updatedAt: nowIso,
    acceptedAt: accepted ? nowIso : '',
  };

  await writeReaderLegalAckD1Record(payload);
  const firestore = getFirestoreHandle();
  if (!firestore) {
    memoryReaderLegalAck.set(safeUid, payload);
    return payload;
  }

  await firestore.collection(READER_LEGAL_ACK_COLLECTION).doc(safeUid).set(payload, { merge: true });
  memoryReaderLegalAck.set(safeUid, payload);
  return payload;
};

export const deleteReaderLegalAck = async (uid: string): Promise<number> => {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return 0;
  const firestore = getFirestoreHandle();
  if (firestore) {
    await firestore.collection(READER_LEGAL_ACK_COLLECTION).doc(safeUid).delete().catch(() => undefined);
  }
  memoryReaderLegalAck.delete(safeUid);
  return deleteReaderLegalAckD1Record(safeUid);
};

export const buildReaderLegalAckEnvelope = (ack: ReaderLegalAckRecord) => ({
  ok: true,
  ack: {
    accepted: Boolean(ack.accepted),
    acceptedAt: String(ack.acceptedAt || ''),
    title: 'VoiceFlow Reader upload rights',
    message: 'Upload only work you created, have permission to use, or that is openly licensed. VoiceFlow does not claim ownership of your files, and you remain responsible for rights and misuse.',
  },
  billing: {
    vfPerChar: READER_BILLING_VF_PER_CHAR,
    rule: '1 char = 0.5 VF',
    label: 'Reader pricing: 1 char = 0.5 VF',
  },
});
