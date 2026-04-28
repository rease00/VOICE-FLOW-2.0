import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { readEnvBoolean, readEnvCsv, readEnvValue } from '../../shared/runtime/env.ts';

import type { ServerAuthedUserContext } from './requestAuth.ts';

const AUTH_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_PASSWORD_ITERATIONS = 210_000;
const AUTH_PASSWORD_ALGORITHM = 'sha256';
const AUTH_SESSION_HASH_PREFIX = 'sha256$';
const AUTH_PASSWORD_HASH_PREFIX = 'pbkdf2-sha256$';
const AUTH_SESSION_COOKIE_NAME = '__session';

type AuthDatabase = {
  prepare: (sql: string) => AuthStatement;
  exec: (sql: string) => Promise<unknown>;
};

type AuthStatement = {
  bind: (...values: unknown[]) => AuthStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type AuthUserRow = {
  uid: string;
  normalized_email: string;
  email: string;
  display_name: string | null;
  photo_url: string | null;
  email_verified: number | boolean | null;
  is_admin: number | boolean | null;
  role: string | null;
  roles_json: string | null;
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at: string;
};

type AuthSessionRow = {
  token_hash: string;
  uid: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  email_verified: number | boolean | null;
  is_admin: number | boolean | null;
  role: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
};

type AuthUserSnapshot = {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  role: string;
  roles: string[];
};

type D1AuthService = {
  ensureAdminSeeds: () => Promise<void>;
  loginWithEmailAndPassword: (email: string, password: string) => Promise<{
    uid: string;
    token: string;
    user: {
      email: string;
      displayName: string | null;
      photoURL: string | null;
      emailVerified: boolean;
    };
  }>;
  resolveSessionToken: (token: string) => Promise<ServerAuthedUserContext | null>;
  resolveRequestUser: (
    request: Request,
    options?: { preferCookie?: boolean },
  ) => Promise<ServerAuthedUserContext | null>;
  revokeSessionToken: (token: string) => Promise<boolean>;
};

class D1AuthError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'D1AuthError';
    this.code = code;
    this.status = status;
  }
}

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

export const normalizeAdminSeedEmails = (): string[] => {
  const values: string[] = [];
  const seen = new Set<string>();
  const sources = [
    readEnvValue(process.env.NEXT_PUBLIC_ADMIN_LOGIN_EMAIL),
    ...readEnvCsv(process.env.NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST),
    readEnvValue(process.env.VITE_ADMIN_LOGIN_EMAIL),
    ...readEnvCsv(process.env.VITE_ADMIN_EMAIL_ALLOWLIST),
  ];

  for (const source of sources) {
    const email = normalizeEmail(source);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    values.push(email);
  }

  return values;
};

const defaultSeedPassword = (): string =>
  readEnvValue(process.env.FIREBASE_SEED_ADMIN_PASSWORD, process.env.D1_AUTH_SEED_ADMIN_PASSWORD) || 'rease1999';

const createUserIdFromEmail = (email: string): string => {
  const normalizedEmail = normalizeEmail(email);
  const localPart = normalizedEmail.split('@')[0] || 'admin';
  const safeLocalPart = localPart
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'admin';
  const digest = createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 12);
  return `d1_${safeLocalPart.slice(0, 16)}_${digest}`;
};

const createDisplayNameFromEmail = (email: string): string => {
  const localPart = normalizeEmail(email).split('@')[0] || 'admin';
  const cleaned = localPart.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return 'Admin';
  return cleaned
    .split(/\s+/)
    .map((part) => part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
};

const createUserRefShim = (uid: string): DocumentReference<DocumentData> =>
  ({
    id: uid,
    path: `users/${uid}`,
    parent: null,
    firestore: null,
    converter: null,
    withConverter: () => createUserRefShim(uid),
  } as unknown as DocumentReference<DocumentData>);

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const toStringValue = (value: unknown): string => String(value ?? '').trim();

const parseRoles = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry)).filter(Boolean);
  }
  const raw = toStringValue(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => toStringValue(entry)).filter(Boolean);
    }
  } catch {
    // Ignore non-JSON role payloads.
  }
  return [raw].filter(Boolean);
};

