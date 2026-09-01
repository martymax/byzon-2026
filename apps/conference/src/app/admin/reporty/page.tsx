import type { Metadata } from 'next';
import { AdminReportsWorkspace } from '@/components/admin-operations-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Reporty | Administrace BYZON' },
};

export default function AdminReportsPage() {
  return <AdminReportsWorkspace />;
}
