import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const base64Of = (bytes: number[]): string => Buffer.from(Uint8Array.from(bytes)).toString('base64');

const createFakeLocalStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
};

describe('local admin auth', () => {
  let fakeLocalStorage: Storage;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DEV', 'true');
    vi.stubEnv('VITE_ENABLE_LOCAL_ADMIN_DEV_LOGIN', '1');
    vi.stubEnv('VITE_LOCAL_ADMIN_USERNAME', 'admin');
    vi.stubEnv('VITE_LOCAL_ADMIN_UID', 'local_admin');
    vi.stubEnv('VITE_ADMIN_LOGIN_EMAIL', 'admin@voiceflow.local');
    vi.stubEnv('VITE_LOCAL_ADMIN_PASSWORD_HASH_B64', base64Of([1, 2, 3, 4, 5, 6, 7, 8]));
    vi.stubEnv('VITE_LOCAL_ADMIN_PASSWORD_SALT_B64', base64Of([9, 10, 11, 12, 13, 14, 15, 16]));
    vi.stubEnv('VITE_LOCAL_ADMIN_SESSION_KEY_B64', base64Of(Array.from({ length: 32 }, (_, index) => index + 1)));
    fakeLocalStorage = createFakeLocalStorage();
    vi.stubGlobal('localStorage', fakeLocalStorage);
  });

  afterEach(() => {
    fakeLocalStorage?.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('accepts the local admin email alias and preserves it in the stored session', async () => {
    const {
      clearLocalAdminSession,
      createLocalAdminSession,
      isLocalAdminConfigured,
      isLocalAdminUsername,
      readLocalAdminSession,
    } = await import('../services/localAdminAuth');
    const { STORAGE_KEYS } = await import('../src/shared/storage/keys');

    expect(isLocalAdminConfigured()).toBe(true);
    expect(isLocalAdminUsername('admin')).toBe(true);
    expect(isLocalAdminUsername('admin@voiceflow.local')).toBe(true);
    expect(isLocalAdminUsername('Admin@VoiceFlow.Local')).toBe(true);
    expect(isLocalAdminUsername('user@voiceflow.local')).toBe(false);

    clearLocalAdminSession();
    const createdSession = await createLocalAdminSession('admin@voiceflow.local');
    expect(createdSession).not.toBeNull();
    expect(createdSession?.email).toBe('admin@voiceflow.local');
    expect(createdSession?.uid).toBe('local_admin');
    expect(fakeLocalStorage.getItem(STORAGE_KEYS.localAdminSession)).toContain('"v":1');

    const readBackSession = await readLocalAdminSession();
    expect(readBackSession).toMatchObject({
      uid: 'local_admin',
      email: 'admin@voiceflow.local',
      mode: 'local_admin',
    });
  });
});
