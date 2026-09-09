import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  and,
  eq,
  inArray,
  is,
  isNull,
  like,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { getTableConfig, PgTable, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { ApiProblemError } from './api/problem';
import { promoteAutomaticWaitlist } from './reservation-waitlist';

const scoped = (
  event: AnyPgColumn,
  user: AnyPgColumn,
  eventId: string,
  userId: string,
) => and(eq(event, eventId), eq(user, userId))!;

/** Inspect every declared FK before removing a shared membership/account.
 * New references default to preservation, never an accidental cascade.
 */
const hasReferences = async (
  tx: DatabaseTransaction,
  target: PgTable,
  values: Record<string, string>,
  ignored: readonly PgTable[] = [],
) => {
  const queries: SQL[] = [];
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable) || ignored.includes(table)) continue;
    for (const key of getTableConfig(table).foreignKeys) {
      const reference = key.reference();
      if (reference.foreignTable !== target) continue;
      const conditions = reference.columns.map((column, index) =>
        eq(column, values[reference.foreignColumns[index]!.name]!),
      );
      queries.push(sql`select 1 from ${table} where ${and(...conditions)}`);
    }
  }
  if (!queries.length) return false;
  const result = await tx.execute<{ found: boolean }>(
    sql`select exists (${sql.join(queries, sql` union all `)}) as found`,
  );
  return result.rows[0]?.found === true;
};

// Match complete JSON scalar values, including nested arrays. Never match an
// order ID: one order may contain tickets for several different people.
const jsonReferences = (column: AnyPgColumn, ids: readonly string[]) =>
  sql`exists (
    select 1 from jsonb_path_query(${column}, '$.** ? (@.type() == "string")') as scalar(value)
    where scalar.value #>> '{}' = any(${sql.param([...ids])}::text[])
  )`;

