import { LoginRouteClient } from './LoginRouteClient';
import { resolveSafeInternalNextPath, type AuthRouteMode } from '../../../../src/app/navigation';

type LoginSearchParams = Record<string, string | string[] | undefined>;

interface AppLoginPageProps {
  searchParams?: LoginSearchParams;
}

const readFirstSearchParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim() || null;
  }
  return String(value || '').trim() || null;
};

export const dynamic = 'force-dynamic';

export default function AppLoginPage({ searchParams }: AppLoginPageProps) {
  const requestedMode = readFirstSearchParam(searchParams?.mode);
  const requestedNext = resolveSafeInternalNextPath(readFirstSearchParam(searchParams?.next), null);
  const initialMode: AuthRouteMode | undefined =
    requestedMode === 'signup' || requestedMode === 'login' ? requestedMode : undefined;

  return (
    <LoginRouteClient
      {...(requestedNext ? { nextPath: requestedNext } : {})}
      {...(initialMode ? { initialMode } : {})}
    />
  );
}
