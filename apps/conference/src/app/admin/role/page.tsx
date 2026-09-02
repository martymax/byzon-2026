import type { Metadata } from 'next';
import { AdminTeamRedesign } from '@/components/admin-team-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Tým a oprávnění | Administrace BYZON' },
};

export default function AdminRolesPage() {
  return <AdminTeamRedesign />;
}
