'use client';

import { useUser } from '../../../../src/features/auth/context/UserContext';
import { resolveSurface, readCachedFlag, DEFAULT_UI_V2_FLAG } from '../../../../src/features/feature-flags/uiV2';
import { ReaderShellV2 } from '../../../../src/features/reader/v2/ReaderShellV2';
import { redirect } from 'next/navigation';

export default function ReaderV2Page() {
  const { user, authReady, isAuthenticated } = useUser();
  const flag = readCachedFlag() ?? DEFAULT_UI_V2_FLAG;
  const useV2 = resolveSurface(user?.uid ?? null, flag, 'reader');

  // If v2 flag not enabled, redirect to legacy reader (library)
  if (authReady && !useV2) {
    redirect('/app/library');
  }

  // Determine paid status (can be wired to billing context later)
  const isPaid = true; // TODO: wire to billing context

  if (!isAuthenticated) {
    return null; // Auth gate handled by layout
  }

  return <ReaderShellV2 paid={isPaid} />;
}
