import { NextRequest, NextResponse } from 'next/server';
import { getD1Database, ensureD1Schema } from '../../../src/server/d1/util';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../../../src/server/firebaseAdmin';

async function verifyRequest(req: NextRequest): Promise<{ uid: string }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing authorization');
  }
  const token = authHeader.slice(7);
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  return { uid: decoded.uid };
}

const MIN_WITHDRAWAL_VN = 10000;  // ₹1,000 = 10,000 VN
const MAX_WITHDRAWAL_VN = 5000000; // ₹5,00,000 = 50,00,000 VN
const PLATFORM_FEE_PERCENT = 2;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

const SCHEMA = `
CREATE TABLE IF NOT EXISTS withdrawals (
  withdrawal_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_uid ON withdrawals(uid);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_uid ON transactions(uid);
`;

function randomId(): string {
  return crypto.randomUUID();
}

function parsePayload(row: { payload_json?: string } | null): Record<string, unknown> | null {
  if (!row?.payload_json) return null;
  try {
    const parsed = JSON.parse(row.payload_json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// POST — request withdrawal
export async function POST(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);

    const body = await req.json();
    const vnAmount = Math.floor(Number(body.vnAmount || 0));

    if (!Number.isFinite(vnAmount) || vnAmount < MIN_WITHDRAWAL_VN || vnAmount > MAX_WITHDRAWAL_VN) {
      return NextResponse.json(
        { error: `Withdrawal must be between ${MIN_WITHDRAWAL_VN} VN (₹${MIN_WITHDRAWAL_VN / 10}) and ${MAX_WITHDRAWAL_VN} VN (₹${MAX_WITHDRAWAL_VN / 10}).` },
        { status: 400 }
      );
    }

    const d1 = await getD1Database();

    if (d1) {
      await ensureD1Schema(d1, SCHEMA);

      const db = getFirebaseAdminFirestore();
      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.data();

      if (!userData || userData.kycStatus !== 'verified') {
        return NextResponse.json(
          { error: 'KYC verification required before withdrawal.' },
          { status: 403 }
        );
      }

      const bankDetails = userData.bankDetails;
      if (!bankDetails?.accountNumber || !bankDetails?.ifsc || !bankDetails?.beneficiaryName) {
        return NextResponse.json(
          { error: 'Bank details required. Please add your bank account in settings.' },
          { status: 400 }
        );
      }

      const recentRows = await d1.prepare(
        `SELECT payload_json, created_at FROM withdrawals WHERE uid = ? ORDER BY created_at DESC LIMIT 10`
      ).bind(uid).all<{ payload_json: string; created_at: string }>();

      if (recentRows.results && recentRows.results.length > 0) {
        const lastPending = recentRows.results.find((row) => {
          const payload = parsePayload(row);
          return payload?.status === 'pending' || payload?.status === 'processing';
        });
        if (lastPending) {
          const lastTime = new Date(lastPending.created_at).getTime();
          if (Date.now() - lastTime < COOLDOWN_MS) {
            return NextResponse.json(
              { error: 'Only one withdrawal per week is allowed. Please wait before requesting again.' },
              { status: 429 }
            );
          }
        }
      }

      const inrAmount = vnAmount / 10;
      const platformFee = Math.round(inrAmount * PLATFORM_FEE_PERCENT) / 100;
      const netAmount = inrAmount - platformFee;

      const currentVn = Number(userData?.vnBalance ?? 0);
      if (currentVn < vnAmount) {
        return NextResponse.json(
          { error: `Insufficient VN balance. Have ${currentVn}, need ${vnAmount}.` },
          { status: 400 }
        );
      }

      const withdrawalId = randomId();
      const transactionId = randomId();
      const now = new Date().toISOString();

      await userDoc.ref.set(
        { vnBalance: currentVn - vnAmount },
        { merge: true },
      );

      const withdrawal = {
        userId: uid,
        vnAmount,
        inrAmount,
        platformFee,
        netAmount,
        bankDetails: {
          accountNumber: String(bankDetails.accountNumber),
          ifsc: String(bankDetails.ifsc),
          beneficiaryName: String(bankDetails.beneficiaryName),
        },
        status: 'pending',
        createdAt: now,
      };

      await d1.prepare(`
        INSERT INTO withdrawals (withdrawal_id, uid, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(withdrawalId, uid, JSON.stringify(withdrawal), now).run();

      await d1.prepare(`
        INSERT INTO transactions (transaction_id, uid, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(transactionId, uid, JSON.stringify({
        userId: uid,
        type: 'withdrawal',
        amount: -vnAmount,
        tokenType: 'VN',
        status: 'completed',
        timestamp: now,
        metadata: { withdrawalId },
      }), now).run();

      return NextResponse.json({ withdrawal: { id: withdrawalId, ...withdrawal } });
    }

    const db = getFirebaseAdminFirestore();

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    if (!userData || userData.kycStatus !== 'verified') {
      return NextResponse.json(
        { error: 'KYC verification required before withdrawal.' },
        { status: 403 }
      );
    }

    const bankDetails = userData.bankDetails;
    if (!bankDetails?.accountNumber || !bankDetails?.ifsc || !bankDetails?.beneficiaryName) {
      return NextResponse.json(
        { error: 'Bank details required. Please add your bank account in settings.' },
        { status: 400 }
      );
    }

    const recentWithdrawals = await db
      .collection('withdrawals')
      .where('userId', '==', uid)
      .where('status', 'in', ['pending', 'processing'])
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!recentWithdrawals.empty) {
      const last = recentWithdrawals.docs[0]!.data();
      const lastTime = new Date(last.createdAt).getTime();
      if (Date.now() - lastTime < COOLDOWN_MS) {
        return NextResponse.json(
          { error: 'Only one withdrawal per week is allowed. Please wait before requesting again.' },
          { status: 429 }
        );
      }
    }

    const inrAmount = vnAmount / 10;
    const platformFee = Math.round(inrAmount * PLATFORM_FEE_PERCENT) / 100;
    const netAmount = inrAmount - platformFee;

    const result = await db.runTransaction(async (tx: any) => {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await tx.get(userRef);
      const uData = userSnap.data();
      const currentVn = Number(uData?.vnBalance ?? 0);

      if (currentVn < vnAmount) {
        throw new Error(`Insufficient VN balance. Have ${currentVn}, need ${vnAmount}.`);
      }

      const withdrawalRef = db.collection('withdrawals').doc();
      const now = new Date().toISOString();

      tx.set(userRef, {
        vnBalance: currentVn - vnAmount,
      }, { merge: true });

      const withdrawal = {
        userId: uid,
        vnAmount,
        inrAmount,
        platformFee,
        netAmount,
        bankDetails: {
          accountNumber: String(bankDetails.accountNumber),
          ifsc: String(bankDetails.ifsc),
          beneficiaryName: String(bankDetails.beneficiaryName),
        },
        status: 'pending' as const,
        createdAt: now,
      };

      tx.set(withdrawalRef, withdrawal);

      const txRef = db.collection('transactions').doc();
      tx.set(txRef, {
        userId: uid,
        type: 'withdrawal',
        amount: -vnAmount,
        tokenType: 'VN',
        status: 'completed',
        timestamp: now,
        metadata: { withdrawalId: withdrawalRef.id },
      });

      return { id: withdrawalRef.id, ...withdrawal };
    });

    return NextResponse.json({ withdrawal: result });
  } catch (err: any) {
    const message = String(err?.message || 'Withdrawal failed');
    const status = message.includes('Insufficient') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// GET — list withdrawals
export async function GET(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));

    const d1 = await getD1Database();

    if (d1) {
      await ensureD1Schema(d1, SCHEMA);
      const rows = await d1.prepare(
        `SELECT withdrawal_id as id, payload_json, created_at FROM withdrawals WHERE uid = ? ORDER BY created_at DESC LIMIT ?`
      ).bind(uid, limit).all<{ id: string; payload_json: string; created_at: string }>();

      const withdrawals = (rows.results || []).map((row) => {
        const payload = parsePayload(row);
        return payload ? { id: row.id, ...payload } : { id: row.id };
      });

      return NextResponse.json({ withdrawals });
    }

    const db = getFirebaseAdminFirestore();

    const snap = await db
      .collection('withdrawals')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const withdrawals = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ withdrawals });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || 'Failed to fetch withdrawals') }, { status: 500 });
  }
}
