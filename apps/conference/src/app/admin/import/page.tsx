import { redirect } from 'next/navigation';

import { requireAdminFrontendPreview } from '@/lib/admin-frontend-preview';

export default function AdminImportPage() {
  requireAdminFrontendPreview();
  redirect('/admin/vstupenky');
}
