import { QuestionForm } from '@/components/live-interactions';

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <section className="app-page">
      <QuestionForm sessionId={sessionId} />
    </section>
  );
}
