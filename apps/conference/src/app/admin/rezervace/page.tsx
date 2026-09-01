import type { Metadata } from 'next';
import { AdminReservationWorkspace } from '@/components/admin-reservation-workspace';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export const metadata: Metadata = {
  title: { absolute: 'Rezervace a kapacity | Administrace BYZON' },
};

export default function AdminReservationsPage() {
  return (
    <AdminReservationWorkspace
      mode={isFrontendPreviewAvailable() ? 'full' : 'reservations'}
    />
  );
}