const toAuthSnapshot = (row: AuthUserRow | AuthSessionRow, fallbackUid?: string): AuthUserSnapshot => {
  const uid = toStringValue((row as AuthUserRow).uid || fallbackUid);
  const email = toStringValue((row as AuthUserRow).email || (row as AuthSessionRow).email);
  const displayName = toStringValue((row as AuthUserRow).display_name || (row as AuthSessionRow).display_name) || null;
  const photoURL = toStringValue((row as AuthUserRow).photo_url || (row as AuthSessionRow).photo_url) || null;
  const emailVerified = toBoolean((row as AuthUserRow).email_verified ?? (row as AuthSessionRow).email_verified);
  const isAdmin = toBoolean((row as AuthUserRow).is_admin ?? (row as AuthSessionRow).is_admin);
  const role = toStringValue((row as AuthUserRow).role || (row as AuthSessionRow).role) || (isAdmin ? 'admin' : 'user');
  const roles = parseRoles((row as AuthUserRow).roles_json);
  return {
    uid,
    email,
    displayName,
    photoURL,
    emailVerified,
    isAdmin,
    role,
    roles: roles.length > 0 ? roles : [role],
  };
};

const buildDecodedToken = (snapshot: AuthUserSnapshot, sessionRow?: AuthSessionRow): DecodedIdToken => ({
  uid: snapshot.uid,
  email: snapshot.email || undefined,
  email_verified: snapshot.emailVerified,
  name: snapshot.displayName || undefined,
  picture: snapshot.photoURL || undefined,
  admin: snapshot.isAdmin,
  role: snapshot.role,
  roles: snapshot.roles,
  session_token_hash: sessionRow?.token_hash,
  auth_time: sessionRow?.created_at,
  iat: sessionRow?.created_at ? Math.floor(new Date(sessionRow.created_at).getTime() / 1000) : undefined,
  exp: sessionRow?.expires_at ? Math.floor(new Date(sessionRow.expires_at).getTime() / 1000) : undefined,
} as unknown as DecodedIdToken);

const AUTH_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS auth_users (
  uid TEXT PRIMARY KEY NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  roles_json TEXT NOT NULL DEFAULT '[]',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  email_verified INTEGER NOT NULL DEFAULT 1,
  is_admin INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (uid) REFERENCES auth_users(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_users_normalized_email_idx ON auth_users(normalized_email);
CREATE INDEX IF NOT EXISTS auth_sessions_uid_idx ON auth_sessions(uid);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);
`;

let d1DatabasePromise: Promise<AuthDatabase | null> | null = null;
let d1SchemaPromise: Promise<void> | null = null;

const getD1Database = async (): Promise<AuthDatabase | null> => {
  if (!d1DatabasePromise) {
    d1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const cloudflareEnv = env as {
          DB?: AuthDatabase;
          AUTH_DB?: AuthDatabase;
          D1_AUTH_DB?: AuthDatabase;
        };
        return cloudflareEnv.DB || cloudflareEnv.AUTH_DB || cloudflareEnv.D1_AUTH_DB || null;
      } catch {
        return null;
      }
    })();
  }

  return d1DatabasePromise;
};

const ensureSchema = async (db: AuthDatabase): Promise<void> => {
  if (!d1SchemaPromise) {
    d1SchemaPromise = db.exec(AUTH_SCHEMA).then(() => undefined).catch((error: unknown) => {
      d1SchemaPromise = null;
      throw error;
    });
  }
  await d1SchemaPromise;
};

const readAuthUserByEmail = async (db: AuthDatabase, email: string): Promise<AuthUserRow | null> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  await ensureSchema(db);
  return db.prepare(`
    SELECT *
    FROM auth_users
    WHERE normalized_email = ?
    LIMIT 1
  `).bind(normalizedEmail).first<AuthUserRow>();
};

const readAuthUserByUid = async (db: AuthDatabase, uid: string): Promise<AuthUserRow | null> => {
  const normalizedUid = toStringValue(uid);
  if (!normalizedUid) return null;
  await ensureSchema(db);
  return db.prepare(`
    SELECT *
    FROM auth_users
    WHERE uid = ?
    LIMIT 1
  `).bind(normalizedUid).first<AuthUserRow>();
};

const writeAuthUser = async (
  db: AuthDatabase,
  row: {
    uid: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
    emailVerified: boolean;
    isAdmin: boolean;
    role: string;
    roles: string[];
    passwordHash: string;
    passwordSalt: string;
  },
): Promise<void> => {
  const now = new Date().toISOString();
  await ensureSchema(db);
  await db.prepare(`
    INSERT INTO auth_users (
      uid,
      normalized_email,
      email,
      display_name,
      photo_url,
      email_verified,
      is_admin,
      role,
      roles_json,
      password_hash,
      password_salt,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.uid,
    normalizeEmail(row.email),
    normalizeEmail(row.email),
    row.displayName,
    row.photoURL,
    row.emailVerified ? 1 : 0,
    row.isAdmin ? 1 : 0,
    row.role,
    JSON.stringify(row.roles),
    row.passwordHash,
    row.passwordSalt,
    now,
    now,
  ).run();
};

