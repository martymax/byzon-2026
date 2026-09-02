import type { Metadata } from 'next';
import { AdminReservationsRedesign } from '@/components/admin-reservations-redesign';

export const metadata: Metadata = {
  title: { absolute: 'Rezervace a kapacity | Administrace BYZON' },
};

export default function AdminReservationsPage() {
  return <AdminReservationsRedesign />;
}
