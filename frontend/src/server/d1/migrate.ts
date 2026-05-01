/**
 * D1 Schema Migration Runner
 *
 * Reads the migration registry (./migrations/index.ts), checks which
 * migrations have already been applied via the `_migrations` tracking
 * table, and runs any pending migrations in order.
 *
 * Idempotent: safe to call on every worker warm start.
 * Graceful: returns { ok: false, reason: 'd1-unavailable' } when D1 is
 * not reachable, without throwing.
 */

import type { D1Database } from './util';
import { getD1Database } from './util';
import { migrationFiles } from './migrations/index';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MigrationResult {
  ok: boolean;
  reason?: string;
  /** Number of migrations that were applied this run. */
  applied?: number;
  /** Number of migrations already applied (skipped). */
  skipped?: number;
}

interface PersistedMigration {
  filename: string;
  hash: string;
  applied_at: string;
}

/* ------------------------------------------------------------------ */
/*  Hash helper                                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute a deterministic hex hash from a string.
 * Not cryptographically secure -- used only to detect content changes.
 */
function computeHash(content: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 ^= (h1 >>> 16) ^ (h2 >>> 13);
  h2 ^= (h2 >>> 16) ^ (h1 >>> 11);
  return (h1 >>> 0).toString(16).padStart(8, '0') +
         (h2 >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/*  Migration tracking table                                           */
/* ------------------------------------------------------------------ */

const MIGRATIONS_TABLE = '_migrations';

async function ensureMigrationsTable(db: D1Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY NOT NULL,
      hash TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run pending migrations against the provided D1 database handle.
 *
 * Steps:
 *  1. Ensure the `_migrations` tracking table exists.
 *  2. Query already-applied migrations.
 *  3. For each migration in the registry (ordered by filename):
 *      a. If the filename + hash match an existing record, skip.
 *      b. Otherwise, execute the SQL and record the result.
 *
 * @returns A result object indicating success/failure and counts.
 */
export async function runMigrations(db: D1Database): Promise<MigrationResult> {
  try {
    await ensureMigrationsTable(db);

    // Fetch already-applied migrations into a Map<filename, hash>.
    const rows = await db
      .prepare(`SELECT filename, hash FROM ${MIGRATIONS_TABLE} ORDER BY filename`)
      .all<{ filename: string; hash: string }>();

    const applied = new Map<string, string>();
    for (const row of rows.results) {
      applied.set(row.filename, row.hash);
    }

    let appliedCount = 0;
    let skippedCount = 0;
    const now = new Date().toISOString();

    for (const migration of migrationFiles) {
      const hash = computeHash(migration.sql);
      const existingHash = applied.get(migration.filename);

      if (existingHash === hash) {
        skippedCount++;
        continue;
      }

      // Run the migration SQL (all statements in one exec call).
      await db.exec(migration.sql);

      // Record in the tracking table.
      await db
        .prepare(
          `INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (filename, hash, applied_at) VALUES (?, ?, ?)`,
        )
        .bind(migration.filename, hash, now)
        .run();

      appliedCount++;
    }

    return { ok: true, applied: appliedCount, skipped: skippedCount };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown migration error';
    return { ok: false, reason: message };
  }
}

/**
 * Convenience wrapper that obtains the D1 database handle internally via
 * `getD1Database()` and then delegates to `runMigrations()`.
 *
 * Returns `{ ok: false, reason: 'd1-unavailable' }` when the D1 binding
 * is not configured, making this safe to call on every worker startup.
 */
export async function runAllMigrations(): Promise<MigrationResult> {
  try {
    const db = await getD1Database();
    if (!db) {
      return { ok: false, reason: 'd1-unavailable' };
    }
    return await runMigrations(db);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown migration error';
    return { ok: false, reason: message };
  }
}
