import { describe, expect, it } from 'vitest';

import {
  announcementInboxQuerySchema,
  participantAnnouncementCachePolicy,
  participantAnnouncementDetailProblemSchema,
  participantAnnouncementDetailResponseSchema,
  participantAnnouncementInboxProblemSchema,
  participantAnnouncementInboxResponseSchema,
  participantAnnouncementReadProblemSchema,
  participantAnnouncementReadResponseSchema,
  problemTypeForCode,
} from './index.js';

const ids = {
  event: '01920000-0000-7000-8000-000000000001',
  first: '01920000-0000-7000-8000-000000000002',
  second: '01920000-0000-7000-8000-000000000003',
  session: '01920000-0000-7000-8000-000000000004',
} as const;

const firstSummary = {
  id: ids.first,
  title: 'Změna sálu',
  summary: 'Workshop proběhne v sále Vltava.',
  severity: 'critical' as const,
  publishedAt: '2026-09-19T08:00:00.000Z',
  readAt: null,
  context: {
    kind: 'session' as const,
    session: {
      id: ids.session,
      title: 'Růst bez zkratek',
    },
  },
};

const secondSummary = {
  id: ids.second,
  title: 'Hlavní vstup dočasně uzavřen',
  summary: 'Pokračujte k hlavnímu vstupu.',
  severity: 'critical' as const,
  publishedAt: '2026-09-18T08:00:00.000Z',
  readAt: '2026-09-18T08:05:00.000Z',
  context: { kind: 'event' as const },
};

const inbox = {
  eventId: ids.event,
  items: [firstSummary, secondSummary],
  pageInfo: { nextCursor: null, hasMore: false },
  unreadCount: 1,
};

const problem = <
  Code extends
    | 'ANNOUNCEMENT_NOT_FOUND'
    | 'ANNOUNCEMENTS_DISABLED'
    | 'IDEMPOTENCY_IN_PROGRESS',
>(
  code: Code,
  status: Code extends 'ANNOUNCEMENT_NOT_FOUND' ? 404 : 409,
) => ({
  type: problemTypeForCode(code),
  title: 'Announcement problem',
  status,
  code,
  detail: 'The announcement request could not be completed.',
  requestId: 'request-announcement-0001',
});

