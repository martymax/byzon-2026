import { SpeakerQuestionPage } from '@/components/speaker-questions';
export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SpeakerQuestionPage sessionId={sessionId} />;
}
