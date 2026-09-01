import type { Metadata } from 'next';
import { AdminOperationsWorkspace } from '@/components/admin-operations-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Tým a oprávnění | Administrace BYZON' },
};

export default function AdminRolesPage() {
  return <AdminOperationsWorkspace />;
}
