import { getCloudflareContext } from '@opennextjs/cloudflare';

const DOMAIN_JOB_D1_TABLE = 'domain_jobs';
const memoryDomainJobs = new Map<string, DomainJobRecord<any, any, any>>();

type DomainJobD1Statement = {
  bind: (...values: unknown[]) => DomainJobD1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type DomainJobD1Database = {
  prepare: (sql: string) => DomainJobD1Statement;
  exec: (sql: string) => Promise<unknown>;
};

let d1DatabasePromise: Promise<DomainJobD1Database | null> | null = null;
let d1SchemaPromise: Promise<void> | null = null;

const getD1Database = async (): Promise<DomainJobD1Database | null> => {
  if (!d1DatabasePromise) {
    d1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: DomainJobD1Database }).DB;
        return db && typeof db.prepare === 'function' ? db : null;
      } catch {
        return null;
      }
    })();
  }
  return d1DatabasePromise;
};

const ensureD1Schema = async (db: DomainJobD1Database): Promise<void> => {
  if (!d1SchemaPromise) {
    d1SchemaPromise = db.exec(`
CREATE TABLE IF NOT EXISTS domain_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS domain_jobs_uid_idx ON domain_jobs(uid);
`).then(() => undefined).catch((error: unknown) => {
      d1SchemaPromise = null;
      throw error;
    });
  }
  await d1SchemaPromise;
};

