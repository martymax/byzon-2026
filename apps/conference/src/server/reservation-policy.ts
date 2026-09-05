import {
  acquireTransactionLock,
  type DatabaseTransaction,
} from '@byzon/database';
import { sql } from 'drizzle-orm';

export const coachingReservationLockKey = (
  eventId: string,
  userId: string,
): string => `coaching-reservation:${eventId}:${userId}`;

export const acquireCoachingReservationLock = (
  transaction: DatabaseTransaction,
  eventId: string,
  userId: string,
): Promise<void> =>
  acquireTransactionLock(
    transaction,
    coachingReservationLockKey(eventId, userId),
  );

export const tryAcquireCoachingReservationLock = async (
  transaction: DatabaseTransaction,
  eventId: string,
  userId: string,
): Promise<boolean> => {
  const result = await transaction.execute<{ acquired: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${coachingReservationLockKey(eventId, userId)}, 0)) as "acquired"`,
  );
  return result.rows[0]?.acquired === true;
};
