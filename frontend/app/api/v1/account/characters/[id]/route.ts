import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { getD1Database } from '../../../../../../src/server/d1/util';
import { ensureAccountBillingD1SchemaExtra, CHARACTERS_D1_SCHEMA } from '../../../../../../src/server/account/service';

const CHARACTERS_TABLE = 'account_characters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: charId } = await params;
  return handleAuthedAccountBillingRoute(
    request,
    ['account', 'characters', charId],
    async (user) => {
      const db = await getD1Database();
      if (!db) throw new Error('Database unavailable');
      await ensureAccountBillingD1SchemaExtra(db, CHARACTERS_D1_SCHEMA);
      await db.prepare(`DELETE FROM ${CHARACTERS_TABLE} WHERE uid = ? AND char_id = ?`)
        .bind(user.uid, charId)
        .run();
      return Response.json({ ok: true });
    }
  );
};
