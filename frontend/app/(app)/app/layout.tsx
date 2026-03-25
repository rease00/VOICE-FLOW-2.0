import type { ReactNode } from 'react';
import './app-shell.css';

export default function WorkspaceShellLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
