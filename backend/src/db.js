const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let nodeCryptoPromise = null;
let nodeUtilPromise = null;

async function loadNodeCrypto() {
  if (!nodeCryptoPromise) {
    nodeCryptoPromise = import('node:crypto');
  }
  return nodeCryptoPromise;
}

async function loadNodeUtil() {
  if (!nodeUtilPromise) {
    nodeUtilPromise = import('node:util');
  }
  return nodeUtilPromise;
}

export function resolveDatabase(source) {
  const candidates = [
    source,
    source?.db,
    source?.database,
    source?.env?.DB,
    source?.context?.env?.DB,
    source?.bindings?.DB,
    globalThis.DB,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate.prepare === 'function') {
      return candidate;
    }
  }

  throw new Error('Unable to resolve a D1 database binding. Pass `db` or `env.DB`.');
}

export function toIsoString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeSlug(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : '';
}

export function toPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value;
}

export function stringifyJson(value) {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

export function parseJson(value, fallback = null) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

export function bytesToBase64Url(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64url');
  }

  let binary = '';
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/-/g, '+').replace(/_/g, '/') : '';
  if (!normalized) {
    return new Uint8Array();
  }

  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function utf8ToBytes(value) {
  return textEncoder.encode(String(value));
}

export function bytesToUtf8(bytes) {
  return textDecoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
}

export async function randomBytes(length = 32) {
  const size = Number.isFinite(length) && length > 0 ? Math.floor(length) : 32;

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(size);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  const nodeCrypto = await loadNodeCrypto();
  return new Uint8Array(nodeCrypto.randomBytes(size));
}

export function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  }

  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${timestamp}${randomPart}`;
}

export const randomId = createId;

export async function sha256Bytes(value) {
  const bytes = value instanceof Uint8Array ? value : utf8ToBytes(value);

  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(digest);
  }

  const nodeCrypto = await loadNodeCrypto();
  return new Uint8Array(nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest());
}

export function constantTimeEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || []);

  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function pbkdf2Sha256(password, saltBytes, iterations, length = 32) {
  const salt = saltBytes instanceof Uint8Array ? saltBytes : new Uint8Array(saltBytes || []);
  const passwordBytes = utf8ToBytes(password);
  const rounds = Number.isFinite(iterations) && iterations > 0 ? Math.floor(iterations) : 210000;
  const keyLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 32;

  if (globalThis.crypto?.subtle?.importKey && globalThis.crypto?.subtle?.deriveBits) {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      passwordBytes,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const bits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations: rounds,
      },
      key,
      keyLength * 8
    );

    return new Uint8Array(bits);
  }

  const [nodeCrypto, nodeUtil] = await Promise.all([loadNodeCrypto(), loadNodeUtil()]);
  const pbkdf2Async = nodeUtil.promisify(nodeCrypto.pbkdf2);
  const derived = await pbkdf2Async(
    Buffer.from(passwordBytes),
    Buffer.from(salt),
    rounds,
    keyLength,
    'sha256'
  );
  return new Uint8Array(derived);
}

function toSqliteStatement(db, statement) {
  if (typeof statement === 'string') {
    return db.prepare(statement);
  }

  if (statement && typeof statement.sql === 'string') {
    const prepared = db.prepare(statement.sql);
    return Array.isArray(statement.params) ? prepared.bind(...statement.params) : prepared;
  }

  return statement;
}

export async function runStatement(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

export async function fetchOne(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

export async function fetchAll(db, sql, params = []) {
  return db.prepare(sql).bind(...params).all();
}

export async function runBatch(db, statements) {
  if (typeof db.batch === 'function') {
    return db.batch(statements.map((statement) => toSqliteStatement(db, statement)));
  }

  const results = [];
  for (const statement of statements) {
    if (typeof statement === 'string') {
      results.push(await db.prepare(statement).run());
      continue;
    }

    const prepared = db.prepare(statement.sql);
    results.push(Array.isArray(statement.params) ? await prepared.bind(...statement.params).run() : await prepared.run());
  }
  return results;
}
