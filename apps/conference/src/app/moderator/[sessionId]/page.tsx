import { redirect } from 'next/navigation';
export default async function ModeratorPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/host/moderace/${encodeURIComponent(sessionId)}`);
}
