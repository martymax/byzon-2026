import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createDatabaseClient,
  withTransaction,
  type DatabaseTransaction,
} from './client.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('agenda roster-source schema integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-agenda-schema-integration-test',
    onUnexpectedError: vi.fn(),
  });

  const insertEventGraph = async (
    transaction: DatabaseTransaction,
    options: { secondUser?: boolean; secondEvent?: boolean } = {},
  ) => {
    const eventId = generateUuidV7();
    const isolationEventId = generateUuidV7();
    const userId = generateUuidV7();
    const secondUserId = generateUuidV7();
    const dayId = generateUuidV7();
    const sessionId = generateUuidV7();
    await transaction.insert(schema.events).values([
      {
        id: eventId,
        slug: `agenda-schema-${eventId}`,
        name: 'Agenda schema event',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T16:30:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
      ...(options.secondEvent
        ? [
            {
              id: isolationEventId,
              slug: `agenda-schema-isolation-${isolationEventId}`,
              name: 'Agenda schema isolation event',
              startsAt: new Date('2026-10-01T08:00:00Z'),
              endsAt: new Date('2026-10-01T16:00:00Z'),
              timezone: 'Europe/Prague',
              status: 'live' as const,
            },
          ]
        : []),
    ]);
    await transaction.insert(schema.users).values([
      {
        id: userId,
        name: 'Agenda schema user',
        email: `${userId}@example.invalid`,
      },
      ...(options.secondUser
        ? [
            {
              id: secondUserId,
              name: 'Second agenda schema user',
              email: `${secondUserId}@example.invalid`,
            },
          ]
        : []),
    ]);
    await transaction
      .insert(schema.eventMemberships)
      .values([
        { eventId, userId, status: 'active' },
        ...(options.secondUser
          ? [{ eventId, userId: secondUserId, status: 'active' as const }]
          : []),
        ...(options.secondEvent
          ? [{ eventId: isolationEventId, userId, status: 'active' as const }]
          : []),
      ]);
    await transaction.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Agenda schema day',
      sortOrder: 0,
    });
    await transaction.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: `agenda-schema-session-${sessionId}`,
      title: 'Agenda schema session',
      type: 'workshop',
      startsAt: new Date('2026-09-18T08:00:00Z'),
      endsAt: new Date('2026-09-18T09:00:00Z'),
      status: 'published',
      capacityMode: 'reservation',
      capacity: 20,
      sortOrder: 0,
    });
    return { eventId, isolationEventId, userId, secondUserId, sessionId };
  };

  afterAll(async () => {
    await client.close();
  });

  it('rejects a cross-event reservation/session relationship', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const graph = await insertEventGraph(transaction, {
          secondEvent: true,
        });
        await transaction.insert(schema.reservations).values({
          id: generateUuidV7(),
          eventId: graph.isolationEventId,
          sessionId: graph.sessionId,
          userId: graph.userId,
          source: 'participant',
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'reservations_session_event_fk',
      }),
    });
  });

  it('keeps one versioned agenda root and one item per participant session', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const graph = await insertEventGraph(transaction);
        await transaction.insert(schema.participantAgendas).values({
          eventId: graph.eventId,
          userId: graph.userId,
        });
        await transaction.insert(schema.agendaItems).values([
          {
            eventId: graph.eventId,
            userId: graph.userId,
            sessionId: graph.sessionId,
          },
          {
            eventId: graph.eventId,
            userId: graph.userId,
            sessionId: graph.sessionId,
            source: 'organizer',
          },
        ]);
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ constraint: 'agenda_items_pk' }),
    });
  });

  it('rejects cross-event agenda items and agenda roots without membership', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const graph = await insertEventGraph(transaction, {
          secondEvent: true,
        });
        await transaction.insert(schema.participantAgendas).values({
          eventId: graph.isolationEventId,
          userId: graph.userId,
        });
        await transaction.insert(schema.agendaItems).values({
          eventId: graph.isolationEventId,
          userId: graph.userId,
          sessionId: graph.sessionId,
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'agenda_items_session_event_fk',
      }),
    });

    await expect(
      withTransaction(client.db, async (transaction) => {
        const graph = await insertEventGraph(transaction);
        await transaction.insert(schema.participantAgendas).values({
          eventId: graph.eventId,
          userId: graph.secondUserId,
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'participant_agendas_membership_event_fk',
      }),
    });
  });

  it('allows at most one active reservation per event, session and user', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const graph = await insertEventGraph(transaction);
        await transaction.insert(schema.reservations).values([
          {
            id: generateUuidV7(),
            eventId: graph.eventId,
            sessionId: graph.sessionId,
            userId: graph.userId,
            source: 'participant',
          },
          {
            id: generateUuidV7(),
            eventId: graph.eventId,
            sessionId: graph.sessionId,
            userId: graph.userId,
            source: 'organizer',
          },
        ]);
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'reservations_active_user_session_unique',
      }),
    });
  });

  it('keeps FIFO positions unique and enforces waitlist state timestamps', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const graph = await insertEventGraph(transaction, { secondUser: true });
        await transaction.insert(schema.waitlistEntries).values([
          {
            id: generateUuidV7(),
            eventId: graph.eventId,
            sessionId: graph.sessionId,
            userId: graph.userId,
            positionSequence: 1,
          },
          {
            id: generateUuidV7(),
            eventId: graph.eventId,
            sessionId: graph.sessionId,
            userId: graph.secondUserId,
            positionSequence: 1,
          },
        ]);
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'waitlist_entries_session_position_unique',
      }),
    });

    await expect(
      withTransaction(client.db, async (transaction) => {
        const graph = await insertEventGraph(transaction);
        await transaction.insert(schema.waitlistEntries).values({
          id: generateUuidV7(),
          eventId: graph.eventId,
          sessionId: graph.sessionId,
          userId: graph.userId,
          status: 'waiting',
          positionSequence: 1,
          promotedAt: new Date(),
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'waitlist_entries_state_check',
      }),
    });
  });
});
