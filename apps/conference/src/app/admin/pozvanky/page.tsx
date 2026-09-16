import type { Metadata } from 'next';
import { AdminInvitationsWorkspace } from '@/components/admin-invitations-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Pozvánky | Administrace BYZON' },
};

export default function AdminInvitationsPage() {
  return <AdminInvitationsWorkspace />;
}
