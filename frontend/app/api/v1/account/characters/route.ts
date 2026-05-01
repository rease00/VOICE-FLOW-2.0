import type { NextRequest } from 'next/server';

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { getD1Database } from '../../../../../src/server/d1/util';
import { ensureAccountBillingD1SchemaExtra, CHARACTERS_D1_SCHEMA } from '../../../../../src/server/account/service';

const CHARACTERS_TABLE = 'account_characters';

type CharRow = {
  uid: string;
  char_id: string;
  payload_json: string;
  updated_at: string;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const readCharsForUser = async (uid: string): Promise<Record<string, unknown>[]> => {
  const db = await getD1Database();
  if (!db) return [];
  await ensureAccountBillingD1SchemaExtra(db, CHARACTERS_D1_SCHEMA);
  const response = await db.prepare(
    `SELECT char_id, payload_json FROM ${CHARACTERS_TABLE} WHERE uid = ? ORDER BY char_id ASC`
  ).bind(uid).all<{ char_id?: string; payload_json?: string }>();
  const rows = Array.isArray(response?.results) ? response.results : [];
  return rows.map((row) => {
    try {
      const parsed = JSON.parse(String(row.payload_json || '{}'));
      return { ...parsed, id: parsed.id || row.char_id, char_id: row.char_id };
    } catch {
      return { id: row.char_id, char_id: row.char_id };
    }
  });
};

const upsertChar = async (uid: string, charId: string, payload: Record<string, unknown>): Promise<void> => {
  const db = await getD1Database();
  if (!db) throw new Error('Database unavailable');
  await ensureAccountBillingD1SchemaExtra(db, CHARACTERS_D1_SCHEMA);
  await db.prepare(`
    INSERT INTO ${CHARACTERS_TABLE} (uid, char_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(uid, char_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).bind(uid, charId, JSON.stringify(payload), new Date().toISOString()).run();
};

const deleteChar = async (uid: string, charId: string): Promise<void> => {
  const db = await getD1Database();
  if (!db) throw new Error('Database unavailable');
  await ensureAccountBillingD1SchemaExtra(db, CHARACTERS_D1_SCHEMA);
  await db.prepare(`DELETE FROM ${CHARACTERS_TABLE} WHERE uid = ? AND char_id = ?`)
    .bind(uid, charId)
    .run();
};

export const GET = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'characters'],
  async (user) => {
    const characters = await readCharsForUser(user.uid);
    return Response.json({ ok: true, characters });
  }
);

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'characters'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const character: Record<string, unknown> = body && typeof body === 'object' ? body : {};
    const id = String(character.id || '').trim() || crypto.randomUUID();
    const payload = {
      ...character,
      id,
      updatedAt: new Date().toISOString(),
    };
    await upsertChar(user.uid, id, payload);
    return Response.json({ ok: true, character: payload });
  }
);
