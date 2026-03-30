export const normalizeRuntimeSwitchErrorMessage = (raw: unknown): string => (
  String(raw || '').trim().toLowerCase()
);

export const isRuntimeSwitchUnlockError = (raw: unknown): boolean => {
  const detail = normalizeRuntimeSwitchErrorMessage(raw);
  if (!detail) return false;
  return (
    detail.includes('x-admin-unlock')
    || detail.includes('admin-unlock')
    || detail.includes('admin session unlock')
  );
};

export const isRuntimeSwitchPermissionError = (raw: unknown): boolean => {
  const detail = normalizeRuntimeSwitchErrorMessage(raw);
  if (!detail) return false;
  return (
    detail.includes('missing permission')
    || detail.includes('ops.mutate')
    || detail.includes('permission denied')
    || detail.includes('forbidden')
    || detail.includes('status code 403')
    || detail.includes('(403)')
  );
};

export const buildRuntimeSwitchReadOnlyMessage = (engineLabel: string): string => (
  `${engineLabel} runtime switching is read-only for this account (ops.mutate required).`
);

