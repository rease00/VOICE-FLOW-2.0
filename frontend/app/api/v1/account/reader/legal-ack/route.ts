import {
  buildReaderLegalAckEnvelope,
  getReaderLegalAck,
  setReaderLegalAck,
} from '../../../../../../src/server/account/readerLegalAck';
import { requireServerUser } from '../../../../../../src/server/auth/requestAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: Request) => {
  try {
    const user = await requireServerUser(request);
    const ack = await getReaderLegalAck(user.uid);
    return Response.json(buildReaderLegalAckEnvelope(ack));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load reader legal acknowledgement.';
    const status = message === 'Missing authorization' ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const POST = async (request: Request) => {
  try {
    const user = await requireServerUser(request);
    const body = await request.json().catch(() => null) as { accepted?: boolean } | null;
    const ack = await setReaderLegalAck(user.uid, Boolean(body?.accepted));
    return Response.json({
      ok: true,
      ack,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save reader legal acknowledgement.';
    const status = message === 'Missing authorization' ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};
