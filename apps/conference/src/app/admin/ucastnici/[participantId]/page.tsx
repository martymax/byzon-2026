import type { Metadata } from 'next';

import { AdminParticipantDetailWorkspace } from '@/components/admin-support-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Detail účastníka | Administrace BYZON' },
};

export default async function AdminParticipantDetailPage({
  params,
}: {
  readonly params: Promise<{ participantId: string }>;
}) {
  const { participantId } = await params;
  return <AdminParticipantDetailWorkspace participantId={participantId} />;
}
