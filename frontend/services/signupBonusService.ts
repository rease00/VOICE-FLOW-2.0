/**
 * Signup Bonus — Credit 1,000 VF to new users on first login.
 * Idempotent: checks `signupBonusCredited` flag before crediting.
 */

import { getD1Database, ensureD1Schema } from '../src/server/d1/util';
import { getFirebaseAdminFirestore } from '../src/server/firebaseAdmin';

const SIGNUP_BONUS_VF = 1000;

const SIGNUP_BONUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS signup_bonus (
  uid TEXT PRIMARY KEY NOT NULL,
  credited INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`;

export async function creditSignupBonus(uid: string): Promise<{ credited: boolean; amount: number }> {
  const d1 = await getD1Database();

  if (d1) {
    await ensureD1Schema(d1, SIGNUP_BONUS_SCHEMA);

    const row = await d1.prepare('SELECT credited FROM signup_bonus WHERE uid = ? LIMIT 1')
      .bind(uid)
      .first<{ credited: number }>();

    if (row?.credited) {
      return { credited: false, amount: 0 };
    }

    const now = new Date().toISOString();
    await d1.prepare(`
      INSERT INTO signup_bonus (uid, credited, payload_json, created_at)
      VALUES (?, 1, '{}', ?)
      ON CONFLICT(uid) DO UPDATE SET credited = 1, payload_json = '{}'
    `).bind(uid, now).run();

    const db = getFirebaseAdminFirestore();
    const userRef = db.collection('users').doc(uid);

    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const currentVff = Number(userData?.wallets?.vffBalance ?? 0);

    await userRef.set(
      {
        signupBonusCredited: true,
        wallets: { ...(userData.wallets || {}), vffBalance: currentVff + SIGNUP_BONUS_VF },
      },
      { merge: true },
    );

    const txRef = db.collection('transactions').doc();
    await txRef.set({
      userId: uid,
      type: 'signup_bonus',
      amount: SIGNUP_BONUS_VF,
      tokenType: 'VF',
      status: 'completed',
      timestamp: now,
      metadata: { reason: 'New user signup bonus' },
    });

    return { credited: true, amount: SIGNUP_BONUS_VF };
  }

  const db = getFirebaseAdminFirestore();
  const userRef = db.collection('users').doc(uid);

  const result = await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(userRef);
    const data = doc.data();

    if (data?.signupBonusCredited) {
      return { credited: false, amount: 0 };
    }

    const currentVff = Number(data?.wallets?.vffBalance ?? 0);

    tx.set(
      userRef,
      {
        signupBonusCredited: true,
        wallets: { ...(data?.wallets || {}), vffBalance: currentVff + SIGNUP_BONUS_VF },
      },
      { merge: true },
    );

    const txRef = db.collection('transactions').doc();
    tx.set(txRef, {
      userId: uid,
      type: 'signup_bonus',
      amount: SIGNUP_BONUS_VF,
      tokenType: 'VF',
      status: 'completed',
      timestamp: new Date().toISOString(),
      metadata: { reason: 'New user signup bonus' },
    });

    return { credited: true, amount: SIGNUP_BONUS_VF };
  });

  return result;
}
