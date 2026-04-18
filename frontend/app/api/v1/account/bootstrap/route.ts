import { getReaderLegalAck } from '../../../../../src/server/account/readerLegalAck';
import { requireServerUser } from '../../../../../src/server/auth/requestAuth';
import { CANONICAL_API_FAMILIES, getReplatformRuntimeSummary } from '../../../../../src/server/replatform/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: Request) => {
  try {
    const user = await requireServerUser(request);
    const ack = await getReaderLegalAck(user.uid);

    return Response.json({
      ok: true,
      user: {
        uid: user.uid,
        email: user.decodedToken.email || null,
        displayName: String(user.userData?.displayName || user.userData?.name || '').trim() || null,
        userId: String(user.userData?.userId || '').trim() || null,
        plan: String(user.userData?.plan || '').trim() || null,
      },
      compliance: {
        kycStatus: String(user.userData?.kycStatus || 'none'),
        agreementSigned: Boolean(user.userData?.agreementSigned),
        readerLegalAck: {
          accepted: Boolean(ack.accepted),
          acceptedAt: String(ack.acceptedAt || ''),
        },
      },
      wallet: {
        vnBalance: Number(user.userData?.vnBalance || 0),
        monthlyFreeRemaining: Number(user.userData?.monthlyFreeRemaining || 0),
        vffBalance: Number(user.userData?.wallet?.vffBalance || 0),
      },
      routes: CANONICAL_API_FAMILIES,
      replatform: getReplatformRuntimeSummary(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to bootstrap account.';
    const status = message === 'Missing authorization' ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};
