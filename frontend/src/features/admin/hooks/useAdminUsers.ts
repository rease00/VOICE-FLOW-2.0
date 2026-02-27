import { useCallback, useMemo, useState } from 'react';
import {
  type AdminUserSummary,
  fetchAdminUsers,
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
      const rows = await fetchAdminUsers(baseUrl, { q: query, limit });
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
    resetAdminUserPassword: (uid: string, password: string) => resetAdminUserPassword(uid, password, baseUrl),
    revokeAdminUserSessions: (uid: string) => revokeAdminUserSessions(uid, baseUrl),
    deleteAdminUser: (uid: string) => deleteAdminUser(uid, baseUrl),
  };
};