const promoteExistingAdminSeed = async (db: AuthDatabase, existing: AuthUserRow, passwordHash: string): Promise<void> => {
  const now = new Date().toISOString();
  await ensureSchema(db);
  await db.prepare(`
    UPDATE auth_users
    SET
      uid = ?,
      email = ?,
      display_name = COALESCE(NULLIF(display_name, ''), ?),
      photo_url = COALESCE(NULLIF(photo_url, ''), ?),
      email_verified = 1,
      is_admin = 1,
      role = 'admin',
      roles_json = ?,
      updated_at = ?
    WHERE normalized_email = ?
  `).bind(
    existing.uid || createUserIdFromEmail(existing.email),
    normalizeEmail(existing.email),
    createDisplayNameFromEmail(existing.email),
    null,
    JSON.stringify(['admin']),
    now,
    normalizeEmail(existing.email),
  ).run();

  if (!toStringValue(existing.password_hash)) {
    await db.prepare(`
      UPDATE auth_users
      SET password_hash = ?, password_salt = ?, updated_at = ?
      WHERE normalized_email = ?
    `).bind(passwordHash, passwordHash.split('$')[2] || '', now, normalizeEmail(existing.email)).run();
  }
};

export const hashPasswordForStorage = (password: string, saltHex?: string, iterations = AUTH_PASSWORD_ITERATIONS): string => {
  const normalizedPassword = String(password || '');
  const safeSaltHex = toStringValue(saltHex) || randomBytes(16).toString('hex');
  const derivedKey = pbkdf2Sync(normalizedPassword, Buffer.from(safeSaltHex, 'hex'), iterations, 32, AUTH_PASSWORD_ALGORITHM).toString('hex');
  return `${AUTH_PASSWORD_HASH_PREFIX}${iterations}$${safeSaltHex}$${derivedKey}`;
};

export const verifyPasswordHash = (password: string, storedHash: string): boolean => {
  const [scheme, iterationsText, saltHex, hashHex] = String(storedHash || '').split('$');
  if (scheme !== 'pbkdf2-sha256' || !iterationsText || !saltHex || !hashHex) return false;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const expected = hashPasswordForStorage(password, saltHex, iterations);
  const expectedHashHex = expected.split('$')[3] || '';
  if (!expectedHashHex || expectedHashHex.length !== hashHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expectedHashHex, 'hex'), Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
};

export const hashSessionToken = (token: string): string =>
  `${AUTH_SESSION_HASH_PREFIX}${createHash('sha256').update(String(token || '')).digest('hex')}`;

