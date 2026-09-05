import { describe, expect, it } from 'vitest';

import {
  adminEngagementMutationRequestSchema,
  adminEngagementOverviewSchema,
} from './admin-engagement.js';

const ids = {
  event: '019fb200-0000-7000-8000-000000000001',
  session: '019fb200-0000-7000-8000-000000000002',
  user: '019fb200-0000-7000-8000-000000000003',
  assignment: '019fb200-0000-7000-8000-000000000004',
};

describe('admin engagement contracts', () => {
  it('accepts one canonical event-scoped overview with complete admin identities', () => {
    const overview = {
      eventId: ids.event,
      settingsVersion: 2,
      assignmentsVersion: 4,
      features: {
        networkingEnabled: false,
        questionsEnabled: true,
        ratingsEnabled: false,
      },
      sessions: [
        {
          sessionId: ids.session,
          title: 'Lidskost pod tlakem',
          startsAt: '2026-10-16T09:00:00.000+02:00',
          status: 'published',
          questionsEnabled: true,
          version: 3,
          moderators: [
            {
              assignmentId: ids.assignment,
              userId: ids.user,
              displayName: 'Demo Moderátor',
              contactEmail: 'demo.moderator@example.test',
            },
          ],
        },
      ],
      moderatorCandidates: [
        {
          userId: ids.user,
          displayName: 'Demo Moderátor',
          contactEmail: 'demo.moderator@example.test',
        },
      ],
    };

    expect(adminEngagementOverviewSchema.parse(overview)).toEqual(overview);
  });

  it('rejects invalid candidate e-mail addresses and duplicate sessions', () => {
    const result = adminEngagementOverviewSchema.safeParse({
      eventId: ids.event,
      settingsVersion: 1,
      assignmentsVersion: 1,
      features: {
        networkingEnabled: false,
        questionsEnabled: false,
        ratingsEnabled: false,
      },
      sessions: [
        {
          sessionId: ids.session,
          title: 'A',
          startsAt: '2026-10-16T09:00:00.000+02:00',
          status: 'published',
          questionsEnabled: false,
          version: 1,
          moderators: [],
        },
        {
          sessionId: ids.session,
          title: 'B',
          startsAt: '2026-10-16T10:00:00.000+02:00',
          status: 'draft',
          questionsEnabled: false,
          version: 1,
          moderators: [],
        },
      ],
      moderatorCandidates: [
        {
          userId: ids.user,
          displayName: 'Demo Moderátor',
          contactEmail: 'not-an-email',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('requires an audited reason for feature and session changes', () => {
    expect(
      adminEngagementMutationRequestSchema.safeParse({
        action: 'update_features',
        expectedSettingsVersion: 1,
        features: {
          networkingEnabled: true,
          questionsEnabled: true,
          ratingsEnabled: true,
        },
        reason: 'short',
      }).success,
    ).toBe(false);
    expect(
      adminEngagementMutationRequestSchema.safeParse({
        action: 'set_session_questions',
        sessionId: ids.session,
        expectedSessionVersion: 2,
        enabled: true,
        reason: 'Schváleno dramaturgií',
      }).success,
    ).toBe(true);
    expect(
      adminEngagementMutationRequestSchema.safeParse({
        action: 'assign_moderator',
        sessionId: ids.session,
        userId: ids.user,
        expectedAssignmentsVersion: 4,
        reason: 'Přiřazení potvrzené pořadatelem',
      }).success,
    ).toBe(true);
  });
});
