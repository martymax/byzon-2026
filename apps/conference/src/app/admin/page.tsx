import type { Metadata } from 'next';
import { AdminOverviewWorkspace } from '@/components/admin-overview-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Přehled akce | Administrace BYZON' },
};

export default function AdminOverviewPage() {
  return <AdminOverviewWorkspace />;
}
