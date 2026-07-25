import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('./database', () => ({
  database: {
    db: {
      query: {
        events: {
          findFirst: databaseMocks.findFirst,
        },
      },
    },
  },
}));

import {
  isParticipantVisibleEventStatus,
  loadCurrentEventId,
  loadParticipantCurrentEvent,
  loadParticipantLayoutEventContext,
  participantAccountEventFingerprint,
  projectParticipantCurrentEventState,
  projectParticipantLayoutEventContext,
  projectParticipantVisibleEvent,
  type CurrentEvent,
} from './current-event';

const privateMetadataEvent = (
  status: CurrentEvent['status'],
): CurrentEvent => ({
  endsAt: new Date('2037-03-04T05:06:07.000Z'),
  id: '20000000-0000-4000-8000-000000000099',
  startsAt: new Date('2037-03-01T02:03:04.000Z'),
  status,
  timezone: 'Private/Timezone',
});

describe('participant current-event projection', () => {
  beforeEach(() => {
    databaseMocks.findFirst.mockReset();
  });

  it.each(['draft', 'archived'] as const)(
    'projects %s events to no participant-visible data',
    (status) => {
      expect(isParticipantVisibleEventStatus(status)).toBe(false);
      expect(projectParticipantVisibleEvent(privateMetadataEvent(status))).toBe(
        null,
      );
    },
  );

  it('projects a draft to a metadata-free unavailable state', () => {
    const state = projectParticipantCurrentEventState(
      privateMetadataEvent('draft'),
    );

    expect(state).toEqual({ kind: 'unavailable' });
    expect(JSON.stringify(state)).not.toContain(
      '20000000-0000-4000-8000-000000000099',
    );
    expect(JSON.stringify(state)).not.toContain('Private/Timezone');
  });

  it('projects an archive to a metadata-free explicit state', () => {
    const state = projectParticipantCurrentEventState(
      privateMetadataEvent('archived'),
    );

    expect(state).toEqual({ kind: 'archived' });
    expect(JSON.stringify(state)).not.toContain(
      '20000000-0000-4000-8000-000000000099',
    );
    expect(JSON.stringify(state)).not.toContain('Private/Timezone');
  });

  it('projects an archive account scope to a domain-separated opaque fingerprint', () => {
    const event = privateMetadataEvent('archived');
    const context = projectParticipantLayoutEventContext(event);

    expect(context).toEqual({
      currentEvent: { kind: 'archived' },
      eventFingerprint:
        'ff9fc8aa82960b6ac8d3f7a3fac7c1792551991151a70f64d8d6e07beeeed3c2',
    });
    if (!('eventFingerprint' in context)) {
      throw new TypeError('Expected archived participant layout context.');
    }
    expect(context.eventFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(context.eventFingerprint).toBe(
      participantAccountEventFingerprint(event.id),
    );
    expect(JSON.stringify(context)).not.toContain(event.id);
    expect(JSON.stringify(context)).not.toContain(event.timezone);
  });

  it.each(['activation_open', 'live', 'ended'] as const)(
    'keeps %s events participant-visible',
    (status) => {
      const event = privateMetadataEvent(status);
      expect(isParticipantVisibleEventStatus(status)).toBe(true);
      expect(projectParticipantVisibleEvent(event)).toEqual(event);
    },
  );

  it.each(['draft', 'archived'] as const)(
    'does not return the event ID for a %s row',
    async (status) => {
      databaseMocks.findFirst.mockResolvedValueOnce(
        privateMetadataEvent(status),
      );

      await expect(loadCurrentEventId()).resolves.toBeNull();
      expect(databaseMocks.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          columns: { id: true, status: true },
        }),
      );
    },
  );

  it('returns only a metadata-free unavailable state for a draft', async () => {
    databaseMocks.findFirst.mockResolvedValueOnce(
      privateMetadataEvent('draft'),
    );

    await expect(loadParticipantCurrentEvent()).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('returns only a metadata-free archive state for an archived event', async () => {
    databaseMocks.findFirst.mockResolvedValueOnce(
      privateMetadataEvent('archived'),
    );

    await expect(loadParticipantCurrentEvent()).resolves.toEqual({
      kind: 'archived',
    });
  });

  it('loads an archived layout fingerprint without returning raw event metadata', async () => {
    const event = privateMetadataEvent('archived');
    databaseMocks.findFirst.mockResolvedValueOnce(event);

    const context = await loadParticipantLayoutEventContext();

    expect(context).toEqual({
      currentEvent: { kind: 'archived' },
      eventFingerprint:
        'ff9fc8aa82960b6ac8d3f7a3fac7c1792551991151a70f64d8d6e07beeeed3c2',
    });
    expect(JSON.stringify(context)).not.toContain(event.id);
    expect(JSON.stringify(context)).not.toContain(event.timezone);
  });

  it('returns a visible event and ID during participant lifecycle phases', async () => {
    const event = privateMetadataEvent('live');
    databaseMocks.findFirst
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(event);

    await expect(loadCurrentEventId()).resolves.toBe(event.id);
    await expect(loadParticipantCurrentEvent()).resolves.toEqual({
      event,
      kind: 'available',
    });
  });
});
