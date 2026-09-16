import type { Metadata } from 'next';
import { AdminEmailWorkspace } from '@/components/admin-email-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Odeslané e-maily | Administrace BYZON' },
};

export default function AdminEmailPage() {
  return <AdminEmailWorkspace />;
}
