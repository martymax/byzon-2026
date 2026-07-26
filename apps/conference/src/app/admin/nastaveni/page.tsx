import { AdminReservationWorkspace } from '@/components/admin-reservation-workspace';
import { requireAdminFrontendPreview } from '@/lib/admin-frontend-preview';

export default function AdminSettingsPage() {
  requireAdminFrontendPreview();
  return <AdminReservationWorkspace />;
}
