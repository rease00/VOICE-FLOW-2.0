'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AppAccountPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/app/profile');
  }, [router]);

  return null;
}
