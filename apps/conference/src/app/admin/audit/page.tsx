import type { Metadata } from 'next';
import { AdminReservationWorkspace } from '@/components/admin-reservation-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Historie změn | Administrace BYZON' },
};

export default function AdminAuditPage() {
  return <AdminReservationWorkspace />;
}
