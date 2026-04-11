import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

async function verifyRequest(req: NextRequest): Promise<{ uid: string }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing authorization');
  }
  const token = authHeader.slice(7);
  const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
  return { uid: decoded.uid };
}

const MIN_WITHDRAWAL_VN = 10000;  // ₹1,000 = 10,000 VN
const MAX_WITHDRAWAL_VN = 5000000; // ₹5,00,000 = 50,00,000 VN
const PLATFORM_FEE_PERCENT = 2;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

// POST — request withdrawal
export async function POST(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const db = getFirestore(getAdminApp());

    const body = await req.json();
    const vnAmount = Math.floor(Number(body.vnAmount || 0));

    if (!Number.isFinite(vnAmount) || vnAmount < MIN_WITHDRAWAL_VN || vnAmount > MAX_WITHDRAWAL_VN) {
      return NextResponse.json(
        { error: `Withdrawal must be between ${MIN_WITHDRAWAL_VN} VN (₹${MIN_WITHDRAWAL_VN / 10}) and ${MAX_WITHDRAWAL_VN} VN (₹${MAX_WITHDRAWAL_VN / 10}).` },
        { status: 400 }
      );
    }

    // Check KYC
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    if (!userData || userData.kycStatus !== 'verified') {
      return NextResponse.json(
        { error: 'KYC verification required before withdrawal.' },
        { status: 403 }
      );
    }

    // Check bank details
    const bankDetails = userData.bankDetails;
    if (!bankDetails?.accountNumber || !bankDetails?.ifsc || !bankDetails?.beneficiaryName) {
      return NextResponse.json(
        { error: 'Bank details required. Please add your bank account in settings.' },
        { status: 400 }
      );
    }

    // Check cooldown — 1 withdrawal per week
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

    // Calculate amounts
    const inrAmount = vnAmount / 10;
    const platformFee = Math.round(inrAmount * PLATFORM_FEE_PERCENT) / 100;
    const netAmount = inrAmount - platformFee;

    // Atomic: check VN balance and deduct
    const result = await db.runTransaction(async (tx) => {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await tx.get(userRef);
      const uData = userSnap.data();
      const currentVn = Number(uData?.vnBalance ?? 0);

      if (currentVn < vnAmount) {
        throw new Error(`Insufficient VN balance. Have ${currentVn}, need ${vnAmount}.`);
      }

      const withdrawalRef = db.collection('withdrawals').doc();
      const now = new Date().toISOString();

      tx.update(userRef, {
        vnBalance: FieldValue.increment(-vnAmount),
      });

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

      // Record transaction
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
    const db = getFirestore(getAdminApp());
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));

    const snap = await db
      .collection('withdrawals')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const withdrawals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ withdrawals });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || 'Failed to fetch withdrawals') }, { status: 500 });
  }
}
