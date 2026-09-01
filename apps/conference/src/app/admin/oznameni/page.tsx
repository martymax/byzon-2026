import type { Metadata } from 'next';
import { AdminAnnouncementWorkspace } from '@/components/admin-announcement-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Oznámení | Administrace BYZON' },
};

export default function AdminAnnouncementsPage() {
  return <AdminAnnouncementWorkspace />;
}
