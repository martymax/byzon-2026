import {
  adminAnnouncementPreviewProblemSchema,
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendProblemSchema,
  adminAnnouncementSendResponseSchema,
  participantAnnouncementDetailProblemSchema,
  participantAnnouncementDetailResponseSchema,
  participantAnnouncementInboxProblemSchema,
  participantAnnouncementInboxResponseSchema,
  participantAnnouncementReadProblemSchema,
  participantAnnouncementReadResponseSchema,
  problemTypeForCode,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';
import { contentFixtureIds } from './content.js';

export const announcementFixtureIds = Object.freeze({
  event: contentFixtureIds.event,
  session: contentFixtureIds.workshop,
  critical: '01920000-0000-7000-8000-000000000003',
  important: '01920000-0000-7000-8000-000000000004',
  information: '01920000-0000-7000-8000-000000000005',
  longContent: '01920000-0000-7000-8000-000000000006',
  adminPreview: '01920000-0000-7000-8000-000000000007',
  adminAnnouncement: '01920000-0000-7000-8000-000000000008',
  adminAudit: '01920000-0000-7000-8000-000000000009',
  nextCursor: 'fixture-announcements-page-2',
} as const);

const criticalSummary = {
  id: announcementFixtureIds.critical,
  title: 'Změna sálu workshopu',
  summary: 'Workshop Růst bez zkratek proběhne v sále Vltava.',
  severity: 'critical' as const,
  publishedAt: '2026-09-19T07:30:00.000Z',
  readAt: null,
  context: {
    kind: 'session' as const,
    session: {
      id: announcementFixtureIds.session,
      title: 'Růst bez zkratek',
    },
  },
};

const importantSummary = {
  id: announcementFixtureIds.important,
  title: 'Registrace je otevřená',
  summary: 'Registrační pult je připravený u hlavního vstupu.',
  severity: 'important' as const,
  publishedAt: '2026-09-18T06:30:00.000Z',
  readAt: null,
  context: {
    kind: 'event' as const,
  },
};

const informationSummary = {
  id: announcementFixtureIds.information,
  title: 'Praktické informace k příjezdu',
  summary: 'Přijeďte s časovou rezervou a sledujte značení u vstupu.',
  severity: 'info' as const,
  publishedAt: '2026-09-17T12:00:00.000Z',
  readAt: '2026-09-17T12:15:00.000Z',
  context: {
    kind: 'event' as const,
  },
};

const longSummary = {
  id: announcementFixtureIds.longContent,
  title:
    'Důležitá provozní zpráva pro účastníky s velmi dlouhým názvem, který se musí bezpečně zalomit na úzkém displeji telefonu',
  summary:
    'Organizační tým zveřejnil podrobnou změnu programu, která zůstává plně syntetická a slouží k ověření bezpečného zalamování českého textu bez odhalení údajů příjemců. '
      .repeat(3)
      .trim(),
  severity: 'important' as const,
  publishedAt: '2026-09-16T12:00:00.000Z',
  readAt: null,
  context: {
    kind: 'event' as const,
  },
};

const longBodyText =
  'Tato syntetická provozní zpráva ověřuje dlouhý český text, bezpečné zalamování slov a čitelnost detailu na všech podporovaných velikostech obrazovky. '
    .repeat(105)
    .trim();

export const participantAnnouncementInboxFixtures = defineFixtureSet({
  name: 'announcements.inbox',
  schema: participantAnnouncementInboxResponseSchema,
  fixtures: {
    happy: {
      eventId: announcementFixtureIds.event,
      items: [criticalSummary, importantSummary, informationSummary],
      pageInfo: { nextCursor: null, hasMore: false },
      unreadCount: 2,
    },
    unread: {
      eventId: announcementFixtureIds.event,
      items: [criticalSummary, importantSummary],
      pageInfo: { nextCursor: null, hasMore: false },
      unreadCount: 2,
    },
    first_page: {
      eventId: announcementFixtureIds.event,
      items: [criticalSummary, importantSummary],
      pageInfo: {
        nextCursor: announcementFixtureIds.nextCursor,
        hasMore: true,
      },
      unreadCount: 2,
    },
    second_page: {
      eventId: announcementFixtureIds.event,
      items: [informationSummary],
      pageInfo: { nextCursor: null, hasMore: false },
      unreadCount: 2,
    },
    empty: {
      eventId: announcementFixtureIds.event,
      items: [],
      pageInfo: { nextCursor: null, hasMore: false },
      unreadCount: 0,
    },
    empty_unread: {
      eventId: announcementFixtureIds.event,
      items: [],
      pageInfo: { nextCursor: null, hasMore: false },
      unreadCount: 0,
    },
    long_content: {
      eventId: announcementFixtureIds.event,
      items: [longSummary],
      pageInfo: { nextCursor: null, hasMore: false },
      unreadCount: 1,
    },
  },
});

export const participantAnnouncementDetailFixtures = defineFixtureSet({
  name: 'announcements.detail',
  schema: participantAnnouncementDetailResponseSchema,
  fixtures: {
    unread: {
      eventId: announcementFixtureIds.event,
      announcement: {
        ...importantSummary,
        bodyText:
          'Registrační pult je otevřený u hlavního vstupu. Připravte si aplikaci a pokračujte podle pokynů označeného týmu.',
      },
    },
    read: {
      eventId: announcementFixtureIds.event,
      announcement: {
        ...informationSummary,
        bodyText:
          'Přijeďte s časovou rezervou. Od hlavního vstupu vás ke konferenčnímu sálu navedou viditelné směrovky.',
      },
    },
    critical: {
      eventId: announcementFixtureIds.event,
      announcement: {
        ...criticalSummary,
        bodyText:
          'Workshop Růst bez zkratek se přesouvá do sálu Vltava. Čas začátku zůstává beze změny.',
      },
    },
    long_content: {
      eventId: announcementFixtureIds.event,
      announcement: {
        ...longSummary,
        bodyText: longBodyText,
      },
    },
  },
});

export const participantAnnouncementReadFixtures = defineFixtureSet({
  name: 'announcements.read',
  schema: participantAnnouncementReadResponseSchema,
  fixtures: {
    success: {
      eventId: announcementFixtureIds.event,
      announcementId: announcementFixtureIds.important,
      state: 'read',
      readAt: '2026-09-18T06:35:00.000Z',
      unreadCount: 1,
    },
    already_read: {
      eventId: announcementFixtureIds.event,
      announcementId: announcementFixtureIds.information,
      state: 'read',
      readAt: '2026-09-17T12:15:00.000Z',
      unreadCount: 2,
    },
  },
});

const adminDraft = {
  title: 'Změna sálu workshopu',
  bodyText:
    'Workshop Růst bez zkratek se přesouvá do sálu Vltava. Čas začátku zůstává beze změny.',
  severity: 'important' as const,
  audience: {
    kind: 'session' as const,
    sessionId: announcementFixtureIds.session,
  },
};

export const adminAnnouncementPreviewFixtures = defineFixtureSet({
  name: 'announcements.admin-preview',
  schema: adminAnnouncementPreviewResponseSchema,
  fixtures: {
    session_audience: {
      eventId: announcementFixtureIds.event,
      previewId: announcementFixtureIds.adminPreview,
      previewVersion: 2,
      draft: adminDraft,
      audience: {
        recipientCount: 37,
        excludedCount: 2,
        sample: [
          { participantReference: 'Účastník •001' },
          { participantReference: 'Účastník •002' },
        ],
      },
      createdAt: '2026-09-18T06:00:00.000Z',
      expiresAt: '2026-09-18T06:15:00.000Z',
    },
    empty_audience: {
      eventId: announcementFixtureIds.event,
      previewId: announcementFixtureIds.adminPreview,
      previewVersion: 3,
      draft: {
        ...adminDraft,
        audience: {
          kind: 'event',
        },
      },
      audience: {
        recipientCount: 0,
        excludedCount: 440,
        sample: [],
      },
      createdAt: '2026-09-18T06:20:00.000Z',
      expiresAt: '2026-09-18T06:35:00.000Z',
    },
  },
});

const adminSendResponse = {
  eventId: announcementFixtureIds.event,
  announcementId: announcementFixtureIds.adminAnnouncement,
  previewId: announcementFixtureIds.adminPreview,
  previewVersion: 2,
  recipientCount: 37,
  sentAt: '2026-09-18T06:05:00.000Z',
  audit: {
    auditId: announcementFixtureIds.adminAudit,
  },
};

export const adminAnnouncementSendFixtures = defineFixtureSet({
  name: 'announcements.admin-send',
  schema: adminAnnouncementSendResponseSchema,
  fixtures: {
    sent: {
      ...adminSendResponse,
      outcome: 'sent',
    },
    idempotent_replay: {
      ...adminSendResponse,
      outcome: 'already_sent',
    },
  },
});

interface AnnouncementProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly EVENT_ACCESS_DENIED: 403;
  readonly ANNOUNCEMENTS_DISABLED: 409;
  readonly ANNOUNCEMENT_NOT_FOUND: 404;
  readonly VALIDATION_FAILED: 422;
  readonly IDEMPOTENCY_KEY_REUSED: 409;
  readonly IDEMPOTENCY_IN_PROGRESS: 409;
  readonly ANNOUNCEMENT_EMPTY_AUDIENCE: 409;
  readonly ANNOUNCEMENT_PREVIEW_EXPIRED: 409;
  readonly INTERNAL_ERROR: 500;
}

