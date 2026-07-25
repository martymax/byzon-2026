import { AdminAnnouncementWorkspace } from '@/components/admin-announcement-workspace';
import { requireAdminFrontendPreview } from '@/lib/admin-frontend-preview';

export default function AdminAnnouncementsPage() {
  requireAdminFrontendPreview();
  return <AdminAnnouncementWorkspace />;
}
