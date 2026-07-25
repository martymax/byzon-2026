import { eq } from 'drizzle-orm';
import { schema } from '@byzon/database';
import { createHash } from 'node:crypto';

import { database } from './database';

export const CURRENT_EVENT_SLUG = 'byzon-2026';

export type CurrentEventStatus =
  'draft' | 'activation_open' | 'live' | 'ended' | 'archived';

export type CurrentEvent = {
  endsAt: Date;
  id: string;
  startsAt: Date;
  status: CurrentEventStatus;
  timezone: string;
};

export type ParticipantVisibleEventStatus = Exclude<
  CurrentEventStatus,
  'archived' | 'draft'
>;

export type ParticipantVisibleCurrentEvent = Omit<CurrentEvent, 'status'> & {
  status: ParticipantVisibleEventStatus;
};

export type ParticipantCurrentEventState =
  | {
      kind: 'available';
      event: ParticipantVisibleCurrentEvent;
    }
  | { kind: 'archived' }
  | { kind: 'unavailable' };

const PARTICIPANT_ACCOUNT_SCOPE_DOMAIN =
  'byzon:participant-account-scope:v1\u0000';

export const participantAccountEventFingerprint = (eventId: string): string =>
  createHash('sha256')
    .update(`${PARTICIPANT_ACCOUNT_SCOPE_DOMAIN}${eventId}`, 'utf8')
    .digest('hex');

export type ParticipantLayoutEventContext =
  | {
      currentEvent: Extract<
        ParticipantCurrentEventState,
        { kind: 'available' | 'unavailable' }
      >;
    }
  | {
      currentEvent: Extract<ParticipantCurrentEventState, { kind: 'archived' }>;
      eventFingerprint: string;
    };

export const isParticipantVisibleEventStatus = (
  status: CurrentEventStatus,
): status is ParticipantVisibleEventStatus =>
  status !== 'draft' && status !== 'archived';

export const projectParticipantVisibleEvent = (
  event: CurrentEvent | null,
): ParticipantVisibleCurrentEvent | null => {
  if (!event || !isParticipantVisibleEventStatus(event.status)) return null;
  return { ...event, status: event.status };
};

export const projectParticipantCurrentEventState = (
  event: CurrentEvent | null,
): ParticipantCurrentEventState => {
  if (!event || event.status === 'draft') return { kind: 'unavailable' };
  if (event.status === 'archived') return { kind: 'archived' };
  return {
    event: { ...event, status: event.status },
    kind: 'available',
  };
};

export const projectParticipantLayoutEventContext = (
  event: CurrentEvent | null,
): ParticipantLayoutEventContext => {
  const currentEvent = projectParticipantCurrentEventState(event);
  if (currentEvent.kind === 'archived') {
    if (!event) {
      return { currentEvent: { kind: 'unavailable' } };
    }
    return {
      currentEvent,
      eventFingerprint: participantAccountEventFingerprint(event.id),
    };
  }
  return { currentEvent };
};

export const loadCurrentEventId = async (): Promise<string | null> => {
  const event = await database.db.query.events.findFirst({
    where: eq(schema.events.slug, CURRENT_EVENT_SLUG),
    columns: { id: true, status: true },
  });
  return event && isParticipantVisibleEventStatus(event.status)
    ? event.id
    : null;
};

export const loadCurrentEvent = async (): Promise<CurrentEvent | null> => {
  const event = await database.db.query.events.findFirst({
    where: eq(schema.events.slug, CURRENT_EVENT_SLUG),
    columns: {
      endsAt: true,
      id: true,
      startsAt: true,
      status: true,
      timezone: true,
    },
  });
  return event ?? null;
};

export const loadParticipantCurrentEvent =
  async (): Promise<ParticipantCurrentEventState> =>
    projectParticipantCurrentEventState(await loadCurrentEvent());

export const loadParticipantLayoutEventContext =
  async (): Promise<ParticipantLayoutEventContext> =>
    projectParticipantLayoutEventContext(await loadCurrentEvent());