const problem = <Code extends keyof AnnouncementProblemStatus>(
  code: Code,
  status: AnnouncementProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Announcement fixture problem',
  status,
  code,
  detail: 'Synthetic participant announcement fixture failure.',
  requestId: 'fixture-announcement-0001',
});

const readOnlyProblems = {
  authentication: problem('AUTHENTICATION_REQUIRED', 401),
  session_expired: problem('AUTH_SESSION_EXPIRED', 401),
  permission: problem('EVENT_ACCESS_DENIED', 403),
  disabled: problem('ANNOUNCEMENTS_DISABLED', 409),
  validation: problem('VALIDATION_FAILED', 422),
  internal_error: problem('INTERNAL_ERROR', 500),
} as const;

const nonEnumeratingNotFoundProblem = problem('ANNOUNCEMENT_NOT_FOUND', 404);

export const participantAnnouncementInboxProblemFixtures = defineFixtureSet({
  name: 'announcements.inbox-problem',
  schema: participantAnnouncementInboxProblemSchema,
  fixtures: readOnlyProblems,
});

export const participantAnnouncementDetailProblemFixtures = defineFixtureSet({
  name: 'announcements.detail-problem',
  schema: participantAnnouncementDetailProblemSchema,
  fixtures: {
    ...readOnlyProblems,
    not_found: nonEnumeratingNotFoundProblem,
    audience_denied: nonEnumeratingNotFoundProblem,
  },
});