export const deleteParticipantData = async (
  tx: DatabaseTransaction,
  input: {
    eventId: string;
    participantId: string;
    expectedProfileVersion: number;
    now: Date;
    requestId: string;
  },
) => {
  const { eventId, participantId, now, requestId } = input;
  // Same order as agenda/support mutations; content lock serializes capacity
  // transitions and waitlist promotion across the event.
  await acquireTransactionLock(
    tx,
    `participant-profile:${eventId}:${participantId}`,
  );
  await acquireTransactionLock(
    tx,
    `identity-profile:${eventId}:${participantId}`,
  );
  await acquireTransactionLock(
    tx,
    `participant-invitation:${eventId}:${participantId}`,
  );
  await acquireTransactionLock(
    tx,
    `participant-agenda:${eventId}:${participantId}`,
  );
  await acquireTransactionLock(tx, `content-publish:${eventId}`);
  // Freeze audience creation/sending before taking membership row locks.
  await acquireTransactionLock(tx, `announcement-audience:${eventId}`);
  await acquireTransactionLock(tx, `operational-export:${eventId}`);

  const [profile] = await tx
    .select()
    .from(schema.participantProfiles)
    .where(
      scoped(
        schema.participantProfiles.eventId,
        schema.participantProfiles.userId,
        eventId,
        participantId,
      ),
    )
    .for('update');
  const event = await tx.query.events.findFirst({
    where: eq(schema.events.id, eventId),
  });
  if (!profile || !event)
    throw new ApiProblemError({
      status: 404,
      code: 'SUPPORT_RECORD_NOT_FOUND',
      title: 'Participant not found',
      detail: 'The participant is unavailable.',
    });
  if (event.status === 'archived')
    throw new ApiProblemError({
      status: 409,
      code: 'SUPPORT_INVALID_TRANSITION',
      title: 'Archived event',
      detail: 'Archived participants are read-only.',
    });
  if (profile.version !== input.expectedProfileVersion)
    throw new ApiProblemError({
      status: 409,
      code: 'STALE_VERSION',
      title: 'Participant changed',
      detail: 'Reload the participant before deleting.',
      currentVersion: profile.version,
    });

  // Block concurrent FK inserts while removing the participation and identity.
  const [user] = await tx
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, participantId))
    .for('update');
  await tx
    .select()
    .from(schema.eventMemberships)
    .where(
      scoped(
        schema.eventMemberships.eventId,
        schema.eventMemberships.userId,
        eventId,
        participantId,
      ),
    )
    .for('update');

  const tickets = await tx
    .select()
    .from(schema.tickets)
    .where(
      scoped(
        schema.tickets.eventId,
        schema.tickets.holderUserId,
        eventId,
        participantId,
      ),
    )
    .for('update');
  const sources = await tx
    .select()
    .from(schema.ticketSourceParticipants)
    .where(
      scoped(
        schema.ticketSourceParticipants.eventId,
        schema.ticketSourceParticipants.userId,
        eventId,
        participantId,
      ),
    );
  const reservations = await tx
    .select()
    .from(schema.reservations)
    .where(
      scoped(
        schema.reservations.eventId,
        schema.reservations.userId,
        eventId,
        participantId,
      ),
    );
  const sessionIds = [
    ...new Set(
      reservations
        .filter((row) => row.status === 'confirmed')
        .map((row) => row.sessionId),
    ),
  ].sort();
  for (const sessionId of sessionIds) {
    await acquireTransactionLock(
      tx,
      `participant-reservation:${eventId}:${sessionId}`,
    );
  }
  const ticketIds = tickets.map((row) => row.id);
  const relatedIds = new Set([
    participantId,
    ...ticketIds,
    ...sources.map((row) => row.id),
    ...reservations.map((row) => row.id),
  ]);
  const remember = (rows: { id: string }[]) =>
    rows.forEach((row) => relatedIds.add(row.id));

  // Delete both historical and active records, even if a team role means the
  // membership must survive. Do not rely on membership cascades for this.
  remember(
    await tx
      .delete(schema.waitlistEntries)
      .where(
        scoped(
          schema.waitlistEntries.eventId,
          schema.waitlistEntries.userId,
          eventId,
          participantId,
        ),
      )
      .returning({ id: schema.waitlistEntries.id }),
  );
  await tx
    .delete(schema.reservations)
    .where(
      scoped(
        schema.reservations.eventId,
        schema.reservations.userId,
        eventId,
        participantId,
      ),
    );
  await tx
    .delete(schema.participantAgendas)
    .where(
      scoped(
        schema.participantAgendas.eventId,
        schema.participantAgendas.userId,
        eventId,
        participantId,
      ),
    );
  // Answer publication locks its question first. Lock all owned questions
  // before collecting answer IDs so a concurrent reply cannot escape cleanup.
  const questions = await tx
    .select({ id: schema.questions.id })
    .from(schema.questions)
    .where(
      scoped(
        schema.questions.eventId,
        schema.questions.authorUserId,
        eventId,
        participantId,
      ),
    )
    .orderBy(schema.questions.id)
    .for('update');
  remember(
    await tx
      .select({ id: schema.questionAnswers.id })
      .from(schema.questionAnswers)
      .where(
        and(
          eq(schema.questionAnswers.eventId, eventId),
          inArray(
            schema.questionAnswers.questionId,
            questions.map((row) => row.id),
          ),
        ),
      ),
  );
  remember(
    await tx
      .delete(schema.questions)
      .where(
        scoped(
          schema.questions.eventId,
          schema.questions.authorUserId,
          eventId,
          participantId,
        ),
      )
      .returning({ id: schema.questions.id }),
  );
  remember(
    await tx
      .delete(schema.ratings)
      .where(
        scoped(
          schema.ratings.eventId,
          schema.ratings.userId,
          eventId,
          participantId,
        ),
      )
      .returning({ id: schema.ratings.id }),
  );
  remember(
    await tx
      .delete(schema.consentRecords)
      .where(
        scoped(
          schema.consentRecords.eventId,
          schema.consentRecords.userId,
          eventId,
          participantId,
        ),
      )
      .returning({ id: schema.consentRecords.id }),
  );
  remember(
    await tx
      .delete(schema.privacyRequests)
      .where(
        scoped(
          schema.privacyRequests.eventId,
          schema.privacyRequests.userId,
          eventId,
          participantId,
        ),
      )
      .returning({ id: schema.privacyRequests.id }),
  );
  await tx
    .delete(schema.announcementRecipients)
    .where(
      scoped(
        schema.announcementRecipients.eventId,
        schema.announcementRecipients.userId,
        eventId,
        participantId,
      ),
    );
  // Invalidate frozen previews as well as fixing their recipient counts. The
  // send path shares this lock and will reject the old preview version.
  const previews = await tx
    .select({ id: schema.announcementPreviews.id })
    .from(schema.announcementPreviews)
    .where(
      and(
        eq(schema.announcementPreviews.eventId, eventId),
        sql`${schema.announcementPreviews.recipientUserIds} @> ${JSON.stringify([participantId])}::jsonb`,
      ),
    )
    .orderBy(schema.announcementPreviews.id);
  for (const preview of previews) {
    await acquireTransactionLock(
      tx,
      `announcement-preview:${eventId}:${preview.id}`,
    );
    await tx
      .update(schema.announcementPreviews)
      .set({
        recipientUserIds: sql`${schema.announcementPreviews.recipientUserIds} - ${participantId}`,
        recipientCount: sql`jsonb_array_length(${schema.announcementPreviews.recipientUserIds} - ${participantId})`,
        version: sql`${schema.announcementPreviews.version} + 1`,
      })
      .where(
        and(
          eq(schema.announcementPreviews.id, preview.id),
          eq(schema.announcementPreviews.eventId, eventId),
        ),
      );
  }

  remember(
    await tx
      .delete(schema.checkIns)
      .where(
        and(
          eq(schema.checkIns.eventId, eventId),
          or(
            eq(schema.checkIns.holderUserId, participantId),
            inArray(schema.checkIns.ticketId, ticketIds),
          ),
        ),
      )
      .returning({ id: schema.checkIns.id }),
  );
  remember(
    await tx
      .delete(schema.checkinLookups)
      .where(
        and(
          eq(schema.checkinLookups.eventId, eventId),
          inArray(schema.checkinLookups.ticketId, ticketIds),
        ),
      )
      .returning({ id: schema.checkinLookups.id }),
  );
  remember(
    await tx
      .delete(schema.ticketEvents)
      .where(
        and(
          eq(schema.ticketEvents.eventId, eventId),
          inArray(schema.ticketEvents.ticketId, ticketIds),
        ),
      )
      .returning({ id: schema.ticketEvents.id }),
  );
  // Transfer successors belong to someone else. Preserve them and detach only
  // the reference to the deleted source ticket.
  await tx
    .update(schema.tickets)
    .set({ transferredFromTicketId: null })
    .where(
      and(
        eq(schema.tickets.eventId, eventId),
        inArray(schema.tickets.transferredFromTicketId, ticketIds),
      ),
    );
  const externalIds = [
    ...new Set(
      [
        ...tickets.map((row) => row.externalId),
        ...sources.map((row) => row.externalId),
      ].filter((value): value is string => value !== null),
    ),
  ];
  remember(
    await tx
      .delete(schema.ticketImportRows)
      .where(
        and(
          eq(schema.ticketImportRows.eventId, eventId),
          or(
            inArray(schema.ticketImportRows.externalId, externalIds),
            inArray(
              schema.ticketImportRows.codeHmac,
              tickets.map((row) => row.codeHmac),
            ),
          ),
        ),
      )
      .returning({ id: schema.ticketImportRows.id }),
  );
  await tx
    .delete(schema.tickets)
    .where(
      and(
        eq(schema.tickets.eventId, eventId),
        inArray(schema.tickets.id, ticketIds),
      ),
    );
  await tx
    .delete(schema.ticketSourceParticipants)
    .where(
      scoped(
        schema.ticketSourceParticipants.eventId,
        schema.ticketSourceParticipants.userId,
        eventId,
        participantId,
      ),
    );
  remember(
    await tx
      .delete(schema.eventRoles)
      .where(
        and(
          eq(schema.eventRoles.eventId, eventId),
          eq(schema.eventRoles.userId, participantId),
          eq(schema.eventRoles.role, 'participant'),
        ),
      )
      .returning({ id: schema.eventRoles.id }),
  );
  remember(
    await tx
      .delete(schema.emailDeliveries)
      .where(
        scoped(
          schema.emailDeliveries.eventId,
          schema.emailDeliveries.userId,
          eventId,
          participantId,
        ),
      )
      .returning({ id: schema.emailDeliveries.id }),
  );
  await tx
    .delete(schema.participantProfiles)
    .where(
      scoped(
        schema.participantProfiles.eventId,
        schema.participantProfiles.userId,
        eventId,
        participantId,
      ),
    );

  const ids = [...relatedIds];
  await tx
    .delete(schema.outboxEvents)
    .where(
      and(
        eq(schema.outboxEvents.eventId, eventId),
        or(
          inArray(schema.outboxEvents.aggregateId, ids),
          jsonReferences(schema.outboxEvents.payload, ids),
        ),
      ),
    );
  // Cached mutation receipts can contain whole profiles. Leave the current
  // deletion receipt intact; executeIdempotentMutation fills it after cleanup.
  await tx
    .delete(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.eventId, eventId),
        ne(schema.idempotencyKeys.scope, 'participant.delete'),
        or(
          and(
            eq(schema.idempotencyKeys.actorId, participantId),
            or(
              like(schema.idempotencyKeys.scope, 'identity.%'),
              like(schema.idempotencyKeys.scope, 'questions.submit.%'),
              like(schema.idempotencyKeys.scope, 'ratings.submit.%'),
              eq(schema.idempotencyKeys.scope, 'participant.agenda-action'),
            ),
          ),
          inArray(schema.idempotencyKeys.resultReference, ids),
          jsonReferences(schema.idempotencyKeys.responseBody, ids),
        ),
      ),
    );
  // Personal actions can target a shared session rather than the participant.
  // Anonymize their actor even when the identity survives in another event or
  // role. Team operations retain their original authorship.
  await tx
    .update(schema.auditLogs)
    .set({
      actorId: null,
      targetId: null,
      reason: null,
      before: null,
      after: { participantDeleted: true },
    })
    .where(
      and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.actorId, participantId),
        or(
          like(schema.auditLogs.action, 'agenda.%'),
          inArray(schema.auditLogs.action, [
            'reservation.created',
            'reservation.cancelled',
            'waitlist.joined',
            'waitlist.left',
            'onboarding.completed',
            'profile.updated',
            'privacy.deletion_requested',
            'networking.opt_in',
            'networking.opt_out',
            'session.logout_current',
            'session.logout_all',
            'session.switch_account',
          ]),
        ),
      ),
    );
  // Keep operational history, but remove the deleted subject and snapshots.
  await tx
    .update(schema.auditLogs)
    .set({
      targetId: null,
      reason: null,
      before: null,
      after: { participantDeleted: true },
    })
    .where(
      and(
        eq(schema.auditLogs.eventId, eventId),
        or(
          inArray(schema.auditLogs.targetId, ids),
          jsonReferences(schema.auditLogs.before, ids),
          jsonReferences(schema.auditLogs.after, ids),
        ),
      ),
    );
  // A ready audit export is a snapshot of now-redacted history. Expire it;
  // queued exports are generated from the cleaned data by the worker.
  await tx
    .update(schema.operationalExportRequests)
    .set({
      state: 'expired',
      content: null,
      contentType: null,
      checksumSha256: null,
      objectKey: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.operationalExportRequests.eventId, eventId),
        eq(schema.operationalExportRequests.report, 'audit_log'),
        eq(schema.operationalExportRequests.state, 'ready'),
      ),
    );

  const otherRole = await tx.query.eventRoles.findFirst({
    where: and(
      eq(schema.eventRoles.eventId, eventId),
      eq(schema.eventRoles.userId, participantId),
      ne(schema.eventRoles.role, 'participant'),
      isNull(schema.eventRoles.revokedAt),
    ),
  });
  if (!otherRole) {
    // Optional authorship/ownership links must not keep a participant-only
    // account alive. Preserve the shared records and detach their author.
    await tx
      .update(schema.ticketEvents)
      .set({ actorId: null })
      .where(
        scoped(
          schema.ticketEvents.eventId,
          schema.ticketEvents.actorId,
          eventId,
          participantId,
        ),
      );
    await tx
      .update(schema.eventFeatures)
      .set({ updatedBy: null })
      .where(
        scoped(
          schema.eventFeatures.eventId,
          schema.eventFeatures.updatedBy,
          eventId,
          participantId,
        ),
      );
    await tx
      .update(schema.eventOperationalSettings)
      .set({ updatedBy: null })
      .where(
        scoped(
          schema.eventOperationalSettings.eventId,
          schema.eventOperationalSettings.updatedBy,
          eventId,
          participantId,
        ),
      );
    await tx
      .update(schema.eventRoles)
      .set({ grantedBy: null })
      .where(
        scoped(
          schema.eventRoles.eventId,
          schema.eventRoles.grantedBy,
          eventId,
          participantId,
        ),
      );
    await tx
      .update(schema.assets)
      .set({ ownerUserId: null })
      .where(
        scoped(
          schema.assets.eventId,
          schema.assets.ownerUserId,
          eventId,
          participantId,
        ),
      );
    await tx
      .update(schema.speakerProfiles)
      .set({ userId: null })
      .where(
        scoped(
          schema.speakerProfiles.eventId,
          schema.speakerProfiles.userId,
          eventId,
          participantId,
        ),
      );
  }
  const membershipRetained =
    !!otherRole ||
    (await hasReferences(tx, schema.eventMemberships, {
      event_id: eventId,
      user_id: participantId,
    }));
  if (membershipRetained) {
    if (!otherRole)
      await tx
        .update(schema.eventMemberships)
        .set({
          status: 'revoked',
          revokedAt: now,
          revocationReason: 'participant_deleted',
          offlineRevocationEpoch: generateUuidV7(),
        })
        .where(
          scoped(
            schema.eventMemberships.eventId,
            schema.eventMemberships.userId,
            eventId,
            participantId,
          ),
        );
  } else {
    await tx
      .delete(schema.eventMemberships)
      .where(
        scoped(
          schema.eventMemberships.eventId,
          schema.eventMemberships.userId,
          eventId,
          participantId,
        ),
      );
  }
  const accountDeleted = !(await hasReferences(
    tx,
    schema.users,
    { id: participantId },
    [
      schema.sessions,
      schema.accounts,
      schema.idempotencyKeys,
      schema.auditLogs,
    ],
  ));
  if (accountDeleted) {
    // Better Auth magic-link identifiers are hashed tokens; the recipient is
    // inside the JSON value (other verification kinds need not contain JSON).
    await tx.delete(schema.verifications).where(
      or(
        eq(schema.verifications.identifier, user!.email),
        eq(schema.verifications.value, participantId),
        sql`case when ${schema.verifications.value} is json object
          then lower(${schema.verifications.value}::jsonb ->> 'email') = ${user!.email.toLowerCase()}
          else false end`,
      ),
    );
    // Sessions/accounts cascade; shared history only loses its actor pointer.
    await tx.delete(schema.users).where(eq(schema.users.id, participantId));
  }
  for (const sessionId of sessionIds)
    await promoteAutomaticWaitlist({
      transaction: tx,
      eventId,
      sessionId,
      now,
      requestId,
      generateId: generateUuidV7,
    });
  return { accountDeleted, membershipRetained };
};
