import type { UserProfile } from '../../../types';

type AdminActor = UserProfile['adminActor'];

export const hasActiveAdminActor = (actor: AdminActor): boolean => {
  if (!actor) return false;
  if (String(actor.status || '').trim().toLowerCase() === 'disabled') return false;
  return Array.isArray(actor.permissions) && actor.permissions.some((permission) => String(permission || '').trim().length > 0);
};

export const hasAdminConsoleAccess = (
  user: Pick<UserProfile, 'isAdmin' | 'adminActor'> | null | undefined
): boolean => Boolean(user?.isAdmin) || hasActiveAdminActor(user?.adminActor);
