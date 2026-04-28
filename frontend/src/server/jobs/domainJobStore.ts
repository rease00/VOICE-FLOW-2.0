import { getFirebaseAdminFirestore } from '../firebaseAdmin.ts';

const DEFAULT_DOMAIN_JOB_COLLECTION = 'domainJobs';
const memoryDomainJobs = new Map<string, DomainJobRecord<any, any, any>>();

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

const getJobCollectionName = (): string => {
  return String(process.env.VF_DOMAIN_JOB_COLLECTION || DEFAULT_DOMAIN_JOB_COLLECTION).trim()
    || DEFAULT_DOMAIN_JOB_COLLECTION;
};

const getFirestoreHandle = () => {
  try {
    return getFirebaseAdminFirestore();
  } catch {
    return null;
  }
};

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

const normalizeJobRecord = <TPayload = Record<string, unknown>, TResult = Record<string, unknown>, TProgress = Record<string, unknown>>(
  record: DomainJobRecord<TPayload, TResult, TProgress>,
): DomainJobRecord<TPayload, TResult, TProgress> => ({
  ...record,
  id: String(record.id || '').trim(),
  domain: String(record.domain || '').trim(),
  updatedAt: record.updatedAt || new Date().toISOString(),
});

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
    return (await nativeStore.getRecord(safeId) as DomainJobRecord<TPayload, TResult, TProgress> | null) || null;
  }

  const firestore = getFirestoreHandle();
  if (!firestore) {
    return (memoryDomainJobs.get(safeId) as DomainJobRecord<TPayload, TResult, TProgress> | undefined) || null;
  }

  const snapshot = await firestore.collection(getJobCollectionName()).doc(safeId).get();
  if (!snapshot.exists) {
    return null;
  }
  return (snapshot.data() as DomainJobRecord<TPayload, TResult, TProgress> | undefined) || null;
};

export const saveDomainJobRecord = async <
  TPayload = Record<string, unknown>,
  TResult = Record<string, unknown>,
  TProgress = Record<string, unknown>,
>(record: DomainJobRecord<TPayload, TResult, TProgress>): Promise<DomainJobRecord<TPayload, TResult, TProgress>> => {
  const safeRecord = normalizeJobRecord(record);

  const nativeStore = resolveNativeDomainJobStore();
  if (nativeStore) {
    return (await nativeStore.saveRecord(safeRecord as DomainJobRecord) as DomainJobRecord<TPayload, TResult, TProgress>) || safeRecord;
  }

  const firestore = getFirestoreHandle();
  if (!firestore) {
    memoryDomainJobs.set(safeRecord.id, safeRecord);
    return safeRecord;
  }

  await firestore.collection(getJobCollectionName()).doc(safeRecord.id).set(safeRecord, { merge: true });
  return safeRecord;
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
    const result = await nativeStore.createRecordIfAbsent(safeRecord as DomainJobRecord);
    return (result as { record: DomainJobRecord<TPayload, TResult, TProgress>; created: boolean }) || {
      record: safeRecord,
      created: true,
    };
  }

  const firestore = getFirestoreHandle();
  if (!firestore) {
    const existing = memoryDomainJobs.get(safeRecord.id) as DomainJobRecord<TPayload, TResult, TProgress> | undefined;
    if (existing) {
      return { record: existing, created: false };
    }
    memoryDomainJobs.set(safeRecord.id, safeRecord);
    return { record: safeRecord, created: true };
  }

  const docRef = firestore.collection(getJobCollectionName()).doc(safeRecord.id);
  let created = false;
  let resolvedRecord: DomainJobRecord<TPayload, TResult, TProgress> = safeRecord;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (snapshot.exists) {
      resolvedRecord = (snapshot.data() as DomainJobRecord<TPayload, TResult, TProgress> | undefined) || safeRecord;
      created = false;
      return;
    }
    transaction.set(docRef, safeRecord, { merge: false });
    resolvedRecord = safeRecord;
    created = true;
  });

  return { record: resolvedRecord, created };
};