describe('CS-ANN-01 participant contracts', () => {
  it('validates a bounded inbox query and rejects unknown input fields', () => {
    expect(
      announcementInboxQuerySchema.parse({
        filter: 'unread',
        cursor: 'opaque-page-2',
        limit: 25,
      }),
    ).toEqual({
      filter: 'unread',
      cursor: 'opaque-page-2',
      limit: 25,
    });
    expect(
      announcementInboxQuerySchema.safeParse({
        filter: 'all',
        limit: 51,
      }).success,
    ).toBe(false);
    expect(
      announcementInboxQuerySchema.safeParse({
        filter: 'all',
        audienceId: ids.event,
      }).success,
    ).toBe(false);
  });

  it('validates newest-first unique summaries and private cache policy', () => {
    expect(participantAnnouncementInboxResponseSchema.parse(inbox)).toEqual(
      inbox,
    );
    expect(
      participantAnnouncementInboxResponseSchema.parse({
        ...inbox,
        pageInfo: { nextCursor: 'opaque-page-2', hasMore: true },
      }).pageInfo,
    ).toEqual({ nextCursor: 'opaque-page-2', hasMore: true });
    expect(participantAnnouncementCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      offline: 'forbidden',
      readMutation: 'online-only',
    });

    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        items: [secondSummary, firstSummary],
      }).success,
    ).toBe(false);
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        items: [firstSummary, firstSummary],
        unreadCount: 2,
      }).success,
    ).toBe(false);
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        items: [{ ...firstSummary, severity: 'urgent' }, secondSummary],
      }).success,
    ).toBe(false);
    for (const removedSeverity of ['info', 'important']) {
      expect(
        participantAnnouncementInboxResponseSchema.safeParse({
          ...inbox,
          items: [
            { ...firstSummary, severity: removedSeverity },
            secondSummary,
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        unreadCount: 0,
      }).success,
    ).toBe(false);
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        unreadCount: 1_000,
      }).success,
    ).toBe(false);
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        items: [
          firstSummary,
          {
            ...secondSummary,
            readAt: '2026-09-18T07:59:59.000Z',
          },
        ],
      }).success,
    ).toBe(false);

    const samePublicationTime = '2026-09-19T08:00:00.000Z';
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        items: [
          {
            ...secondSummary,
            publishedAt: samePublicationTime,
            readAt: '2026-09-19T08:05:00.000Z',
          },
          {
            ...firstSummary,
            publishedAt: samePublicationTime,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        items: [
          {
            ...firstSummary,
            publishedAt: samePublicationTime,
          },
          {
            ...secondSummary,
            publishedAt: samePublicationTime,
            readAt: '2026-09-19T08:05:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      participantAnnouncementInboxResponseSchema.safeParse({
        ...inbox,
        pageInfo: { nextCursor: 'opaque-page-2', hasMore: false },
      }).success,
    ).toBe(false);
  });

  it('keeps detail text plain and excludes audience, sender and delivery data', () => {
    const detail = {
      eventId: ids.event,
      announcement: {
        ...firstSummary,
        bodyText: 'Workshop se přesouvá do sálu Vltava. Čas začátku se nemění.',
      },
    };

    expect(participantAnnouncementDetailResponseSchema.parse(detail)).toEqual(
      detail,
    );
    expect(
      participantAnnouncementDetailResponseSchema.safeParse({
        ...detail,
        announcement: {
          ...detail.announcement,
          bodyText: '<strong>Unsafe HTML</strong>',
        },
      }).success,
    ).toBe(false);
    expect(
      participantAnnouncementDetailResponseSchema.safeParse({
        ...detail,
        announcement: {
          ...detail.announcement,
          audience: ['participant-1'],
          senderEmail: 'organizer@example.test',
          delivery: { providerId: 'private-provider-id' },
        },
      }).success,
    ).toBe(false);
  });

  it('validates a strict canonical read response', () => {
    const read = {
      eventId: ids.event,
      announcementId: ids.first,
      state: 'read' as const,
      readAt: '2026-09-19T08:05:00.000Z',
      unreadCount: 0,
    };

    expect(participantAnnouncementReadResponseSchema.parse(read)).toEqual(read);
    expect(
      participantAnnouncementReadResponseSchema.safeParse({
        ...read,
        recipientId: 'must-not-cross-the-contract',
      }).success,
    ).toBe(false);
  });

  it('enumerates endpoint problems and keeps audience denial behind safe 404', () => {
    expect(
      participantAnnouncementInboxProblemSchema.parse(
        problem('ANNOUNCEMENTS_DISABLED', 409),
      ).code,
    ).toBe('ANNOUNCEMENTS_DISABLED');
    expect(
      participantAnnouncementDetailProblemSchema.parse(
        problem('ANNOUNCEMENT_NOT_FOUND', 404),
      ).code,
    ).toBe('ANNOUNCEMENT_NOT_FOUND');
    expect(
      participantAnnouncementReadProblemSchema.parse(
        problem('IDEMPOTENCY_IN_PROGRESS', 409),
      ).code,
    ).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(
      participantAnnouncementDetailProblemSchema.safeParse({
        ...problem('ANNOUNCEMENT_NOT_FOUND', 404),
        type: problemTypeForCode('ANNOUNCEMENT_AUDIENCE_DENIED'),
        code: 'ANNOUNCEMENT_AUDIENCE_DENIED',
      }).success,
    ).toBe(false);
    expect(
      participantAnnouncementInboxProblemSchema.safeParse(
        problem('ANNOUNCEMENT_NOT_FOUND', 404),
      ).success,
    ).toBe(false);
  });
});
