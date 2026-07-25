import { AdminOperationsWorkspace } from '@/components/admin-operations-workspace';
import { requireAdminFrontendPreview } from '@/lib/admin-frontend-preview';

export default function AdminRolesPage() {
  requireAdminFrontendPreview();
  return <AdminOperationsWorkspace />;
}
