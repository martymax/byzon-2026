import { AdminReservationWorkspace } from '@/components/admin-reservation-workspace';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export default function AdminReservationsPage() {
  return (
    <AdminReservationWorkspace
      mode={isFrontendPreviewAvailable() ? 'full' : 'reservations'}
    />
  );
}
