import { redirect } from 'next/navigation';

import { resolveSafeInternalNextPath, type AuthRouteMode } from '../../../../src/app/navigation';
import { normalizeLoginRouteMode } from '../../../../src/shared/auth/signupLock';

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

export default function AppLoginPage({
  searchParams,
}: {
  searchParams?: AppLoginSearchParams;
}) {
  const requestedMode = toSingleValue(searchParams?.mode);
  const requestedNext = resolveSafeInternalNextPath(toSingleValue(searchParams?.next), null);
  const initialMode = normalizeLoginRouteMode(requestedMode) as AuthRouteMode | undefined;

  const params = new URLSearchParams();
  if (initialMode) {
    params.set('mode', initialMode);
  }
  if (requestedNext) {
    params.set('next', requestedNext);
  }

  const suffix = params.toString();
  redirect(suffix ? `/login?${suffix}` : '/login');
}
