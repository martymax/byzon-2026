import type { Metadata } from 'next';

import { AdminContentProductionWorkspace } from '@/components/admin-content-production-workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: { absolute: 'Řečníci | Administrace BYZON' },
};

export default function AdminSpeakersPage() {
  return (
    <AdminContentProductionWorkspace
      initialResource="speakers"
      speakerFocused
    />
  );
}
