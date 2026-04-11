/**
 * Signup Bonus — Credit 1,000 VF to new users on first login.
 * Idempotent: checks `signupBonusCredited` flag before crediting.
 */

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function getAdminApp() {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    }),
  });
}

const SIGNUP_BONUS_VF = 1000;

export async function creditSignupBonus(uid: string): Promise<{ credited: boolean; amount: number }> {
  const db = getFirestore(getAdminApp());
  const userRef = db.collection('users').doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const data = doc.data();

    if (data?.signupBonusCredited) {
      return { credited: false, amount: 0 };
    }

    tx.set(
      userRef,
      {
        signupBonusCredited: true,
        'wallets.vffBalance': FieldValue.increment(SIGNUP_BONUS_VF),
      },
      { merge: true },
    );

    // Record transaction
    const txRef = db.collection('transactions').doc();
    tx.create(txRef, {
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
