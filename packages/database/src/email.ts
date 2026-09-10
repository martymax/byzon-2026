import { and, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from './client.js';
import { generateUuidV7 } from './ids.js';
import { emailDeliveries, participantProfiles } from './schema/index.js';

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
