import { getReplatformContractInventory } from '../../../../../src/server/replatform/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  return Response.json(getReplatformContractInventory());
};
