import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  invitationCandidateConditions,
  invitationCandidateQuery,
  invitationDelivery,
  schema,
  sendRecordedEmail,
  writeAuditLog,
  type Database,
} from '@byzon/database';
import {
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  createAuthEmail,
} from '@byzon/mail';
import type { MailTransport } from '@byzon/mail/transport';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';

const jobs = schema.invitationDeliveries;
const DAY = 24 * 60 * 60_000;
const LEASE_MS = 120_000; // Longer than the transport's 30 s hard deadline.
const MAX_ATTEMPTS = 8;
type Job = typeof jobs.$inferSelect;
type Outcome = 'idle' | 'delivered' | 'skipped' | 'retried' | 'failed';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const owned = (job: Job) =>
  and(
    eq(jobs.id, job.id),
    eq(jobs.leaseToken, job.leaseToken!),
    eq(jobs.status, 'processing'),
  );

async function claim(db: Database, now: Date) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, ['pending', 'processing']),
          lte(jobs.availableAt, now),
        ),
      )
      .orderBy(asc(jobs.availableAt), asc(jobs.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!candidate) return null;
    const [job] = await tx
      .update(jobs)
      .set({
        status: 'processing',
        attempts: candidate.attempts + 1,
        leaseToken: randomUUID(),
        availableAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(eq(jobs.id, candidate.id))
      .returning();
    return job ?? null;
  });
}

async function finish(
  db: Database,
  job: Job,
  status: 'delivered' | 'failed' | 'skipped',
  reason: string | null,
  now: Date,
): Promise<Outcome> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(jobs)
      .set({ status, finishedAt: now, leaseToken: null, lastError: reason })
      .where(owned(job))
      .returning({ id: jobs.id });
    if (updated.length && status === 'delivered') {
      const batch = await tx.query.invitationBatches.findFirst({
        where: eq(schema.invitationBatches.id, job.batchId),
      });
      await writeAuditLog(
        tx,
        {
          eventId: job.eventId,
          actorId: batch?.createdBy ?? null,
          actorType: 'system',
          action: `${job.delivery}.invitation_sent`,
          targetType: job.delivery === 'team' ? 'team_member' : 'participant',
          targetId: job.userId,
          requestId: job.id,
          after: { batchId: job.batchId },
        },
        { occurredAt: now },
      );
    }
  });
  return status;
}

