import type { Database, DatabaseTransaction } from '@byzon/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adminContentInputSchemas,
  adminContentListColumns,
  handleAdminContent,
} from './admin-content';
import { handleAdminPublication } from './admin-publication';
import { dayContentConflictIssues } from './content-validation';

const eventId = '019fc900-0000-7000-8000-000000000001';
const userId = '019fc900-0000-7000-8000-000000000002';
const origin = 'https://app.byzon.test';

const archivedDatabase = () => {
  const calls: string[] = [];
  const transaction = {
    execute: vi.fn(async () => {
      calls.push('lock');
      return [];
    }),
    query: {
      events: {
        findFirst: vi.fn(async () => {
          calls.push('event-status');
          return { status: 'archived' as const };
        }),
      },
    },
  } as unknown as DatabaseTransaction;
  const db = {
    query: {
      eventMemberships: {
        findFirst: vi.fn(async () => ({ userId })),
      },
    },
    select: vi.fn(() => ({
      from: () => ({
        where: async () => [{ role: 'organizer_admin' as const }],
      }),
    })),
    transaction: vi.fn(
      async (callback: (candidate: DatabaseTransaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  } as unknown as Database;
  return { calls, db };
};

const dependencies = (db: Database) => ({
  allowedOrigin: origin,
  db,
  getSession: async () => ({ user: { id: userId } }),
});

describe('archived admin event write fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects content writes after taking the event publication lock', async () => {
    const { calls, db } = archivedDatabase();
    const response = await handleAdminContent(
      new Request(`${origin}/api`, {
        body: JSON.stringify({
          name: 'Blocked partner',
          slug: 'blocked-partner',
          sortOrder: 0,
        }),
        headers: { 'content-type': 'application/json', origin },
        method: 'POST',
      }),
      eventId,
      'partners',
      null,
      dependencies(db),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ADMIN_INVALID_TRANSITION',
      detail: 'Archived events are read-only.',
    });
    expect(calls).toEqual(['lock', 'event-status']);
  });

  it('rejects publication after taking the same event publication lock', async () => {
    const { calls, db } = archivedDatabase();
    const response = await handleAdminPublication(
      new Request(`${origin}/api`, {
        body: JSON.stringify({
          expectedChecksumSha256: 'a'.repeat(64),
          expectedPreviousVersion: 0,
        }),
        headers: { 'content-type': 'application/json', origin },
        method: 'POST',
      }),
      eventId,
      dependencies(db),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ADMIN_INVALID_TRANSITION',
      detail: 'Archived events are read-only.',
    });
    expect(calls).toEqual(['lock', 'event-status']);
  });

  it('keeps draft input inside the published field limits', () => {
    expect(
      adminContentInputSchemas.partners.safeParse({
        category: 'x'.repeat(129),
        name: 'Partner',
        slug: 'partner',
        sortOrder: 0,
        websiteUrl: 'http://user:secret@example.test',
      }).success,
    ).toBe(false);
    expect(
      adminContentInputSchemas.sessions.safeParse({
        dayId: eventId,
        endsAt: '2026-09-18T11:00:00.000Z',
        roomId: null,
        slug: 'program',
        sortOrder: 0,
        startsAt: '2026-09-18T10:00:00.000Z',
        title: 'x'.repeat(513),
        type: 'talk',
      }).success,
    ).toBe(false);
    expect(
      adminContentInputSchemas.speakers.safeParse({
        firstName: 'x'.repeat(129),
        lastName: 'Novák',
        slug: 'speaker',
        sortOrder: 0,
      }).success,
    ).toBe(false);
  });

  it('projects only explicit admin DTO columns from private content rows', () => {
    expect(Object.keys(adminContentListColumns.speakers).sort()).toEqual(
      [
        'bioMarkdown',
        'company',
        'eventId',
        'firstName',
        'id',
        'jobTitle',
        'lastName',
        'linkedinUrl',
        'slug',
        'sortOrder',
        'status',
        'version',
        'websiteUrl',
      ].sort(),
    );
    expect(adminContentListColumns.speakers).not.toHaveProperty('userId');
    expect(adminContentListColumns.sessions).not.toHaveProperty(
      'reservationOpensAt',
    );
    expect(adminContentListColumns.sessions).not.toHaveProperty('capacity');
    expect(adminContentListColumns.sessions).not.toHaveProperty('waitlistMode');
  });

  it('prevalidates duplicate day dates and sort order as safe conflicts', () => {
    const rows = [
      {
        id: '019fc900-0000-7000-8000-000000000010',
        localDate: '2026-09-18',
        sortOrder: 0,
      },
    ];
    expect(
      dayContentConflictIssues(rows, {
        data: { localDate: '2026-09-18', sortOrder: 0 },
      }),
    ).toEqual(['day:duplicate_local_date', 'day:duplicate_sort_order']);
  });
});
