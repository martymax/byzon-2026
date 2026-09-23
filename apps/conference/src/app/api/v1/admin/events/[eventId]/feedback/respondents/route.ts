import { handleAdminConferenceFeedback } from '@/server/conference-feedback';
import { conferenceFeedbackDependencies } from '@/server/conference-feedback-runtime';
export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string; participantId?: string }> },
) =>
  context.params.then(({ eventId, participantId }) =>
    handleAdminConferenceFeedback(
      request,
      eventId,
      conferenceFeedbackDependencies,
      'respondents',
      participantId,
    ),
  );
