import { AdminOverviewWorkspace } from '@/components/admin-overview-workspace';
import { requireAdminFrontendPreview } from '@/lib/admin-frontend-preview';

export default function AdminOverviewPage() {
  requireAdminFrontendPreview();
  return <AdminOverviewWorkspace />;
}
