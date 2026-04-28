'use client';

import type { ReactNode } from 'react';

type RouterBoundaryProps = Readonly<{
  initialPath: string;
  children: ReactNode;
}>;

export function RouterBoundary({ initialPath, children }: RouterBoundaryProps) {
  void initialPath;
  return <>{children}</>;
}
