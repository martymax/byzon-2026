import { ModeratorQuestionList } from '@/components/live-interactions';

export default async function ModeratorPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ModeratorQuestionList sessionId={sessionId} />;
}
