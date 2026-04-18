import { resolveSafeInternalNextPath, type AuthRouteMode } from '../../../../src/app/navigation';
import { normalizeLoginRouteMode } from '../../../../src/shared/auth/signupLock';
import { LoginRouteClient } from './LoginRouteClient';

const readFirstSearchParam = (value: string | null | undefined): string | null =>
  String(value || '').trim() || null;

type AppLoginSearchParams = {
  mode?: string | string[];
  next?: string | string[];
};

const toSingleValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return readFirstSearchParam(value[0]);
  }
  return readFirstSearchParam(value);
};

export default async function AppLoginPage({
  searchParams,
}: {
  searchParams?: Promise<AppLoginSearchParams>;
}) {
  const resolved = (await searchParams) ?? undefined;
  const requestedMode = toSingleValue(resolved?.mode);
  const requestedNext = resolveSafeInternalNextPath(toSingleValue(resolved?.next), null);
  const initialMode = normalizeLoginRouteMode(requestedMode) as AuthRouteMode | undefined;

  return <LoginRouteClient {...(initialMode !== undefined ? { initialMode } : {})} nextPath={requestedNext} />;
}
