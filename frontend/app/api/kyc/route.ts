import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../../../src/server/firebaseAdmin';

async function verifyToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);
  return getFirebaseAdminAuth().verifyIdToken(token);
}

function sanitize(input: string): string {
  return input.replace(/["`${}]/g, '');
}

function verifyVeriffSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = typeof body.action === 'string' ? sanitize(body.action) : '';

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 });
    }

    if (action === 'veriff-callback') {
      return handleVeriffWebhook(req, body);
    }

    const decoded = await verifyToken(req);
    const uid = decoded.uid;
    const db = getFirebaseAdminFirestore();

    if (action === 'create-session') {
      let session: { id: string; url: string; status: string };

      if (process.env.VERIFF_API_KEY) {
        const veriffRes = await fetch('https://stationapi.veriff.com/v1/sessions', {
          method: 'POST',
          headers: {
            'X-AUTH-CLIENT': process.env.VERIFF_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            verification: {
              callback: process.env.VERIFF_CALLBACK_URL || '',
              person: { firstName: 'User', lastName: uid.slice(0, 8) },
              vendorData: uid,
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!veriffRes.ok) {
          const errData = await veriffRes.json().catch(() => ({}));
          return NextResponse.json(
            { error: 'Veriff session creation failed', details: errData },
            { status: 502 },
          );
        }

        const veriffData = await veriffRes.json();
        session = {
          id: veriffData.verification?.id || veriffData.id,
          url: veriffData.verification?.url || veriffData.url || '',
          status: 'pending',
        };
      } else {
        session = {
          id: `dev-session-${uid}`,
          url: '',
          status: 'pending',
        };
      }

      await db.doc(`users/${uid}`).set(
        { kycStatus: 'pending', kycSessionId: session.id },
        { merge: true },
      );

      return NextResponse.json({
        session: { id: session.id, url: session.url, status: 'pending' },
      });
    }

    if (action === 'sign-agreement') {
      const version = typeof body.version === 'string' ? sanitize(body.version) : '';
      if (!version) {
        return NextResponse.json({ error: 'Missing agreement version' }, { status: 400 });
      }

      const agreement = {
        userId: uid,
        version,
        signedAt: new Date().toISOString(),
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        signatureHash: `${uid}:${version}:${Date.now()}`,
      };

      const docRef = await db.collection('agreements').add(agreement);

      await db.doc(`users/${uid}`).set(
        { agreementSigned: true, agreementVersion: version },
        { merge: true },
      );

      return NextResponse.json({
        agreement: { id: docRef.id, ...agreement },
      });
    }

    if (action === 'check-status') {
      const doc = await db.doc(`users/${uid}`).get();
      const data = doc.data();
      return NextResponse.json({
        kycStatus: data?.kycStatus || 'none',
        agreementSigned: !!data?.agreementSigned,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const decoded = await verifyToken(req);
    const uid = decoded.uid;
    const db = getFirebaseAdminFirestore();

    const doc = await db.doc(`users/${uid}`).get();
    const data = doc.data();

    return NextResponse.json({
      kycStatus: data?.kycStatus || 'none',
      agreementSigned: !!data?.agreementSigned,
      agreementVersion: data?.agreementVersion || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

async function handleVeriffWebhook(
  req: NextRequest,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const secret = process.env.VERIFF_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = req.headers.get('x-hmac-signature');
  const rawBody = JSON.stringify(body);

  if (!verifyVeriffSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const verification = body.verification as
    | { id?: string; vendorData?: string; status?: string; code?: number }
    | undefined;

  if (!verification?.vendorData) {
    return NextResponse.json({ error: 'Missing vendor data' }, { status: 400 });
  }

  const uid = sanitize(verification.vendorData);
  const db = getFirebaseAdminFirestore();
  const kycStatus = verification.code === 9001 ? 'verified' : 'rejected';

  await db.doc(`users/${uid}`).set(
    { kycStatus, kycVerifiedAt: new Date().toISOString() },
    { merge: true },
  );

  return NextResponse.json({ status: 'ok' });
}
