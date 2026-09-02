import type { Metadata } from 'next';
import { AdminReportsRedesign } from '@/components/admin-reports-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Reporty | Administrace BYZON' },
};

export default function AdminReportsPage() {
  return <AdminReportsRedesign />;
}
