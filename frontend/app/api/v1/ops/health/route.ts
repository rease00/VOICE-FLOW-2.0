import { getReplatformRuntimeSummary } from '../../../../../src/server/replatform/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  return Response.json({
    ok: true,
    service: 'voice-flow-next-control-plane',
    runtime: getReplatformRuntimeSummary(),
    checkedAt: new Date().toISOString(),
  });
};
