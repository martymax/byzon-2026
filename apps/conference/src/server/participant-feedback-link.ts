import { readConferenceEnv } from '@byzon/config';
import { database } from './database';
import { loadEventPolicy } from './policy';
import { ensureConferenceFeedbackResponse } from './conference-feedback';

export async function participantFeedbackLink(eventId: string, userId: string) {
  const policy = await loadEventPolicy(database.db, { userId }, eventId);
  if (
    !policy?.roles.some((role) =>
      ['participant', 'speaker', 'moderator'].includes(role),
    )
  )
    return null;
  const { token } = await ensureConferenceFeedbackResponse(
    database.db,
    eventId,
    userId,
    readConferenceEnv(process.env).BETTER_AUTH_SECRET,
  );
  return `/hodnoceni/${token}`;
}
