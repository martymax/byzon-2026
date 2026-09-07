import { HostQuestionPage } from '@/components/host-questions';
export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <HostQuestionPage kind="moderator" sessionId={sessionId} />;
}
