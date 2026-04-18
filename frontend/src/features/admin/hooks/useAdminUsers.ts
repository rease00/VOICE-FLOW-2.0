import { useCallback, useMemo, useState } from 'react';
import {
  type AdminUserSummary,
  fetchAdminUsers,
  fetchAdminUserVcGrants,
  grantAdminUserVc,
  patchAdminUser,
  resetAdminUserPassword,
  revokeAdminUserSessions,
  deleteAdminUser,
} from '../api/adminApi';

interface UseAdminUsersArgs {
  baseUrl: string;
}

export const useAdminUsers = ({ baseUrl }: UseAdminUsersArgs) => {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (a.email || a.uid).localeCompare(b.email || b.uid)),
    [users]
  );

  const reloadUsers = useCallback(async (query?: string, limit = 120) => {
    setIsLoading(true);
    try {
      const rows = await fetchAdminUsers(baseUrl, {
        limit,
        ...(query ? { q: query } : {}),
      });
      setUsers(rows);
      return rows;
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl]);

  return {
    users,
    sortedUsers,
    isLoadingUsers: isLoading,
    reloadUsers,
    patchAdminUser: (uid: string, patch: Parameters<typeof patchAdminUser>[1]) => patchAdminUser(uid, patch, baseUrl),
    fetchAdminUserVcGrants: (uid: string, options?: { limit?: number }) => fetchAdminUserVcGrants(uid, options, baseUrl),
    grantAdminUserVc: (uid: string, input: Parameters<typeof grantAdminUserVc>[1]) => grantAdminUserVc(uid, input, baseUrl),
    resetAdminUserPassword: (uid: string, password: string) => resetAdminUserPassword(uid, password, baseUrl),
    revokeAdminUserSessions: (uid: string) => revokeAdminUserSessions(uid, baseUrl),
    deleteAdminUser: (uid: string) => deleteAdminUser(uid, baseUrl),
  };
};