const parsePayloadJson = (value: string | null | undefined): Record<string, unknown> | null => {
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

const readD1DomainJob = async (id: string): Promise<DomainJobRecord | null> => {
  const db = await getD1Database();
  if (!db) return null;
  await ensureD1Schema(db);
  const row = await db.prepare(`SELECT payload_json FROM ${DOMAIN_JOB_D1_TABLE} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ payload_json?: string }>();
  const parsed = parsePayloadJson(row?.payload_json || null);
  return parsed ? parsed as unknown as DomainJobRecord : null;
};

const writeD1DomainJob = async (record: DomainJobRecord): Promise<void> => {
  const db = await getD1Database();
  if (!db) return;
  await ensureD1Schema(db);
  await db.prepare(`
    INSERT INTO ${DOMAIN_JOB_D1_TABLE} (id, uid, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      uid = excluded.uid,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `)
    .bind(record.id, record.ownerUid || '', JSON.stringify(record), record.createdAt, record.updatedAt)
    .run();
};

const deleteD1DomainJob = async (id: string): Promise<void> => {
  const db = await getD1Database();
  if (!db) return;
  await ensureD1Schema(db);
  await db.prepare(`DELETE FROM ${DOMAIN_JOB_D1_TABLE} WHERE id = ?`)
    .bind(id)
    .run();
};

const listD1DomainJobsForUid = async (uid: string): Promise<DomainJobRecord[]> => {
  const db = await getD1Database();
  if (!db) return [];
  await ensureD1Schema(db);
  const response = await db.prepare(`SELECT payload_json FROM ${DOMAIN_JOB_D1_TABLE} WHERE uid = ? ORDER BY created_at DESC`)
    .bind(uid)
    .all<{ payload_json?: string }>();
  if (!Array.isArray(response?.results)) return [];
  return response.results
    .map(row => parsePayloadJson(row?.payload_json || null))
    .filter((r): r is Record<string, unknown> => r !== null)
    .map(r => r as unknown as DomainJobRecord);
};

const listAllD1DomainJobs = async (): Promise<DomainJobRecord[]> => {
  const db = await getD1Database();
  if (!db) return [];
  await ensureD1Schema(db);
  const response = await db.prepare(`SELECT payload_json FROM ${DOMAIN_JOB_D1_TABLE} ORDER BY created_at DESC`)
    .all<{ payload_json?: string }>();
  if (!Array.isArray(response?.results)) return [];
  return response.results
    .map(row => parsePayloadJson(row?.payload_json || null))
    .filter((r): r is Record<string, unknown> => r !== null)
    .map(r => r as unknown as DomainJobRecord);
};

const countD1DomainJobs = async (days: number): Promise<number> => {
  const db = await getD1Database();
  if (!db) return 0;
  await ensureD1Schema(db);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const row = await db.prepare(`SELECT COUNT(*) as cnt FROM ${DOMAIN_JOB_D1_TABLE} WHERE created_at >= ?`)
    .bind(since)
    .first<{ cnt?: number }>();
  return typeof row?.cnt === 'number' ? row.cnt : 0;
};

type NativeDomainJobStoreAdapter = {
  getRecord: (id: string) => Promise<DomainJobRecord | null> | DomainJobRecord | null;
  saveRecord: (record: DomainJobRecord) => Promise<DomainJobRecord> | DomainJobRecord;
  createRecordIfAbsent: (
    record: DomainJobRecord,
  ) => Promise<{ record: DomainJobRecord; created: boolean }> | { record: DomainJobRecord; created: boolean };
};

type RuntimeBindings = {
  domainJobStore?: NativeDomainJobStoreAdapter | null;
};

export type DomainJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DomainJobRecord<TPayload = Record<string, unknown>, TResult = Record<string, unknown>, TProgress = Record<string, unknown>> {
  id: string;
  domain: string;
  status: DomainJobStatus;
  ownerUid?: string | undefined;
  payload?: TPayload | undefined;
  progress?: TProgress | undefined;
  result?: TResult | undefined;
  error?: string | undefined;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  cancelledAt?: string | undefined;
}

const getRuntimeBindings = (): RuntimeBindings | null => {
  const bindings = (globalThis as Record<string, unknown>).__vfRuntimeBindings;
  if (!bindings || typeof bindings !== 'object') {
    return null;
  }

  return bindings as RuntimeBindings;
};

const resolveNativeDomainJobStore = (): NativeDomainJobStoreAdapter | null => {
  const store = getRuntimeBindings()?.domainJobStore;
  if (!store || typeof store !== 'object') {
    return null;
  }

  if (
    typeof store.getRecord !== 'function'
    || typeof store.saveRecord !== 'function'
    || typeof store.createRecordIfAbsent !== 'function'
  ) {
    return null;
  }

  return store;
};

const isDomainJobRecordLike = (value: unknown): value is DomainJobRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<DomainJobRecord>;
  return Boolean(
    typeof record.id === 'string'
    && typeof record.domain === 'string'
    && typeof record.status === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string',
  );
};

const isCreateRecordResultLike = (value: unknown): value is { record: DomainJobRecord; created: boolean } => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as { record?: unknown; created?: unknown };
  return Boolean(isDomainJobRecordLike(result.record) && typeof result.created === 'boolean');
};

const normalizeJobRecord = <TPayload = Record<string, unknown>, TResult = Record<string, unknown>, TProgress = Record<string, unknown>>(
  record: DomainJobRecord<TPayload, TResult, TProgress>,
): DomainJobRecord<TPayload, TResult, TProgress> => ({
  ...record,
  id: String(record.id || '').trim(),
  domain: String(record.domain || '').trim(),
  updatedAt: record.updatedAt || new Date().toISOString(),
});

const readLegacyDomainJobRecord = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(safeId: string): Promise<DomainJobRecord<TPayload, TResult, TProgress> | null> => {
  const d1Record = await readD1DomainJob(safeId);
  if (d1Record) {
    memoryDomainJobs.set(safeId, d1Record);
    return d1Record as DomainJobRecord<TPayload, TResult, TProgress>;
  }

  return (memoryDomainJobs.get(safeId) as DomainJobRecord<TPayload, TResult, TProgress> | undefined) || null;
};

const saveLegacyDomainJobRecord = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(safeRecord: DomainJobRecord<TPayload, TResult, TProgress>): Promise<DomainJobRecord<TPayload, TResult, TProgress>> => {
  await writeD1DomainJob(safeRecord as DomainJobRecord);
  memoryDomainJobs.set(safeRecord.id, safeRecord);
  return safeRecord;
};

const createLegacyDomainJobRecordIfAbsent = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(safeRecord: DomainJobRecord<TPayload, TResult, TProgress>): Promise<{
  record: DomainJobRecord<TPayload, TResult, TProgress>;
  created: boolean;
}> => {
  const existing = memoryDomainJobs.get(safeRecord.id) as DomainJobRecord<TPayload, TResult, TProgress> | undefined;
  if (existing) {
    return { record: existing, created: false };
  }

  const d1Existing = await readD1DomainJob(safeRecord.id);
  if (d1Existing) {
    memoryDomainJobs.set(safeRecord.id, d1Existing);
    return { record: d1Existing as DomainJobRecord<TPayload, TResult, TProgress>, created: false };
  }

  await writeD1DomainJob(safeRecord as DomainJobRecord);
  memoryDomainJobs.set(safeRecord.id, safeRecord);
  return { record: safeRecord, created: true };
};

export const createDomainJobRecord = <TPayload = Record<string, unknown>>(
  input: {
    id: string;
    domain: string;
    ownerUid?: string | undefined;
    payload?: TPayload | undefined;
  }
): DomainJobRecord<TPayload> => {
  const now = new Date().toISOString();
  return {
    id: String(input.id || '').trim(),
    domain: String(input.domain || '').trim(),
    status: 'queued',
    ...(input.ownerUid ? { ownerUid: String(input.ownerUid).trim() } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    createdAt: now,
    updatedAt: now,
  };
};

export const getDomainJobRecord = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(id: string): Promise<DomainJobRecord<TPayload, TResult, TProgress> | null> => {
  const safeId = String(id || '').trim();
  if (!safeId) return null;

  const nativeStore = resolveNativeDomainJobStore();
  if (nativeStore) {
    try {
      const nativeRecord = await nativeStore.getRecord(safeId);
      if (nativeRecord == null) {
        return readLegacyDomainJobRecord(safeId);
      }
      if (isDomainJobRecordLike(nativeRecord)) {
        return nativeRecord as DomainJobRecord<TPayload, TResult, TProgress>;
      }
    } catch {
      // Fall through to the legacy store.
    }
  }

  return readLegacyDomainJobRecord(safeId);
};

export const saveDomainJobRecord = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(record: DomainJobRecord<TPayload, TResult, TProgress>): Promise<DomainJobRecord<TPayload, TResult, TProgress>> => {
  const safeRecord = normalizeJobRecord(record);

  const nativeStore = resolveNativeDomainJobStore();
  if (nativeStore) {
    try {
      const nativeRecord = await nativeStore.saveRecord(safeRecord as DomainJobRecord);
      if (isDomainJobRecordLike(nativeRecord)) {
        return nativeRecord as DomainJobRecord<TPayload, TResult, TProgress>;
      }
    } catch {
      // Fall through to the legacy store.
    }
  }

  return saveLegacyDomainJobRecord(safeRecord);
};

export const createDomainJobRecordIfAbsent = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(record: DomainJobRecord<TPayload, TResult, TProgress>): Promise<{
  record: DomainJobRecord<TPayload, TResult, TProgress>;
  created: boolean;
}> => {
  const safeRecord = normalizeJobRecord(record);

  const nativeStore = resolveNativeDomainJobStore();
  if (nativeStore) {
    try {
      const result = await nativeStore.createRecordIfAbsent(safeRecord as DomainJobRecord);
      if (isCreateRecordResultLike(result)) {
        return result as { record: DomainJobRecord<TPayload, TResult, TProgress>; created: boolean };
      }
    } catch {
      // Fall through to the legacy store.
    }
  }

  return createLegacyDomainJobRecordIfAbsent(safeRecord);
};

export const createDomainJob = async <TPayload = Record<string, unknown>>(
  input: {
    id: string;
    domain: string;
    ownerUid?: string | undefined;
    payload?: TPayload | undefined;
  }
): Promise<DomainJobRecord<TPayload>> => {
  const record = createDomainJobRecord<TPayload>(input);
  await writeD1DomainJob(record as DomainJobRecord);
  memoryDomainJobs.set(record.id, record);
  return record;
};

export const getDomainJob = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(jobId: string): Promise<DomainJobRecord<TPayload, TResult, TProgress> | null> => {
  const safeId = String(jobId || '').trim();
  if (!safeId) return null;

  const d1Record = await readD1DomainJob(safeId);
  if (d1Record) {
    memoryDomainJobs.set(safeId, d1Record);
    return d1Record as DomainJobRecord<TPayload, TResult, TProgress>;
  }

  return (memoryDomainJobs.get(safeId) as DomainJobRecord<TPayload, TResult, TProgress> | undefined) || null;
};

export const updateDomainJob = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(
  jobId: string,
  patch: Partial<DomainJobRecord<TPayload, TResult, TProgress>>,
): Promise<DomainJobRecord<TPayload, TResult, TProgress> | null> => {
  const safeId = String(jobId || '').trim();
  if (!safeId) return null;

  const existing = await getDomainJob<TPayload, TResult, TProgress>(safeId);
  if (!existing) return null;

  const updated: DomainJobRecord<TPayload, TResult, TProgress> = {
    ...existing,
    ...patch,
    id: safeId,
    updatedAt: new Date().toISOString(),
  };

  await writeD1DomainJob(updated as DomainJobRecord);
  memoryDomainJobs.set(safeId, updated);
  return updated;
};

export const deleteDomainJob = async (jobId: string): Promise<boolean> => {
  const safeId = String(jobId || '').trim();
  if (!safeId) return false;

  await deleteD1DomainJob(safeId);
  return memoryDomainJobs.delete(safeId);
};

export const listDomainJobs = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(ownerUid: string): Promise<DomainJobRecord<TPayload, TResult, TProgress>[]> => {
  const safeUid = String(ownerUid || '').trim();

  const d1Records = await listD1DomainJobsForUid(safeUid);
  if (d1Records.length > 0) {
    for (const rec of d1Records) {
      memoryDomainJobs.set(rec.id, rec);
    }
    return d1Records as DomainJobRecord<TPayload, TResult, TProgress>[];
  }

  return Array.from(memoryDomainJobs.values())
    .filter(rec => rec.ownerUid === safeUid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) as DomainJobRecord<TPayload, TResult, TProgress>[];
};

export const getAllDomainJobs = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(): Promise<DomainJobRecord<TPayload, TResult, TProgress>[]> => {
  const d1Records = await listAllD1DomainJobs();
  if (d1Records.length > 0) {
    for (const rec of d1Records) {
      memoryDomainJobs.set(rec.id, rec);
    }
    return d1Records as DomainJobRecord<TPayload, TResult, TProgress>[];
  }

  return Array.from(memoryDomainJobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) as DomainJobRecord<TPayload, TResult, TProgress>[];
};

export const countDomainJobs = async (days: number): Promise<number> => {
  const safeDays = Math.max(0, typeof days === 'number' ? Math.floor(days) : 0);

  const d1Count = await countD1DomainJobs(safeDays);
  if (d1Count > 0) return d1Count;

  if (safeDays === 0) return memoryDomainJobs.size;

  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  let count = 0;
  for (const rec of memoryDomainJobs.values()) {
    if (rec.createdAt >= since) count++;
  }
  return count;
};
