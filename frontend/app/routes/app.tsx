import { Outlet } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { loadAuthSession, loadBillingSummary } from './_shared';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const backendEnv = (context as any)?.cloudflare?.env;
  const [session, billing] = await Promise.all([
    loadAuthSession(request, backendEnv),
    loadBillingSummary(request, backendEnv),
  ]);

  return {
    session,
    billing,
  };
}

export function Component() {
  return <Outlet />;
}

export default function AppRoute() {
  return <Outlet />;
}
