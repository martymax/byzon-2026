import { handleConferenceFeedback } from '@/server/conference-feedback';
import { conferenceFeedbackDependencies } from '@/server/conference-feedback-runtime';
const handle = (
  request: Request,
  context: { params: Promise<{ token: string }> },
) =>
  context.params.then(({ token }) =>
    handleConferenceFeedback(request, token, conferenceFeedbackDependencies),
  );
export const GET = handle;
export const PATCH = handle;
export const POST = handle;
