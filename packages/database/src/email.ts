import { and, eq } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from './client.js';
import { generateUuidV7 } from './ids.js';
import {
  emailDeliveries,
  emailMessages,
  participantProfiles,
} from './schema/index.js';

/** Save content before network I/O. A confirmed send also fences a later retry. */
export const sendRecordedEmail = async (
  db: Database,
  message: Omit<
    typeof emailMessages.$inferInsert,
    'id' | 'createdAt' | 'sentAt'
  >,
  send: () => Promise<void>,
  now: Date = new Date(),
): Promise<void> => {
  await db
    .insert(emailMessages)
    .values({ ...message, id: generateUuidV7(), createdAt: now })
    .onConflictDoNothing({
      target: [emailMessages.eventId, emailMessages.deduplicationKey],
    });
  const condition = and(
    eq(emailMessages.eventId, message.eventId),
    eq(emailMessages.deduplicationKey, message.deduplicationKey),
  );
  const saved = await db.query.emailMessages.findFirst({ where: condition });
  if (!saved) throw new Error('Email archive unavailable');
  if (saved.sentAt) return;
  await send();
  await db.update(emailMessages).set({ sentAt: now }).where(condition);
};

export interface QueueEmailInput {
  eventId: string;
  userId: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  now: Date;
  expiresAt: Date;
  availableAt?: Date;
}
/** Must be called inside the transaction which makes the corresponding state change. */
export const enqueueEmailDelivery = async (
  transaction: DatabaseTransaction,
  input: QueueEmailInput,
): Promise<void> => {
  const profile = await transaction.query.participantProfiles.findFirst({
    columns: { userId: true },
    where: and(
      eq(participantProfiles.eventId, input.eventId),
      eq(participantProfiles.userId, input.userId),
    ),
  });
  if (!profile) return;
  await transaction
    .insert(emailDeliveries)
    .values({
      id: generateUuidV7(),
      eventId: input.eventId,
      userId: input.userId,
      deduplicationKey: input.deduplicationKey,
      payload: input.payload,
      createdAt: input.now,
      availableAt: input.availableAt ?? input.now,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: [
        emailDeliveries.eventId,
        emailDeliveries.userId,
        emailDeliveries.deduplicationKey,
      ],
    });
};
