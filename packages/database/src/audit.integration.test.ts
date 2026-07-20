import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { writeAuditLog } from './audit.js';
import { createDatabaseClient } from './client.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('audit helper integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-audit-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const userId = generateUuidV7();
  const requestId = generateUuidV7();
  const email = 'audit-person@example.invalid';
  const secret = 'raw-audit-secret';

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `audit-helper-${eventId}`,
      name: 'Audit helper integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:30:00Z'),
      timezone: 'Europe/Prague',
    });
    await client.db.insert(schema.users).values({
      id: userId,
      name: 'Audit integration user',
      email,
    });
  });

  afterAll(async () => {
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.close();
  });

  it('does not persist raw secrets or PII in any free-form audit field', async () => {
    await writeAuditLog(client.db, {
      eventId,
      actorId: userId,
      actorType: 'user',
      action: 'audit.redaction_tested',
      targetType: 'event_membership',
      targetId: email,
      requestId,
      reason: `Requested by ${email} with Bearer ${secret}`,
      before: {
        firstName: 'Anna',
        contactEmail: email,
        nested: { password: secret },
      },
      after: {
        state: 'complete',
        note: `Notify ${email}`,
        safeUserId: userId,
      },
    });

    const audit = await client.db.query.auditLogs.findFirst({
      where: eq(schema.auditLogs.requestId, requestId),
    });
    expect(audit).toBeDefined();
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Anna');
    expect(serialized).toContain(userId);
    expect(audit).toMatchObject({
      actorId: userId,
      action: 'audit.redaction_tested',
      targetId: '[REDACTED]',
      before: {
        firstName: '[REDACTED]',
        contactEmail: '[REDACTED]',
        nested: { password: '[REDACTED]' },
      },
      after: {
        state: 'complete',
        safeUserId: userId,
      },
    });
  });
});
