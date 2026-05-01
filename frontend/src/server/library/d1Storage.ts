import { getCloudflareContext } from '@opennextjs/cloudflare';

export const LIBRARY_D1_TABLES = Object.freeze({
  readerProgress: 'library_reader_progress',
  readerSessions: 'library_reader_sessions',
  readerPreferences: 'library_reader_preferences',
} as const);

export const LIBRARY_D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS library_reader_progress (
  uid TEXT NOT NULL,
  book_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, book_id)
);
CREATE INDEX IF NOT EXISTS library_reader_progress_uid_idx ON library_reader_progress(uid);
CREATE TABLE IF NOT EXISTS library_reader_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS library_reader_sessions_uid_updated_at_idx
  ON library_reader_sessions (uid, updated_at DESC, session_id DESC);
CREATE TABLE IF NOT EXISTS library_reader_preferences (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

type LibraryReaderD1Statement = {
  bind: (...values: unknown[]) => LibraryReaderD1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type LibraryReaderD1Database = {
  prepare: (sql: string) => LibraryReaderD1Statement;
  exec: (sql: string) => Promise<unknown>;
};

let libraryReaderD1DatabasePromise: Promise<LibraryReaderD1Database | null> | null = null;
const libraryReaderD1SchemaPromises = new Map<string, Promise<void>>();

const isDevMode = (): boolean => process.env.NODE_ENV === 'development';

export const getLibraryReaderD1Database = async (): Promise<LibraryReaderD1Database | null> => {
  if (!libraryReaderD1DatabasePromise) {
    libraryReaderD1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: LibraryReaderD1Database }).DB;
        if (!db || typeof db.prepare !== 'function') {
          if (isDevMode()) {
            console.warn('[LibraryReaderD1] Database binding not available. Running without D1 persistence.');
          }
          return null;
        }
        return db;
      } catch {
        if (isDevMode()) {
          console.warn('[LibraryReaderD1] getCloudflareContext failed. Running without D1 persistence.');
        }
        return null;
      }
    })();
  }
  return libraryReaderD1DatabasePromise;
};

export const ensureLibraryReaderD1Schema = async (db: LibraryReaderD1Database): Promise<void> => {
  let promise = libraryReaderD1SchemaPromises.get(LIBRARY_D1_SCHEMA);
  if (!promise) {
    promise = db.exec(LIBRARY_D1_SCHEMA).then(() => undefined).catch((error: unknown) => {
      libraryReaderD1SchemaPromises.delete(LIBRARY_D1_SCHEMA);
      throw error;
    });
    libraryReaderD1SchemaPromises.set(LIBRARY_D1_SCHEMA, promise);
  }
  await promise;
};

const parseJsonPayload = (value: string | null | undefined): Record<string, unknown> | null => {
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

export const readReaderD1Record = async (
  table: string,
  keyColumn: string,
  keyValue: string,
): Promise<Record<string, unknown> | null> => {
  const db = await getLibraryReaderD1Database();
  if (!db) return null;
  await ensureLibraryReaderD1Schema(db);
  const row = await db.prepare(`SELECT payload_json FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`)
    .bind(keyValue)
    .first<{ payload_json?: string }>();
  return parseJsonPayload(row?.payload_json || null);
};

export const writeReaderD1Record = async (
  table: string,
  keyColumn: string,
  keyValue: string,
  payload: Record<string, unknown>,
  updatedAt?: string,
): Promise<void> => {
  const db = await getLibraryReaderD1Database();
  if (!db) return;
  await ensureLibraryReaderD1Schema(db);
  await db.prepare(`
    INSERT INTO ${table} (${keyColumn}, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(${keyColumn}) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `)
    .bind(keyValue, JSON.stringify(payload), updatedAt || new Date().toISOString())
    .run();
};

export const deleteReaderD1Record = async (
  table: string,
  keyColumn: string,
  keyValue: string,
): Promise<number> => {
  const db = await getLibraryReaderD1Database();
  if (!db) return 0;
  await ensureLibraryReaderD1Schema(db);
  const existing = await readReaderD1Record(table, keyColumn, keyValue);
  await db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`)
    .bind(keyValue)
    .run();
  return existing ? 1 : 0;
};

export const readReaderD1Rows = async (
  sql: string,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> => {
  const db = await getLibraryReaderD1Database();
  if (!db) return [];
  await ensureLibraryReaderD1Schema(db);
  const response = await db.prepare(sql).bind(...values).all<Record<string, unknown>>();
  return Array.isArray(response?.results) ? response.results : [];
};

export const writeReaderD1UpsertMultiKey = async (
  table: string,
  keyColumns: string[],
  keyValues: unknown[],
  payload: Record<string, unknown>,
  updatedAt?: string,
): Promise<void> => {
  const db = await getLibraryReaderD1Database();
  if (!db) return;
  await ensureLibraryReaderD1Schema(db);

  const placeholders = keyColumns.map(() => '?').join(', ');

  await db.prepare(`
    INSERT INTO ${table} (${keyColumns.join(', ')}, payload_json, updated_at)
    VALUES (${placeholders}, ?, ?)
    ON CONFLICT(${keyColumns.join(', ')}) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `)
    .bind(...keyValues, JSON.stringify(payload), updatedAt || new Date().toISOString())
    .run();
};
