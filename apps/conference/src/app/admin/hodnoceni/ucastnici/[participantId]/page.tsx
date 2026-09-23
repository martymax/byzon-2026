import type { Metadata } from 'next';
import { feedbackRespondentsQuerySchema } from '@byzon/domain/contracts';
import { AdminFeedbackRespondents } from '@/components/admin-feedback-respondents';
export const metadata: Metadata = {
  title: { absolute: 'Odpovědi účastníka | Administrace BYZON' },
};
export default async function FeedbackRespondentPage({
  params,
  searchParams,
}: {
  params: Promise<{ participantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = feedbackRespondentsQuerySchema.safeParse(await searchParams);
  return (
    <AdminFeedbackRespondents
      participantId={(await params).participantId}
      initialQuery={
        parsed.success ? parsed.data : feedbackRespondentsQuerySchema.parse({})
      }
    />
  );
}
