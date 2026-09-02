import { describe, expect, it } from 'vitest';

import {
  adminAnnouncementCachePolicy,
  adminAnnouncementPreviewProblemSchema,
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendHeadersSchema,
  adminAnnouncementSendRequestSchema,
  adminAnnouncementTargetListResponseSchema,
  problemTypeForCode,
} from './index.js';

const ids = {
  event: '019fa300-0000-7000-8000-000000000001',
  session: '019fa300-0000-7000-8000-000000000002',
  preview: '019fa300-0000-7000-8000-000000000003',
} as const;

const draft = {
  title: 'Změna sálu',
  bodyText: 'Workshop se přesouvá do sálu Vltava.',
  severity: 'critical' as const,
  audience: {
    kind: 'session' as const,
    sessionId: ids.session,
  },
};

describe('CS-ANN-01 admin contracts', () => {
  it('validates named session targets and rejects duplicate identifiers', () => {
    const targets = {
      eventId: ids.event,
      options: [
        {
          sessionId: ids.session,
          title: 'Růst bez zkratek',
          startsAt: '2026-07-25T09:30:00.000+02:00',
          roomLabel: 'Sál Vltava',
        },
      ],
    };

    expect(adminAnnouncementTargetListResponseSchema.parse(targets)).toEqual(
      targets,
    );
    expect(
      adminAnnouncementTargetListResponseSchema.safeParse({
        ...targets,
        options: [...targets.options, targets.options[0]],
      }).success,
    ).toBe(false);
    expect(
      adminAnnouncementTargetListResponseSchema.safeParse({
        ...targets,
        assignedSessions: targets.options,
      }).success,
    ).toBe(false);
  });

  it('validates in-app-only draft and immutable audience preview', () => {
    expect(adminAnnouncementPreviewRequestSchema.parse({ draft })).toEqual({
      draft,
    });
    for (const removedSeverity of ['info', 'important']) {
      expect(
        adminAnnouncementPreviewRequestSchema.safeParse({
          draft: { ...draft, severity: removedSeverity },
        }).success,
      ).toBe(false);
    }
    const preview = {
      eventId: ids.event,
      previewId: ids.preview,
      previewVersion: 2,
      draft,
      audience: {
        recipientCount: 37,
        excludedCount: 2,
        sample: [
          { participantReference: 'Účastník •001' },
          { participantReference: 'Účastník •002' },
        ],
      },
      createdAt: '2026-07-25T12:00:00.000+02:00',
      expiresAt: '2026-07-25T12:15:00.000+02:00',
    };

    expect(adminAnnouncementPreviewResponseSchema.parse(preview)).toEqual(
      preview,
    );
    expect(
      adminAnnouncementPreviewResponseSchema.safeParse({
        ...preview,
        audience: {
          recipientCount: 0,
          excludedCount: 39,
          sample: [{ participantReference: 'Účastník •001' }],
        },
      }).success,
    ).toBe(false);
    expect(adminAnnouncementCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      browserPersistence: 'forbidden',
      sharedCache: 'forbidden',
      previewMutation: 'online-only',
      sendMutation: 'online-only',
      sendIdempotency: 'required',
      deliveryChannels: 'in-app-only',
    });
  });

  it('keeps authority and idempotency metadata outside the send body', () => {
    const request = {
      previewId: ids.preview,
      previewVersion: 2,
      reason: 'Informování přímo dotčené syntetické skupiny.',
    };

    expect(adminAnnouncementSendRequestSchema.parse(request)).toEqual(request);
    expect(
      adminAnnouncementSendRequestSchema.safeParse({
        ...request,
        actorRole: 'organizer_admin',
        idempotencyKey: 'announcement-send-0001',
      }).success,
    ).toBe(false);
    expect(
      adminAnnouncementSendHeadersSchema.parse({
        idempotencyKey: 'announcement-send-0001',
      }),
    ).toEqual({ idempotencyKey: 'announcement-send-0001' });
  });

  it('rejects markup and enumerates an empty audience', () => {
    expect(
      adminAnnouncementPreviewRequestSchema.safeParse({
        draft: {
          ...draft,
          bodyText: '<strong>Unsafe</strong>',
        },
      }).success,
    ).toBe(false);

    const emptyAudience = {
      type: problemTypeForCode('ANNOUNCEMENT_EMPTY_AUDIENCE'),
      title: 'Announcement audience is empty',
      status: 409,
      code: 'ANNOUNCEMENT_EMPTY_AUDIENCE',
      detail: 'Change the immutable audience before sending.',
      requestId: 'request-admin-announcement-0001',
    };
    expect(adminAnnouncementPreviewProblemSchema.parse(emptyAudience)).toEqual(
      emptyAudience,
    );
  });
});