const issueSessionForUser = async (db: AuthDatabase, user: AuthUserRow): Promise<string> => {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_MAX_AGE_MS);
  await ensureSchema(db);
  await db.prepare(`
    INSERT INTO auth_sessions (
      token_hash,
      uid,
      email,
      display_name,
      photo_url,
      email_verified,
      is_admin,
      role,
      created_at,
      expires_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    user.uid,
    user.email,
    user.display_name,
    user.photo_url,
    toBoolean(user.email_verified) ? 1 : 0,
    toBoolean(user.is_admin) ? 1 : 0,
    toStringValue(user.role) || 'user',
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString(),
  ).run();
  return rawToken;
};

const readSessionRow = async (db: AuthDatabase, token: string): Promise<AuthSessionRow | null> => {
  const tokenHash = hashSessionToken(token);
  await ensureSchema(db);
  return db.prepare(`
    SELECT *
    FROM auth_sessions
    WHERE token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first<AuthSessionRow>();
};

const updateSessionLastSeen = async (db: AuthDatabase, token: string): Promise<void> => {
  const tokenHash = hashSessionToken(token);
  const now = new Date().toISOString();
  await ensureSchema(db);
  await db.prepare(`
    UPDATE auth_sessions
    SET last_seen_at = ?
    WHERE token_hash = ?
  `).bind(now, tokenHash).run();
};

const revokeSessionToken = async (db: AuthDatabase, token: string): Promise<boolean> => {
  const tokenHash = hashSessionToken(token);
  await ensureSchema(db);
  const result = await db.prepare(`
    DELETE FROM auth_sessions
    WHERE token_hash = ?
  `).bind(tokenHash).run();
  return Boolean(result);
};

const resolveSessionToken = async (db: AuthDatabase, token: string): Promise<ServerAuthedUserContext | null> => {
  const sessionRow = await readSessionRow(db, token);
  if (!sessionRow) return null;

  if (sessionRow.expires_at && new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    await revokeSessionToken(db, token);
    return null;
  }

  await updateSessionLastSeen(db, token);
  const userRow = await readAuthUserByUid(db, sessionRow.uid);
  const snapshot = userRow ? toAuthSnapshot(userRow) : toAuthSnapshot(sessionRow, sessionRow.uid);

  return {
    uid: snapshot.uid || sessionRow.uid,
    decodedToken: buildDecodedToken(snapshot, sessionRow),
    userRef: createUserRefShim(snapshot.uid || sessionRow.uid),
    userData: userRow
      ? {
          uid: userRow.uid,
          email: userRow.email,
          displayName: userRow.display_name,
          name: userRow.display_name,
          photoURL: userRow.photo_url,
          photoUrl: userRow.photo_url,
          emailVerified: toBoolean(userRow.email_verified),
          isAdmin: toBoolean(userRow.is_admin),
          admin: toBoolean(userRow.is_admin),
          role: toStringValue(userRow.role) || (toBoolean(userRow.is_admin) ? 'admin' : 'user'),
          roles: parseRoles(userRow.roles_json),
        } as unknown as DocumentData
      : null,
    userExists: Boolean(userRow),
  };
};

const resolveRequestToken = (request: Request): { bearerToken: string; cookieToken: string } => {
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const cookieHeader = String(request.headers.get('cookie') || '').trim();
  let cookieToken = '';
  if (cookieHeader) {
    for (const entry of cookieHeader.split(';')) {
      const [name, ...rawValue] = entry.split('=');
      if (String(name || '').trim() !== AUTH_SESSION_COOKIE_NAME) continue;
      cookieToken = decodeURIComponent(rawValue.join('=').trim());
      break;
    }
  }
  return { bearerToken, cookieToken };
};

const resolveDevContext = (request: Request): ServerAuthedUserContext | null => {
  const enableDevUidHeader = readEnvBoolean(
    process.env.VF_DEV_UID_HEADER_ENABLED,
    process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER,
  ) === true;
  if (!enableDevUidHeader) return null;
  const uid = String(request.headers.get('x-dev-uid') || '').trim();
  if (!uid) return null;
  const email = String(request.headers.get('x-dev-email') || '').trim() || undefined;
  const isAdmin = String(request.headers.get('x-dev-admin') || '').trim().toLowerCase() === 'true'
    || String(request.headers.get('x-dev-role') || '').trim().toLowerCase() === 'admin';
  const snapshot = {
    uid,
    email: email || '',
    displayName: null,
    photoURL: null,
    emailVerified: true,
    isAdmin,
    role: isAdmin ? 'admin' : 'dev',
    roles: isAdmin ? ['admin'] : ['dev'],
  } satisfies AuthUserSnapshot;
  return {
    uid,
    decodedToken: buildDecodedToken(snapshot),
    userRef: createUserRefShim(uid),
    userData: null,
    userExists: false,
  };
};

