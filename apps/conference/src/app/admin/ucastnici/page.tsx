import { AdminSupportWorkspace } from '@/components/admin-support-workspace';
import { requireAdminFrontendPreview } from '@/lib/admin-frontend-preview';

export default function AdminParticipantsPage() {
  requireAdminFrontendPreview();
  return <AdminSupportWorkspace />;
}
