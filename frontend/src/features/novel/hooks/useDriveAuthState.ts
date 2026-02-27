import { useCallback } from 'react';
import {
  connectDriveIdentity,
  getDriveProviderToken,
  reconsentDriveScopes,
} from '../../../../services/driveAuthService';
import { verifyDriveAccess } from '../../../../services/novelDriveService';

export const useDriveAuthState = () => {
  const probeDriveToken = useCallback(async () => {
    const auth = await getDriveProviderToken();
    if (!auth.ok || !auth.token) return auth;
    const access = await verifyDriveAccess(auth.token);
    return {
      ...auth,
      ok: access.ok,
      message: access.message,
    };
  }, []);

  return {
    probeDriveToken,
    connectDriveIdentity,
    reconsentDriveScopes,
  };
};
