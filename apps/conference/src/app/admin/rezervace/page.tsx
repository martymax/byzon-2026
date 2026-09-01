import type { Metadata } from 'next';
import { AdminReservationsWorkspace } from '@/components/admin-reservation-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Rezervace a kapacity | Administrace BYZON' },
};

export default function AdminReservationsPage() {
  return <AdminReservationsWorkspace />;
}
