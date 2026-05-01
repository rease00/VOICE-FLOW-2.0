import { getCloudflareContext } from '@opennextjs/cloudflare';

export type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

export type D1Database = {
  prepare: (sql: string) => D1Statement;
  exec: (sql: string) => Promise<unknown>;
};

let d1DatabasePromise: Promise<D1Database | null> | null = null;
const schemaPromiseBySchema = new Map<string, Promise<void>>();

const isDevMode = (): boolean => process.env.NODE_ENV === 'development';

export const getD1Database = async (): Promise<D1Database | null> => {
  if (!d1DatabasePromise) {
    d1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: D1Database }).DB;
        if (!db || typeof db.prepare !== 'function') {
          if (isDevMode()) {
            console.warn('[D1] Database binding not available. Running without D1 persistence.');
          }
          return null;
        }
        return db;
      } catch {
        if (isDevMode()) {
          console.warn('[D1] getCloudflareContext failed. Running without D1 persistence.');
        }
        return null;
      }
    })();
  }
  return d1DatabasePromise;
};

export const ensureD1Schema = async (db: D1Database, schema: string): Promise<void> => {
  let promise = schemaPromiseBySchema.get(schema);
  if (!promise) {
    promise = db.exec(schema).then(() => undefined).catch((error: unknown) => {
      schemaPromiseBySchema.delete(schema);
      throw error;
    });
    schemaPromiseBySchema.set(schema, promise);
  }
  await promise;
};

export const readD1JsonRecord = async (
  db: D1Database,
  table: string,
  keyColumn: string,
  keyValue: string,
): Promise<Record<string, unknown> | null> => {
  const row = await db.prepare(`SELECT payload_json FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`)
    .bind(keyValue)
    .first<{ payload_json?: string }>();
  return parseJsonPayload(row?.payload_json);
};

export const writeD1JsonRecord = async (
  db: D1Database,
  table: string,
  keyColumn: string,
  keyValue: string,
  payload: Record<string, unknown>,
  updatedAt?: string,
): Promise<void> => {
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

export const deleteD1JsonRecord = async (
  db: D1Database,
  table: string,
  keyColumn: string,
  keyValue: string,
): Promise<void> => {
  await db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`)
    .bind(keyValue)
    .run();
};

export const readD1JsonRows = async (
  db: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> => {
  const response = await db.prepare(sql).bind(...values).all<Record<string, unknown>>();
  return Array.isArray(response?.results) ? response.results : [];
};

export const parseJsonPayload = (value: string | null | undefined): Record<string, unknown> | null => {
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

/* ------------------------------------------------------------------ */
/*  Schema migration integration                                       */
/* ------------------------------------------------------------------ */

import { runMigrations, runAllMigrations } from './migrate';
export { runMigrations, runAllMigrations };
export type { MigrationResult } from './migrate';

let _migrationsConfirmed = false;

/**
 * Safe-to-call-on-every-warm-start helper that runs pending D1 schema
 * migrations once per worker instance.
 *
 * - If migrations have already been confirmed as applied (in-memory flag),
 *   this is a no-op.
 * - If D1 is not available, logs a warning and returns silently.
 * - If migrations are applied successfully, sets the in-memory flag so
 *   subsequent calls in the same worker instance are skipped.
 *
 * Intended for use in service initialization / module bootstrap code.
 */
export const maybeRunMigrations = async (): Promise<void> => {
  if (_migrationsConfirmed) return;

  try {
    const result = await runAllMigrations();
    if (result.ok) {
      _migrationsConfirmed = true;
      if ((result.applied ?? 0) > 0) {
        console.log(`[D1] Applied ${result.applied} schema migration(s)`);
      }
    } else if (result.reason === 'd1-unavailable') {
      console.warn('[D1] Schema migrations skipped: D1 not available');
    } else {
      console.warn(`[D1] Schema migration error: ${result.reason}`);
    }
  } catch {
    // Defensive: swallow unexpected errors so a migration failure never
    // prevents the rest of the worker from booting.
    console.warn('[D1] Schema migration threw unexpectedly');
  }
};
