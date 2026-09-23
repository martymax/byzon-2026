import type { Metadata } from 'next';
import { feedbackRespondentsQuerySchema } from '@byzon/domain/contracts';
import { AdminFeedbackRespondents } from '@/components/admin-feedback-respondents';
export const metadata: Metadata = {
  title: { absolute: 'Hodnocení podle účastníků | Administrace BYZON' },
};
export default async function FeedbackRespondentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = feedbackRespondentsQuerySchema.safeParse(await searchParams);
  return (
    <AdminFeedbackRespondents
      initialQuery={
        parsed.success ? parsed.data : feedbackRespondentsQuerySchema.parse({})
      }
    />
  );
}
