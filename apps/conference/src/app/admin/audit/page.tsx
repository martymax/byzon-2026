import type { Metadata } from 'next';
import { AdminAuditRedesign } from '@/components/admin-audit-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Historie změn | Administrace BYZON' },
};

export default function AdminAuditPage() {
  return <AdminAuditRedesign />;
}
