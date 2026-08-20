import type { ReactNode } from 'react';

import { AdminWorkspaceShell } from '@/components/admin-workspace-shell';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export default function AdminLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const preview = isFrontendPreviewAvailable();
  return (
    <AdminWorkspaceShell environment={preview ? 'mocked' : 'production'}>
      {children}
    </AdminWorkspaceShell>
  );
}
