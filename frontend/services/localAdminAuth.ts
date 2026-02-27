import { STORAGE_KEYS } from '../src/shared/storage/keys';

const LOCAL_ADMIN_SESSION_STORAGE_KEY = STORAGE_KEYS.localAdminSession;
const LOCAL_ADMIN_SESSION_SCHEMA_VERSION = 1;

const DEFAULT_LOCAL_ADMIN_USERNAME = 'admin';
const DEFAULT_LOCAL_ADMIN_UID = 'local_admin';
const DEFAULT_LOCAL_ADMIN_PBKDF2_ITERATIONS = 210000;
const DEFAULT_LOCAL_ADMIN_SESSION_TTL_MIN = 480;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface LocalAdminSessionPayload {
  uid: string;
  email: string;
  role: 'user';
  issuedAt: number;
  expiresAt: number;
  mode: 'local_admin';
}

interface LocalAdminSessionEnvelope {
  v: number;
  iv: string;
  ct: string;
}

const parsePositiveInt = (raw: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeBase64 = (raw: string): string => {
  const value = String(raw || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!value) return '';
  const padding = value.length % 4;
  if (padding === 0) return value;
  return `${value}${'='.repeat(4 - padding)}`;
};

const base64ToBytes = (raw: string): Uint8Array => {
  const normalized = normalizeBase64(raw);
  if (!normalized) return new Uint8Array(0);
  try {
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return globalThis.btoa(binary);
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
};

const getWebCrypto = (): Crypto | null => {
  const candidate = (globalThis as { crypto?: Crypto }).crypto;
  if (!candidate || !candidate.subtle) return null;
  return candidate;
};

const LOCAL_ADMIN_USERNAME =
  String(import.meta.env.VITE_LOCAL_ADMIN_USERNAME || DEFAULT_LOCAL_ADMIN_USERNAME)
    .trim()
    .toLowerCase() || DEFAULT_LOCAL_ADMIN_USERNAME;

const LOCAL_ADMIN_UID =
  String(import.meta.env.VITE_LOCAL_ADMIN_UID || DEFAULT_LOCAL_ADMIN_UID).trim() || DEFAULT_LOCAL_ADMIN_UID;

const LOCAL_ADMIN_EMAIL = `${LOCAL_ADMIN_USERNAME}@local.admin`;

const LOCAL_ADMIN_PBKDF2_ITERATIONS = parsePositiveInt(
  import.meta.env.VITE_LOCAL_ADMIN_PBKDF2_ITERATIONS,
  DEFAULT_LOCAL_ADMIN_PBKDF2_ITERATIONS
);

const LOCAL_ADMIN_SESSION_TTL_MIN = parsePositiveInt(
  import.meta.env.VITE_LOCAL_ADMIN_SESSION_TTL_MIN,
  DEFAULT_LOCAL_ADMIN_SESSION_TTL_MIN
);

const localAdminPasswordHashBytes = base64ToBytes(String(import.meta.env.VITE_LOCAL_ADMIN_PASSWORD_HASH_B64 || ''));
const localAdminPasswordSaltBytes = base64ToBytes(String(import.meta.env.VITE_LOCAL_ADMIN_PASSWORD_SALT_B64 || ''));
const localAdminSessionKeyBytes = base64ToBytes(String(import.meta.env.VITE_LOCAL_ADMIN_SESSION_KEY_B64 || ''));

const localAdminConfigIssue = (() => {
  const crypto = getWebCrypto();
  if (!crypto) return 'Web Crypto API is unavailable in this environment.';
  if (localAdminPasswordHashBytes.length === 0) return 'VITE_LOCAL_ADMIN_PASSWORD_HASH_B64 is missing or invalid.';
  if (localAdminPasswordSaltBytes.length === 0) return 'VITE_LOCAL_ADMIN_PASSWORD_SALT_B64 is missing or invalid.';
  if (localAdminSessionKeyBytes.length === 0) return 'VITE_LOCAL_ADMIN_SESSION_KEY_B64 is missing or invalid.';
  if (![16, 24, 32].includes(localAdminSessionKeyBytes.length)) {
    return 'VITE_LOCAL_ADMIN_SESSION_KEY_B64 must decode to 16, 24, or 32 bytes.';
  }
  return '';
})();

let sessionAesKeyPromise: Promise<CryptoKey | null> | null = null;

const getLocalAdminSessionKey = async (): Promise<CryptoKey | null> => {
  if (localAdminConfigIssue) return null;
  if (sessionAesKeyPromise) return sessionAesKeyPromise;
  const crypto = getWebCrypto();
  if (!crypto) return null;
  sessionAesKeyPromise = crypto.subtle
    .importKey('raw', localAdminSessionKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    .catch(() => null);
  return sessionAesKeyPromise;
};

const parseSessionEnvelope = (raw: string): LocalAdminSessionEnvelope | null => {
  try {
    const parsed = JSON.parse(raw) as LocalAdminSessionEnvelope | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== LOCAL_ADMIN_SESSION_SCHEMA_VERSION) return null;
    if (typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') return null;
    if (!parsed.iv.trim() || !parsed.ct.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
};

const isValidLocalAdminSession = (value: unknown): value is LocalAdminSessionPayload => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as LocalAdminSessionPayload;
  if (payload.mode !== 'local_admin') return false;
  if (payload.role !== 'user') return false;
  if (!String(payload.uid || '').trim()) return false;
  if (!String(payload.email || '').trim()) return false;
  if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt)) return false;
  if (payload.expiresAt <= payload.issuedAt) return false;
  return true;
};

export const getLocalAdminConfigIssue = (): string => localAdminConfigIssue;

export const isLocalAdminConfigured = (): boolean => !localAdminConfigIssue;

export const isLocalAdminUsername = (input: string): boolean => {
  const normalized = String(input || '').trim().toLowerCase();
  return Boolean(normalized) && normalized === LOCAL_ADMIN_USERNAME;
};

export const getLocalAdminUid = (): string => LOCAL_ADMIN_UID;

export const verifyLocalAdminPassword = async (password: string): Promise<boolean> => {
  if (localAdminConfigIssue) return false;
  const crypto = getWebCrypto();
  if (!crypto) return false;
  const rawPassword = String(password || '');
  if (!rawPassword) return false;
  try {
    const passwordMaterial = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(rawPassword),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: localAdminPasswordSaltBytes,
        iterations: LOCAL_ADMIN_PBKDF2_ITERATIONS,
      },
      passwordMaterial,
      localAdminPasswordHashBytes.length * 8
    );
    const derivedBytes = new Uint8Array(derivedBits);
    return timingSafeEqual(derivedBytes, localAdminPasswordHashBytes);
  } catch {
    return false;
  }
};