export const participantAnnouncementReadProblemFixtures = defineFixtureSet({
  name: 'announcements.read-problem',
  schema: participantAnnouncementReadProblemSchema,
  fixtures: {
    ...readOnlyProblems,
    not_found: nonEnumeratingNotFoundProblem,
    audience_denied: nonEnumeratingNotFoundProblem,
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});

export const adminAnnouncementPreviewProblemFixtures = defineFixtureSet({
  name: 'announcements.admin-preview-problem',
  schema: adminAnnouncementPreviewProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    disabled: problem('ANNOUNCEMENTS_DISABLED', 409),
    empty_audience: problem('ANNOUNCEMENT_EMPTY_AUDIENCE', 409),
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const adminAnnouncementSendProblemFixtures = defineFixtureSet({
  name: 'announcements.admin-send-problem',
  schema: adminAnnouncementSendProblemSchema,
  fixtures: {
    permission: problem('EVENT_ACCESS_DENIED', 403),
    disabled: problem('ANNOUNCEMENTS_DISABLED', 409),
    empty_audience: problem('ANNOUNCEMENT_EMPTY_AUDIENCE', 409),
    stale_preview: {
      type: problemTypeForCode('ANNOUNCEMENT_PREVIEW_STALE'),
      title: 'Announcement fixture problem',
      status: 409,
      code: 'ANNOUNCEMENT_PREVIEW_STALE',
      detail: 'Synthetic admin announcement preview is stale.',
      requestId: 'fixture-announcement-0002',
      currentPreviewVersion: 3,
    },
    preview_expired: problem('ANNOUNCEMENT_PREVIEW_EXPIRED', 409),
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});
