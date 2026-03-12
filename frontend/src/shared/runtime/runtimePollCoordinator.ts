export interface RuntimePollLeaderLease {
  tabId: string;
  expiresAtMs: number;
  heartbeatAtMs: number;
}

export interface RuntimePollSnapshot<TPayload> {
  tabId: string;
  createdAtMs: number;
  payload: TPayload;
}

export const RUNTIME_POLL_LEADER_KEY = 'vf-runtime-poll-leader-v1';
export const RUNTIME_POLL_SNAPSHOT_KEY = 'vf-runtime-poll-snapshot-v1';
const RUNTIME_POLL_COORDINATION_PROBE_KEY = 'vf-runtime-poll-coordination-probe-v1';

let runtimePollCoordinationAvailableCache: boolean | null = null;

const readStorage = (key: string): string => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return String(window.localStorage.getItem(key) || '');
  } catch {
    return '';
  }
};

const writeStorage = (key: string, value: string): boolean => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const removeStorage = (key: string): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    // no-op
  }
};

const parseJson = <T>(raw: string): T | null => {
  const safeRaw = String(raw || '').trim();
  if (!safeRaw) return null;
  try {
    return JSON.parse(safeRaw) as T;
  } catch {
    return null;
  }
};

export const createRuntimePollTabId = (): string =>
  `vf-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const resetRuntimePollCoordinationAvailabilityForTests = (): void => {
  runtimePollCoordinationAvailableCache = null;
};

export const isRuntimePollCoordinationAvailable = (): boolean => {
  if (runtimePollCoordinationAvailableCache !== null) {
    return runtimePollCoordinationAvailableCache;
  }
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      runtimePollCoordinationAvailableCache = false;
      return false;
    }
    window.localStorage.setItem(RUNTIME_POLL_COORDINATION_PROBE_KEY, '1');
    window.localStorage.removeItem(RUNTIME_POLL_COORDINATION_PROBE_KEY);
    runtimePollCoordinationAvailableCache = true;
    return true;
  } catch {
    runtimePollCoordinationAvailableCache = false;
    return false;
  }
};

export const readRuntimePollLeaderLease = (): RuntimePollLeaderLease | null =>
  parseJson<RuntimePollLeaderLease>(readStorage(RUNTIME_POLL_LEADER_KEY));

export const tryAcquireRuntimePollLeadership = (
  tabId: string,
  nowMs: number,
  leaseMs: number
): boolean => {
  const safeTabId = String(tabId || '').trim();
  if (!safeTabId) return false;
  const safeNow = Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : Date.now();
  const safeLeaseMs = Number.isFinite(leaseMs) ? Math.max(1000, Math.floor(leaseMs)) : 20000;
  const current = readRuntimePollLeaderLease();
  const canTake =
    !current ||
    !current.tabId ||
    current.tabId === safeTabId ||
    Number(current.expiresAtMs || 0) <= safeNow;
  if (!canTake) return false;
  const next: RuntimePollLeaderLease = {
    tabId: safeTabId,
    heartbeatAtMs: safeNow,
    expiresAtMs: safeNow + safeLeaseMs,
  };
  return writeStorage(RUNTIME_POLL_LEADER_KEY, JSON.stringify(next));
};

export const renewRuntimePollLeadership = (tabId: string, nowMs: number, leaseMs: number): boolean =>
  tryAcquireRuntimePollLeadership(tabId, nowMs, leaseMs);

export const releaseRuntimePollLeadership = (tabId: string): void => {
  const safeTabId = String(tabId || '').trim();
  const current = readRuntimePollLeaderLease();
  if (!current || !safeTabId || current.tabId !== safeTabId) return;
  removeStorage(RUNTIME_POLL_LEADER_KEY);
};

export const writeRuntimePollSnapshot = <TPayload>(
  tabId: string,
  payload: TPayload,
  createdAtMs: number = Date.now()
): boolean => {
  const safeTabId = String(tabId || '').trim();
  if (!safeTabId) return false;
  const safeCreatedAtMs = Number.isFinite(createdAtMs) ? Math.max(0, Math.floor(createdAtMs)) : Date.now();
  const snapshot: RuntimePollSnapshot<TPayload> = {
    tabId: safeTabId,
    createdAtMs: safeCreatedAtMs,
    payload,
  };
  return writeStorage(RUNTIME_POLL_SNAPSHOT_KEY, JSON.stringify(snapshot));
};

export const readRuntimePollSnapshot = <TPayload>(): RuntimePollSnapshot<TPayload> | null =>
  parseJson<RuntimePollSnapshot<TPayload>>(readStorage(RUNTIME_POLL_SNAPSHOT_KEY));