export const clearLocalAdminSession = (): void => {
  try {
    localStorage.removeItem(LOCAL_ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // no-op
  }
};

export const createLocalAdminSession = async (): Promise<LocalAdminSessionPayload | null> => {
  if (localAdminConfigIssue) return null;
  const crypto = getWebCrypto();
  if (!crypto) return null;
  const key = await getLocalAdminSessionKey();
  if (!key) return null;

  const now = Date.now();
  const payload: LocalAdminSessionPayload = {
    uid: LOCAL_ADMIN_UID,
    email: LOCAL_ADMIN_EMAIL,
    role: 'user',
    issuedAt: now,
    expiresAt: now + LOCAL_ADMIN_SESSION_TTL_MIN * 60 * 1000,
    mode: 'local_admin',
  };

  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = textEncoder.encode(JSON.stringify(payload));
    const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const envelope: LocalAdminSessionEnvelope = {
      v: LOCAL_ADMIN_SESSION_SCHEMA_VERSION,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(cipherBuffer)),
    };
    localStorage.setItem(LOCAL_ADMIN_SESSION_STORAGE_KEY, JSON.stringify(envelope));
    return payload;
  } catch {
    return null;
  }
};

export const readLocalAdminSession = async (): Promise<LocalAdminSessionPayload | null> => {
  if (localAdminConfigIssue) return null;
  const crypto = getWebCrypto();
  if (!crypto) return null;
  const key = await getLocalAdminSessionKey();
  if (!key) return null;

  let rawEnvelope = '';
  try {
    rawEnvelope = String(localStorage.getItem(LOCAL_ADMIN_SESSION_STORAGE_KEY) || '');
  } catch {
    return null;
  }
  if (!rawEnvelope.trim()) return null;

  const envelope = parseSessionEnvelope(rawEnvelope);
  if (!envelope) {
    clearLocalAdminSession();
    return null;
  }

  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  if (iv.length !== 12 || ct.length === 0) {
    clearLocalAdminSession();
    return null;
  }

  try {
    const plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    const parsed = JSON.parse(textDecoder.decode(plaintextBuffer)) as unknown;
    if (!isValidLocalAdminSession(parsed)) {
      clearLocalAdminSession();
      return null;
    }
    if (parsed.expiresAt <= Date.now()) {
      clearLocalAdminSession();
      return null;
    }
    return parsed;
  } catch {
    clearLocalAdminSession();
    return null;
  }
};
