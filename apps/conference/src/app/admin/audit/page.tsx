import type { Metadata } from 'next';
import { AdminAuditWorkspace } from '@/components/admin-reservation-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Historie změn | Administrace BYZON' },
};

export default function AdminAuditPage() {
  return <AdminAuditWorkspace />;
}