const resolveRequestUser = async (
  db: AuthDatabase,
  request: Request,
  options: { preferCookie?: boolean } = {},
): Promise<ServerAuthedUserContext | null> => {
  const { bearerToken, cookieToken } = resolveRequestToken(request);
  const tokenOrder = options.preferCookie
    ? [cookieToken, bearerToken]
    : [bearerToken, cookieToken];

  for (const token of tokenOrder) {
    if (!token) continue;
    const context = await resolveSessionToken(db, token);
    if (context) return context;
  }

  return resolveDevContext(request);
};

const ensureAdminSeeds = async (): Promise<void> => {
  const db = await getD1Database();
  if (!db) return;

  const adminEmails = normalizeAdminSeedEmails();
  if (adminEmails.length <= 0) return;

  await ensureSchema(db);
  const password = defaultSeedPassword();
  const passwordHash = hashPasswordForStorage(password);

  for (const email of adminEmails) {
    const existing = await readAuthUserByEmail(db, email);
    if (!existing) {
      await writeAuthUser(db, {
        uid: createUserIdFromEmail(email),
        email,
        displayName: createDisplayNameFromEmail(email),
        photoURL: null,
        emailVerified: true,
        isAdmin: true,
        role: 'admin',
        roles: ['admin'],
        passwordHash,
        passwordSalt: passwordHash.split('$')[2] || '',
      });
      continue;
    }

    await promoteExistingAdminSeed(db, existing, passwordHash);
  }
};

const loginWithEmailAndPassword = async (email: string, password: string): Promise<{
  uid: string;
  token: string;
  user: {
    email: string;
    displayName: string | null;
    photoURL: string | null;
    emailVerified: boolean;
  };
}> => {
  const db = await getD1Database();
  if (!db) {
    throw new D1AuthError('Auth database is unavailable', 'auth/unavailable', 503);
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !String(password || '')) {
    throw new D1AuthError('Email and password are required', 'auth/invalid-credentials', 400);
  }

  const userRow = await readAuthUserByEmail(db, normalizedEmail);
  if (!userRow) {
    throw new D1AuthError('Invalid credentials', 'auth/user-not-found', 401);
  }

  if (!verifyPasswordHash(password, userRow.password_hash)) {
    throw new D1AuthError('Invalid credentials', 'auth/wrong-password', 401);
  }

  if (!toBoolean(userRow.email_verified)) {
    throw new D1AuthError('Email not verified', 'auth/email-not-verified', 401);
  }

  const token = await issueSessionForUser(db, userRow);
  return {
    uid: userRow.uid,
    token,
    user: {
      email: userRow.email,
      displayName: userRow.display_name,
      photoURL: userRow.photo_url,
      emailVerified: true,
    },
  };
};

const resolveSessionTokenForService = async (token: string): Promise<ServerAuthedUserContext | null> => {
  const db = await getD1Database();
  if (!db) return null;
  return resolveSessionToken(db, token);
};

const resolveRequestUserForService = async (
  request: Request,
  options: { preferCookie?: boolean } = {},
): Promise<ServerAuthedUserContext | null> => {
  const db = await getD1Database();
  if (!db) return resolveDevContext(request);
  return resolveRequestUser(db, request, options);
};

const revokeSessionTokenForService = async (token: string): Promise<boolean> => {
  const db = await getD1Database();
  if (!db) return false;
  return revokeSessionToken(db, token);
};

export const getD1AuthService = (): D1AuthService => ({
  ensureAdminSeeds,
  loginWithEmailAndPassword,
  resolveSessionToken: resolveSessionTokenForService,
  resolveRequestUser: resolveRequestUserForService,
  revokeSessionToken: revokeSessionTokenForService,
});

export { D1AuthError };
