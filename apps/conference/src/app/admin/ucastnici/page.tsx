import type { Metadata } from 'next';
import { AdminSupportWorkspace } from '@/components/admin-support-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Účastníci | Administrace BYZON' },
};

export default function AdminParticipantsPage() {
  return <AdminSupportWorkspace />;
}
