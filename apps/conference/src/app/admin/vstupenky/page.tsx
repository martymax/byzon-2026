import type { Metadata } from 'next';
import { AdminImportWorkspace } from '@/components/admin-import-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Aktualizace vstupenek | Administrace BYZON' },
};

export default function AdminTicketsPage() {
  return <AdminImportWorkspace />;
}
