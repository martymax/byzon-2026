import type { Metadata } from 'next';
import { AdminSettingsWorkspace } from '@/components/admin-reservation-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Nastavení akce | Administrace BYZON' },
};

export default function AdminSettingsPage() {
  return <AdminSettingsWorkspace />;
}
