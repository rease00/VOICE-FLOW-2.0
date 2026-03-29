import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isRuntimePollCoordinationAvailable,
  readRuntimePollLeaderLease,
  readRuntimePollSnapshot,
  releaseRuntimePollLeadership,
  renewRuntimePollLeadership,
  resetRuntimePollCoordinationAvailabilityForTests,
  RUNTIME_POLL_LEADER_KEY,
  RUNTIME_POLL_SNAPSHOT_KEY,
  tryAcquireRuntimePollLeadership,
  writeRuntimePollSnapshot,
} from '../src/shared/runtime/runtimePollCoordinator';

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
}

const originalWindow = (globalThis as any).window;

const createStorage = (): StorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? String(map.get(key)) : null),
    setItem: (key: string, value: string) => {
      map.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      map.delete(String(key));
    },
    clear: () => {
      map.clear();
    },
  };
};

const installWindow = (storage: StorageLike): void => {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });
};

const restoreWindow = (): void => {
  if (typeof originalWindow === 'undefined') {
    delete (globalThis as any).window;
    return;
  }
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
};

beforeEach(() => {
  resetRuntimePollCoordinationAvailabilityForTests();
  restoreWindow();
});

afterEach(() => {
  resetRuntimePollCoordinationAvailabilityForTests();
  restoreWindow();
});

describe('runtimePollCoordinator', () => {
  it('reports unavailable coordination when localStorage is missing', () => {
    delete (globalThis as any).window;
    expect(isRuntimePollCoordinationAvailable()).toBe(false);
  });

  it('acquires leadership, blocks followers, and allows takeover after expiry', () => {
    const storage = createStorage();
    installWindow(storage);

    expect(tryAcquireRuntimePollLeadership('tab-a', 1000, 20_000)).toBe(true);
    expect(tryAcquireRuntimePollLeadership('tab-b', 1500, 20_000)).toBe(false);

    const lease = readRuntimePollLeaderLease();
    expect(lease?.tabId).toBe('tab-a');
    expect(Number(lease?.expiresAtMs || 0)).toBe(21_000);

    expect(tryAcquireRuntimePollLeadership('tab-b', 21_001, 20_000)).toBe(true);
    expect(readRuntimePollLeaderLease()?.tabId).toBe('tab-b');
  });

  it('renews lease for the current leader', () => {
    const storage = createStorage();
    installWindow(storage);

    expect(tryAcquireRuntimePollLeadership('tab-a', 1000, 5000)).toBe(true);
    expect(renewRuntimePollLeadership('tab-a', 4000, 5000)).toBe(true);

    const lease = readRuntimePollLeaderLease();
    expect(Number(lease?.heartbeatAtMs || 0)).toBe(4000);
    expect(Number(lease?.expiresAtMs || 0)).toBe(9000);
  });

  it('releases lease only for the owning tab', () => {
    const storage = createStorage();
    installWindow(storage);

    expect(tryAcquireRuntimePollLeadership('tab-a', 1000, 20_000)).toBe(true);
    releaseRuntimePollLeadership('tab-b');
    expect(readRuntimePollLeaderLease()?.tabId).toBe('tab-a');

    releaseRuntimePollLeadership('tab-a');
    expect(readRuntimePollLeaderLease()).toBeNull();
  });

  it('writes and reads runtime snapshots', () => {
    const storage = createStorage();
    installWindow(storage);

    const payload = {
      PRIME: { state: 'online', detail: 'Runtime online' },
    };

    expect(writeRuntimePollSnapshot('tab-a', payload, 7777)).toBe(true);
    const snapshot = readRuntimePollSnapshot<typeof payload>();
    expect(snapshot?.tabId).toBe('tab-a');
    expect(snapshot?.createdAtMs).toBe(7777);
    expect(snapshot?.payload.PRIME.state).toBe('online');
  });

  it('returns unavailable when storage throws', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      clear: () => {},
    };
    installWindow(storage);

    expect(isRuntimePollCoordinationAvailable()).toBe(false);
  });

  it('uses shared storage keys consistently', () => {
    const storage = createStorage();
    installWindow(storage);

    tryAcquireRuntimePollLeadership('tab-a', 1000, 1000);
    writeRuntimePollSnapshot('tab-a', { PRIME: { state: 'online', detail: 'ok' } }, 1200);

    expect(storage.getItem(RUNTIME_POLL_LEADER_KEY)).toBeTruthy();
    expect(storage.getItem(RUNTIME_POLL_SNAPSHOT_KEY)).toBeTruthy();
  });
});

