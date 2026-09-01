import type { Metadata } from 'next';
import { AdminOperationsWorkspace } from '@/components/admin-operations-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Reporty | Administrace BYZON' },
};

export default function AdminReportsPage() {
  return <AdminOperationsWorkspace />;
}
