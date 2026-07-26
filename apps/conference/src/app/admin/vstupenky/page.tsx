import { AdminImportWorkspace } from '@/components/admin-import-workspace';
import { requireAdminFrontendPreview } from '@/lib/admin-frontend-preview';

export default function AdminTicketsPage() {
  requireAdminFrontendPreview();
  return <AdminImportWorkspace />;
}