/** One durable job. Network I/O never holds a database transaction open. */
export async function dispatchInvitationOnce(
  db: Database,
  transport: MailTransport,
  options: { appOrigin: string; secret: string; sender: string | null },
  now = new Date(),
): Promise<Outcome> {
  const job = await claim(db, now);
  if (!job) return 'idle';
  try {
    const deduplicationKey = `invitation:${job.id}`;
    const archived = await db.query.emailMessages.findFirst({
      columns: { sentAt: true },
      where: and(
        eq(schema.emailMessages.eventId, job.eventId),
        eq(schema.emailMessages.deduplicationKey, deduplicationKey),
      ),
    });
    // Recover a crash after SMTP confirmation was recorded but before job completion.
    if (archived?.sentAt) return finish(db, job, 'delivered', null, now);
    if (job.attempts > MAX_ATTEMPTS)
      return finish(db, job, 'failed', 'attempts_exhausted', now);
    if (now.getTime() - job.createdAt.getTime() >= DAY)
      return finish(db, job, 'failed', 'queue_expired', now);
    const event = await db.query.events.findFirst({
      where: eq(schema.events.id, job.eventId),
    });
    if (
      !job.userId ||
      !event ||
      event.status === 'archived' ||
      (event.operationalDataAnonymizesAt &&
        event.operationalDataAnonymizesAt <= now)
    )
      return finish(db, job, 'skipped', 'access_changed', now);
    const [recipient] = await invitationCandidateQuery(db, job.eventId).where(
      and(
        invitationCandidateConditions(job.eventId),
        eq(schema.users.id, job.userId),
      ),
    );
    if (
      !recipient ||
      invitationDelivery(recipient.roles, recipient.participantReady) !==
        job.delivery
    )
      return finish(db, job, 'skipped', 'access_changed', now);
    const recipientHash = hash(recipient.email);
    if (job.recipientHash && job.recipientHash !== recipientHash)
      return finish(db, job, 'skipped', 'recipient_changed', now);
    // Reconstruct the same opaque token on retries; store only Better Auth's SHA-256
    // base64url identifier. Domain separation binds the token to this job/address.
    const token = createHmac('sha256', options.secret)
      .update(`byzon-invitation-v1:${job.id}:${job.eventId}:${recipient.email}`)
      .digest('base64url');
    const tokenHash = createHash('sha256').update(token).digest('base64url');
    if (job.tokenHash && job.tokenHash !== tokenHash)
      return finish(db, job, 'failed', 'signing_key_changed', now);
    if (!job.preparedAt) {
      const prepared = await db.transaction(async (tx) => {
        const updated = await tx
          .update(jobs)
          .set({ preparedAt: now, recipientHash, tokenHash })
          .where(owned(job))
          .returning({ id: jobs.id });
        if (!updated.length) return false;
        await tx
          .insert(schema.verifications)
          .values({
            id: job.id,
            identifier: tokenHash,
            value: JSON.stringify({ email: recipient.email }),
            expiresAt: new Date(
              now.getTime() + ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS * 1000,
            ),
          });
        return true;
      });
      if (!prepared) return 'skipped';
    } else {
      const verification = await db.query.verifications.findFirst({
        where: eq(schema.verifications.id, job.id),
      });
      // Never resurrect a used or expired login token when recovering a job.
      if (!verification || verification.expiresAt <= now)
        return finish(db, job, 'skipped', 'link_used_or_expired', now);
    }
    const profile = await db.query.participantProfiles.findFirst({
      columns: { firstName: true, emailSalutation: true },
      where: and(
        eq(schema.participantProfiles.eventId, job.eventId),
        eq(schema.participantProfiles.userId, job.userId),
      ),
    });
    const origin = new URL(options.appOrigin).origin;
    const url = new URL('/api/auth/magic-link/verify', origin);
    url.searchParams.set('token', token);
    url.searchParams.set(
      'callbackURL',
      job.delivery === 'team' ? '/admin' : '/app',
    );
    url.searchParams.set(
      'errorCallbackURL',
      job.delivery === 'team'
        ? '/prihlaseni?returnTo=%2Fadmin'
        : '/prihlaseni?mode=recovery&returnTo=%2Fapp',
    );
    const contentInput = {
      purpose:
        job.delivery === 'team'
          ? ('team-invitation' as const)
          : ('participant-invitation' as const),
      appOrigin: origin,
      roles: recipient.roles,
      expiresInSeconds: ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
      firstName:
        profile?.firstName ?? recipient.displayName.split(' ')[0] ?? null,
      emailSalutation: profile?.emailSalutation ?? null,
    };
    const content = createAuthEmail({ ...contentInput, url: url.href });
    const safeContent = createAuthEmail({
      ...contentInput,
      url: `${origin}/prihlaseni#jednorazovy-odkaz-skryt`,
    });
    // Refresh the lease and fence a worker that lost ownership before network I/O.
    const leased = await db
      .update(jobs)
      .set({
        availableAt: new Date(Math.max(now.getTime(), Date.now()) + LEASE_MS),
      })
      .where(owned(job))
      .returning({ id: jobs.id });
    if (!leased.length) return 'skipped';
    await sendRecordedEmail(
      db,
      {
        eventId: job.eventId,
        userId: job.userId,
        deduplicationKey,
        kind: contentInput.purpose,
        recipient: recipient.email,
        sender: options.sender,
        ...safeContent,
      },
      () =>
        transport.send({
          to: recipient.email,
          ...content,
          category: 'auth',
          idempotencyKey: `byzon-invitation-${job.id}`,
        }),
      now,
    );
    return finish(db, job, 'delivered', null, now);
  } catch {
    if (job.attempts >= MAX_ATTEMPTS)
      return finish(db, job, 'failed', 'delivery_failed', now);
    await db
      .update(jobs)
      .set({
        status: 'pending',
        leaseToken: null,
        lastError: 'delivery_retry',
        availableAt: new Date(
          now.getTime() +
            Math.min(30 * 60_000, 30_000 * 2 ** (job.attempts - 1)),
        ),
      })
      .where(owned(job));
    return 'retried';
  }
}
