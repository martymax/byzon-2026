import {
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendResponseSchema,
} from '@byzon/domain/contracts';
import {
  adminOperationsOverviewResponseSchema,
  type AdminContextResponse,
  type AdminRoleScopeOptionsRequest,
  adminSessionCapacityMutationResponseSchema,
} from '@byzon/domain/contracts/admin';
import {
  adminAnnouncementPreviewFixtures,
  adminAnnouncementSendFixtures,
  adminAnnouncementSendProblemFixtures,
  adminAnnouncementTargetFixtures,
  adminAuditFixtures,
  adminContextFixtures,
  adminEngagementMutationFixtures,
  adminEngagementOverviewFixtures,
  adminEventSettingsFixtures,
  adminEventSettingsUpdateFixtures,
  adminExportJobListFixtures,
  adminFixtureIds,
  adminMutationProblemFixtures,
  adminOperationsOverviewFixtures,
  adminRoleAssignmentFixtures,
  adminRoleAssignmentListFixtures,
  adminRolePersonSearchFixtures,
  adminRoleScopeOptionsFixtures,
  adminReservationFixtures,
  adminReservationMutationFixtures,
  adminReservationSessionFixtures,
  adminSessionCapacityFixtures,
  adminSessionCapacityMutationFixtures,
  supportFixtureIds,
  supportSearchFixtures,
  ticketImportApplyFixtures,
  ticketImportApplyProblemFixtures,
  ticketImportFixtureIds,
  ticketImportPreviewFixtures,
  ticketImportPreviewProblemFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAnnouncementWorkspace } from '../../components/admin-announcement-workspace';
import { findForbiddenAdminMainCopy } from '../../components/admin-copy';
import type { AdminExportJobsPort } from '../../components/admin-reports-workspace';
import {
  AdminImportWorkspace,
  type AdminTicketUpdatePort,
} from '../../components/admin-import-workspace';
import { AdminEngagementWorkspace } from '../../components/admin-engagement-workspace';
import {
  AdminOperationsWorkspace,
  AdminReportsWorkspace,
  AdminTeamWorkspace,
} from '../../components/admin-operations-workspace';
import {
  AdminAuditWorkspace,
  AdminReservationsWorkspace,
  AdminReservationWorkspace,
  AdminSettingsWorkspace,
} from '../../components/admin-reservation-workspace';
import {
  AdminParticipantDetailWorkspace,
  AdminSupportWorkspace,
} from '../../components/admin-support-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminAnnouncementPreviewEndpoint,
  adminAnnouncementSendEndpoint,
  adminAnnouncementTargetsEndpoint,
  adminAuditEndpoint,
  adminContextEndpoint,
  adminEngagementMutationEndpoint,
  adminEngagementOverviewEndpoint,
  adminEventSettingsEndpoint,
  adminEventSettingsUpdateEndpoint,
  adminExportEndpoint,
  adminExportJobListEndpoint,
  adminOperationsOverviewEndpoint,
  adminParticipantListEndpoint,
  adminParticipantDetailEndpoint,
  adminParticipantInviteEndpoint,
  adminParticipantUpdateEndpoint,
  adminRoleAssignmentEndpoint,
  adminRoleAssignmentListEndpoint,
  adminReservationsEndpoint,
  adminReservationSessionsEndpoint,
  adminReservationMutationEndpoint,
  adminSessionCapacitiesEndpoint,
  adminSessionCapacityMutationEndpoint,
  adminTicketImportApplyEndpoint,
  adminTicketImportPreviewEndpoint,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api/endpoint';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent, userEvent } from './render';

const metadata = { requestId: 'component-admin-0001' } as const;

const success = <Value,>(data: Value) =>
  ({
    ok: true,
    kind: 'success',
    status: 200,
    data,
    metadata,
  }) as const;

const failure = <
  Kind extends
    | 'offline'
    | 'timeout'
    | 'transport'
    | 'invalid_response'
    | 'session_expired',
>(
  kind: Kind,
  status = 0,
) =>
  ({
    ok: false,
    kind: 'failure',
    status,
    failure: { kind },
  }) as const;

const problemFailure = <Problem extends { readonly status: number }>(
  problem: Problem,
) =>
  ({
    ok: false,
    kind: 'failure',
    status: problem.status,
    failure: { kind: 'problem', problem },
    metadata,
  }) as const;

type RequestHandler = (
  endpoint: unknown,
  options: unknown,
) => Promise<unknown> | unknown;

const createApi = (handler: RequestHandler): ApiPort => ({
  request: vi.fn(async (endpoint: unknown, options: unknown) =>
    handler(endpoint, options),
  ) as unknown as ApiPort['request'],
});

const adminRoot = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>(
    '[data-admin-environment]',
  );
  if (!element) throw new Error('Admin workspace root is missing.');
  return element;
};

const renderedAdminMainCopy = (): string => {
  const main = document.querySelector<HTMLElement>('#admin-main');
  if (!main) throw new Error('Admin main landmark is missing.');
  const copy = main.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('details').forEach((details) => details.remove());
  return copy.textContent ?? '';
};

const expectPlainAdminMainCopy = () => {
  expect(findForbiddenAdminMainCopy(renderedAdminMainCopy())).toBeNull();
};

const acknowledgeDialog = async (
  screen: Awaited<ReturnType<typeof renderComponent>>,
) => {
  await screen.getByRole('dialog').getByRole('checkbox').click();
};

const organizerApi = (
  handler: RequestHandler,
  context: AdminContextResponse = adminContextFixtures.organizer!,
): ApiPort =>
  createApi((endpoint, options) =>
    endpoint === adminContextEndpoint
      ? success(context)
      : endpoint === adminAnnouncementTargetsEndpoint
        ? success({
            ...adminAnnouncementTargetFixtures.available!,
            eventId: adminFixtureIds.event,
          })
        : handler(endpoint, options),
  );

const participantListResponse = () => ({
  eventId: adminFixtureIds.event,
  generatedAt: '2026-09-02T10:00:00.000Z',
  items: supportSearchFixtures.ambiguous!.matches.map((record, index) => ({
    eventId: adminFixtureIds.event,
    participantId: record.participantId,
    ticketId: record.ticketId,
    displayName: record.displayName,
    contactEmail:
      index === 0 ? 'ucastnik@example.test' : 'navstevnik@example.test',
    company: index === 0 ? 'Future Works' : 'Northstar Studio',
    jobTitle: index === 0 ? 'CEO' : 'Product designer',
    referenceSuffix: record.referenceSuffix,
    ticketState: record.ticketState,
    accessState: record.accessState,
    networkingState: index === 0 ? ('enabled' as const) : ('disabled' as const),
    invitation:
      index === 0
        ? {
            status: 'accepted' as const,
            lastSentAt: '2026-08-20T09:55:00.000Z',
          }
        : { status: 'not_sent' as const, lastSentAt: null },
    checkedIn: index === 0,
    reservationCount: index + 1,
    profileVersion: 1,
    ticketVersion: record.version,
    updatedAt: '2026-09-02T10:00:00.000Z',
    availableActions: record.availableActions,
  })),
  pageInfo: { total: 2, offset: 0, hasMore: false },
  summary: { total: 2, active: 2, networkingEnabled: 1, checkedIn: 1 },
});

const participantDetailResponse = () => {
  const record = supportSearchFixtures.single_match!.matches[0]!;
  return {
    eventId: adminFixtureIds.event,
    participantId: record.participantId,
    ticketId: record.ticketId,
    firstName: 'Syntetický',
    lastName: 'Účastník',
    contactEmail: 'ucastnik@example.test',
    phone: '+420777123456',
    company: 'Future Works',
    jobTitle: 'CEO',
    introduction: 'Hledám nové obchodní partnery.',
    linkedinUrl: 'https://www.linkedin.com/in/synthetic',
    todayHunting: ['business_partners'] as const,
    networkingEnabled: true,
    moderationStatus: 'visible' as const,
    onboardingCompleted: true,
    membershipStatus: 'active' as const,
    invitation: { status: 'not_sent' as const, lastSentAt: null },
    ticket: {
      source: 'ticket' as const,
      referenceSuffix: record.referenceSuffix,
      externalId: 'ticket-101',
      orderExternalId: 'order-51',
      state: record.ticketState,
      claimedAt: '2026-08-20T10:00:00.000Z',
      version: record.version,
      availableActions: record.availableActions,
    },
    checkIn: { occurredAt: '2026-09-02T08:00:00.000Z' },
    reservations: [],
    profileVersion: 1,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  };
};

beforeEach(() => {
  window.history.replaceState({}, '', '/admin');
});

describe('F4 contract-first admin journeys', () => {
  it.each([
    [
      '/admin/role',
      'Tým a oprávnění',
      AdminTeamWorkspace,
      [adminRoleAssignmentListEndpoint],
    ],
    [
      '/admin/reporty',
      'Reporty',
      AdminReportsWorkspace,
      [adminExportJobListEndpoint],
    ],
    [
      '/admin/rezervace',
      'Rezervace a kapacity',
      AdminReservationsWorkspace,
      [adminReservationSessionsEndpoint],
    ],
    [
      '/admin/audit',
      'Historie změn',
      AdminAuditWorkspace,
      [adminAuditEndpoint],
    ],
    [
      '/admin/nastaveni',
      'Nastavení akce',
      AdminSettingsWorkspace,
      [adminEventSettingsEndpoint],
    ],
  ] as const)(
    'keeps %s isolated in its own route workspace',
    async (path, heading, Workspace, expectedEndpoints) => {
      window.history.replaceState({}, '', path);
      const privateRequests: unknown[] = [];
      const api = organizerApi((endpoint) => {
        privateRequests.push(endpoint);
        if (endpoint === adminOperationsOverviewEndpoint) {
          return success(adminOperationsOverviewFixtures.healthy!);
        }
        if (endpoint === adminRoleAssignmentListEndpoint) {
          return success(adminRoleAssignmentListFixtures.list!);
        }
        if (endpoint === adminExportJobListEndpoint) {
          return success(adminExportJobListFixtures.mixed!);
        }
        if (endpoint === adminReservationSessionsEndpoint) {
          return success(adminReservationSessionFixtures.complete!);
        }
        if (endpoint === adminAuditEndpoint) {
          return success(adminAuditFixtures.page!);
        }
        if (endpoint === adminEventSettingsEndpoint) {
          return success(adminEventSettingsFixtures.open!);
        }
        throw new Error('A route workspace requested an unrelated endpoint.');
      });
      const screen = await renderComponent(
        <AdminWorkspaceShell api={api} environment="production">
          <Workspace />
        </AdminWorkspaceShell>,
      );

      await expect
        .element(screen.getByRole('heading', { level: 1, name: heading }))
        .toBeVisible();
      expectPlainAdminMainCopy();
      await vi.waitFor(() => {
        expect(new Set(privateRequests)).toEqual(
          new Set<unknown>(expectedEndpoints),
        );
      });
    },
  );

  it('keeps archived team assignments read-only while preserving the list', async () => {
    window.history.replaceState({}, '', '/admin/role');
    const dataPort = {
      loadAssignments: vi.fn(async () => adminRoleAssignmentListFixtures.list!),
      searchPeople: vi.fn(async () => adminRolePersonSearchFixtures.empty!),
      loadScopeOptions: vi.fn(
        async () => adminRoleScopeOptionsFixtures.checkin!,
      ),
    };
    const context: AdminContextResponse = {
      ...adminContextFixtures.organizer!,
      event: {
        ...adminContextFixtures.organizer!.event,
        phase: 'archived',
      },
    };
    const api = organizerApi(() => {
      throw new Error('Archived role view requested an unexpected endpoint.');
    }, context);
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminTeamWorkspace dataPort={dataPort} />
      </AdminWorkspaceShell>,
    );

    expect(screen.getByText('Operátor #27').elements().length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByRole('button', { name: 'Přiřadit roli' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Odebrat oprávnění' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Důvod změny oprávnění' }),
    ).not.toBeInTheDocument();
  });

  it('assigns a role through named people and scope options without raw identifier fields', async () => {
    window.history.replaceState({}, '', '/admin/role');
    const mutationBodies: unknown[] = [];
    const scopeRequests: AdminRoleScopeOptionsRequest[] = [];
    const dataPort = {
      loadAssignments: vi.fn(async () => adminRoleAssignmentListFixtures.list!),
      searchPeople: vi.fn(async () => adminRolePersonSearchFixtures.found!),
      loadScopeOptions: vi.fn(async (request: AdminRoleScopeOptionsRequest) => {
        scopeRequests.push(request);
        return request.role === 'checkin_operator'
          ? adminRoleScopeOptionsFixtures.checkin!
          : request.role === 'moderator'
            ? adminRoleScopeOptionsFixtures.moderator!
            : adminRoleScopeOptionsFixtures.activity_leader!;
      }),
    };
    const api = organizerApi((endpoint, rawOptions) => {
      if (endpoint !== adminRoleAssignmentEndpoint) {
        throw new Error('Unexpected admin endpoint.');
      }
      const options = rawOptions as { readonly body: unknown };
      mutationBodies.push(options.body);
      return success({
        ...adminRoleAssignmentFixtures.granted!,
        assignmentsVersion: 4,
      });
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminTeamWorkspace dataPort={dataPort} />
      </AdminWorkspaceShell>,
    );
    expect(document.body.textContent).toContain('Operátor #27');
    expect(document.body.textContent).not.toContain(adminFixtureIds.operator);
    await expect
      .element(screen.getByRole('textbox', { name: /ID operátora/i }))
      .not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Přiřadit roli' }).click();
    await screen
      .getByRole('textbox', { name: 'Jméno nebo ověřený kontakt' })
      .fill('Patrik');
    await screen.getByRole('button', { name: 'Vyhledat osobu' }).click();
    await screen.getByRole('radio', { name: /Patrik Novák/ }).click();
    await screen.getByRole('radio', { name: /Vedoucí aktivity/ }).click();
    await expect
      .element(screen.getByRole('combobox', { name: 'Povolený rozsah' }))
      .toHaveValue(adminFixtureIds.session);
    await screen
      .getByRole('textbox', { name: 'Důvod změny oprávnění' })
      .fill('Přidělení vedoucího k potvrzené aktivitě.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat přiřazení' })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Přiřadit roli' })
      .click();

    expect(scopeRequests.at(-1)).toEqual({ role: 'room_operator' });
    expect(mutationBodies).toEqual([
      {
        action: 'grant',
        operatorId: adminFixtureIds.operator,
        role: 'room_operator',
        scope: {
          kind: 'session',
          sessionId: adminFixtureIds.session,
          label: 'Růst bez zkratek',
        },
        expectedVersion: 3,
        reason: 'Přidělení vedoucího k potvrzené aktivitě.',
      },
    ]);
    await expect
      .element(screen.getByText('Role byla přiřazena.'))
      .toBeVisible();
    await expectComponentToPassAxe(adminRoot());
  });

  it('revokes a listed permission with a danger confirmation and translates server guards', async () => {
    window.history.replaceState({}, '', '/admin/role');
    let guarded = false;
    const dataPort = {
      loadAssignments: vi.fn(async () => adminRoleAssignmentListFixtures.list!),
      searchPeople: vi.fn(async () => adminRolePersonSearchFixtures.empty!),
      loadScopeOptions: vi.fn(
        async () => adminRoleScopeOptionsFixtures.checkin!,
      ),
    };
    const api = organizerApi((endpoint) => {
      if (endpoint !== adminRoleAssignmentEndpoint) {
        throw new Error('Unexpected admin endpoint.');
      }
      if (!guarded) {
        guarded = true;
        return problemFailure(adminMutationProblemFixtures.self_lockout!);
      }
      return success(adminRoleAssignmentFixtures.revoked!);
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminTeamWorkspace dataPort={dataPort} />
      </AdminWorkspaceShell>,
    );

    const reason = screen.getByRole('textbox', {
      name: 'Důvod změny oprávnění',
    });
    await reason.fill('Odebrání již nepotřebného provozního přístupu.');
    await screen
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .first()
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .click();
    await expect
      .element(screen.getByText(/vlastní potřebné oprávnění/))
      .toBeVisible();
    await expect
      .element(screen.getByText(metadata.requestId))
      .not.toBeVisible();
    await screen.getByText('Technické údaje').last().click();
    await expect.element(screen.getByText(metadata.requestId)).toBeVisible();

    await screen
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .first()
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .click();
    await expect
      .element(screen.getByText('Oprávnění bylo odebráno.'))
      .toBeVisible();
  });

  it('reloads the canonical team list after a stale revoke', async () => {
    window.history.replaceState({}, '', '/admin/role');
    let listCalls = 0;
    const dataPort = {
      loadAssignments: vi.fn(async () => {
        listCalls += 1;
        return {
          ...adminRoleAssignmentListFixtures.list!,
          assignmentsVersion: listCalls === 1 ? 3 : 6,
        };
      }),
      searchPeople: vi.fn(async () => adminRolePersonSearchFixtures.empty!),
      loadScopeOptions: vi.fn(
        async () => adminRoleScopeOptionsFixtures.checkin!,
      ),
    };
    const api = organizerApi((endpoint) => {
      if (endpoint === adminRoleAssignmentEndpoint) {
        return problemFailure(adminMutationProblemFixtures.stale!);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminTeamWorkspace dataPort={dataPort} />
      </AdminWorkspaceShell>,
    );
    const initialListCalls = listCalls;

    await screen
      .getByRole('textbox', { name: 'Důvod změny oprávnění' })
      .fill('Odebrání zastaralého provozního oprávnění.');
    await screen
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .first()
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .click();

    await vi.waitFor(() => expect(listCalls).toBeGreaterThan(initialListCalls));
    await expect
      .element(screen.getByText(/Načetli jsme aktuální seznam/))
      .toBeVisible();
  });

  it('wipes the team workspace when role permission is revoked', async () => {
    window.history.replaceState({}, '', '/admin/role');
    const dataPort = {
      loadAssignments: vi.fn(async () => adminRoleAssignmentListFixtures.list!),
      searchPeople: vi.fn(async () => adminRolePersonSearchFixtures.empty!),
      loadScopeOptions: vi.fn(
        async () => adminRoleScopeOptionsFixtures.checkin!,
      ),
    };
    const api = organizerApi((endpoint) => {
      if (endpoint === adminRoleAssignmentEndpoint) {
        return problemFailure(adminMutationProblemFixtures.permission!);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminTeamWorkspace dataPort={dataPort} />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('textbox', { name: 'Důvod změny oprávnění' })
      .fill('Bezpečnostní ověření odebraného oprávnění.');
    await screen
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .first()
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Operátor #27');
  });

  it('retries an ambiguous role revoke with the exact same request', async () => {
    window.history.replaceState({}, '', '/admin/role');
    const mutationCalls: unknown[] = [];
    const dataPort = {
      loadAssignments: vi.fn(async () => adminRoleAssignmentListFixtures.list!),
      searchPeople: vi.fn(async () => adminRolePersonSearchFixtures.empty!),
      loadScopeOptions: vi.fn(
        async () => adminRoleScopeOptionsFixtures.checkin!,
      ),
    };
    const api = organizerApi((endpoint, rawOptions) => {
      if (endpoint !== adminRoleAssignmentEndpoint) {
        throw new Error('Unexpected admin endpoint.');
      }
      const { signal, ...stableRequest } = rawOptions as Record<
        string,
        unknown
      >;
      expect(signal).toBeInstanceOf(AbortSignal);
      mutationCalls.push(structuredClone(stableRequest));
      return mutationCalls.length === 1
        ? failure('timeout')
        : success(adminRoleAssignmentFixtures.revoked!);
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminTeamWorkspace dataPort={dataPort} />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('textbox', { name: 'Důvod změny oprávnění' })
      .fill('Odebrání již nepotřebného provozního oprávnění.');
    await screen
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .first()
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odebrat oprávnění' })
      .click();
    await screen
      .getByRole('button', { name: 'Zopakovat přesně stejný pokus' })
      .click();

    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[1]).toEqual(mutationCalls[0]);
    await expect
      .element(screen.getByText('Oprávnění bylo odebráno.'))
      .toBeVisible();
  });

  it('offers the production login route and preserves the exact admin return', async () => {
    window.history.replaceState({}, '', '/admin/interakce');
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) {
        return failure('session_expired', 401);
      }
      throw new Error('An unauthenticated shell requested a private resource.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminEngagementWorkspace />
      </AdminWorkspaceShell>,
    );

    const login = screen.getByRole('link', { name: 'Přihlásit se' });
    await expect.element(login).toBeVisible();
    expect(login.element().getAttribute('href')).toBe(
      '/prihlaseni?returnTo=%2Fadmin%2Finterakce',
    );
  });

  it('rejects a non-organizer context before a private resource is mounted', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) {
        return success(adminContextFixtures.room_operator!);
      }
      throw new Error('A forbidden child attempted an API request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    await userEvent.keyboard('{Tab}');
    await expect
      .element(screen.getByRole('link', { name: 'Přeskočit na hlavní obsah' }))
      .toHaveFocus();
    expect(api.request).toHaveBeenCalled();
    await expectComponentToPassAxe(adminRoot());
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it('fails closed per route before a forbidden organizer resource is mounted', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const limitedOrganizer = {
      ...adminContextFixtures.organizer!,
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['operations:read'] as const,
      },
    };
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(limitedOrganizer);
      throw new Error('A forbidden child attempted an API request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'K této části nemáte přístup',
        }),
      )
      .toBeVisible();
    expect(api.request).toHaveBeenCalled();
  });

  it('renders the permission-aware grouped navigation without technical shell identifiers', async () => {
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={organizerApi(() => null)}
        environment="production"
      >
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Přehled akce' }))
      .toBeVisible();
    expect(
      document.querySelector('aside a[href="/admin/obsah"]')?.textContent,
    ).toContain('Program a obsah');
    expect(
      document.querySelector('aside a[href="/admin/recnici"]')?.textContent,
    ).toContain('Řečníci');
    expect(
      document.querySelector('aside a[href="/admin/vstupenky"]')?.textContent,
    ).toContain('Aktualizace vstupenek');
    expect(
      document.querySelector('aside a[href="/check-in"]')?.textContent,
    ).toContain('Odbavení');
    expect(document.body.textContent).not.toContain(adminFixtureIds.event);
    expect(document.body.textContent).not.toContain('Europe/Prague');
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelectorAll('a[href="#admin-main"]')).toHaveLength(1);
  });

  it('keeps a permitted feature-off destination visible and blocks its private workspace', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) {
        return success(adminContextFixtures.organizer_features_off!);
      }
      throw new Error('A feature-off workspace attempted a private request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <p>Soukromý editor oznámení</p>
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Oznámení nejsou pro tuto akci dostupná',
        }),
      )
      .toBeVisible();
    expect(
      document.querySelector('aside a[href="/admin/oznameni"]')?.textContent,
    ).toContain('OznámeníVypnuto');
    expect(document.body.textContent).not.toContain('Soukromý editor oznámení');
  });

  it('hides missing permissions and the explicit check-in capability independently', async () => {
    const limitedContext = {
      ...adminContextFixtures.organizer!,
      capabilities: { canEnterCheckin: false },
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['operations:read'] as const,
      },
    };
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(limitedContext);
      throw new Error('Unexpected private request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Přehled akce' }))
      .toBeVisible();
    expect(document.querySelector('aside a[href="/admin"]')).not.toBeNull();
    expect(
      document.querySelector('aside a[href="/admin/reporty"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('aside a[href="/admin/ucastnici"]'),
    ).toBeNull();
    expect(document.querySelector('aside a[href="/check-in"]')).toBeNull();
  });

  it('exposes a native modal drawer contract on compact viewports', async () => {
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={organizerApi(() => null)}
        environment="production"
      >
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );
    await expect
      .element(screen.getByRole('heading', { name: 'Přehled akce' }))
      .toBeVisible();
    const triggerElement = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Otevřít navigaci administrace"]',
    );
    const dialog = document.querySelector<HTMLDialogElement>('dialog');
    expect(triggerElement?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-labelledby')).toBe(
      dialog?.querySelector('h2')?.id,
    );
  });

  it('offers human account actions and keeps the role inside the account menu', async () => {
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={organizerApi(() => null)}
        environment="production"
      >
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: /Demo administrátor/ }).click();
    await expect
      .element(screen.getByText('Administrátor', { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('menuitem', {
          name: 'Přejít do aplikace účastníka',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('menuitem', { name: 'Nastavení akce' }))
      .toBeVisible();
  });

  it('loads a sanitized SimpleShop preview and applies the exact confirmed impact', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const preview = {
      ...ticketImportPreviewFixtures.simpleshop_readonly!,
      eventId: adminFixtureIds.event,
      rows: ticketImportPreviewFixtures.simpleshop_readonly!.rows.map(
        (row, index) => {
          if (index === 0) {
            return {
              ...row,
              sourceOrderId: '8100001',
              orderTicketCount: 2,
              orderTicketPosition: 1,
            };
          }
          if (index === 1) {
            return {
              ...row,
              sourceOrderId: '8100001',
              orderTicketCount: 2,
              orderTicketPosition: 2,
              contactName: 'Barbora Participant',
              identitySource: 'named_participant' as const,
              sourceStatus: 'paid' as const,
              status: 'new' as const,
              incomingState: 'active' as const,
              currentState: null,
              issues: [],
            };
          }
          return row;
        },
      ),
      source: {
        ...ticketImportPreviewFixtures.simpleshop_readonly!.source,
        observedStatuses: {
          paid: 2,
          unpaid: 0,
          cancelled: 1,
          refunded: 0,
          unknown: 0,
        },
      },
      summary: {
        total: 3,
        new: 2,
        unchanged: 0,
        statusChanged: 0,
        excluded: 1,
        conflict: 0,
        unknown: 0,
      },
    };
    const report = {
      ...ticketImportApplyFixtures.applied!,
      eventId: adminFixtureIds.event,
      previewId: preview.previewId,
      previewVersion: preview.previewVersion,
      selectedRowIds: [ticketImportFixtureIds.rowNew],
      result: {
        created: 1,
        statusChanged: 0,
        unchanged: 0,
      },
    };
    const api = organizerApi((endpoint) => {
      if (endpoint === adminTicketImportPreviewEndpoint) {
        return success(preview);
      }
      if (endpoint === adminTicketImportApplyEndpoint) {
        return success(report);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await expect
      .element(screen.getByRole('heading', { name: 'Zkontrolovat změny' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Důvod importu' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Importovat vybrané (0)' }))
      .toBeVisible();
    expect(document.body.textContent).toContain('Alice Participant');
    expect(document.body.textContent).toContain('alice@example.test');
    expect(document.body.textContent).toContain('•A1B2C3');
    expect(document.body.textContent).toContain('7100001');
    expect(document.body.textContent).toContain('8100001');
    expect(document.body.textContent).toContain('2 vstupenky v objednávce');
    expect(document.body.textContent).toContain('tato 1 z 2');
    expect(document.body.textContent).toContain('18. 8. 2026');
    expect(document.body.textContent).toContain('EARLYBIRD');
    expect(document.body.textContent).toContain(
      'Účastník z „prodeje na jméno“',
    );
    expect(document.body.textContent).not.toContain('kontakt •••');
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('dropzone');
    const previewCall = vi
      .mocked(api.request)
      .mock.calls.find(
        ([endpoint]) => endpoint === adminTicketImportPreviewEndpoint,
      );
    expect(previewCall?.[1]).toMatchObject({
      body: { source: 'simpleshop' },
      cache: 'no-store',
    });
    await screen
      .getByRole('checkbox', {
        name: 'Vybrat Alice Participant k importu',
      })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod importu' })
      .fill('Potvrzený import účastníků ze SimpleShopu.');
    await screen
      .getByRole('button', { name: 'Importovat vybrané (1)' })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Importovat vybrané (1)' })
      .click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Vybraní účastníci byli importováni',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Nevybraní noví účastníci zůstali beze změny a znovu se objeví při dalším načtení ze SimpleShopu.',
        ),
      )
      .toBeVisible();
    const applyCall = vi
      .mocked(api.request)
      .mock.calls.find(
        ([endpoint]) => endpoint === adminTicketImportApplyEndpoint,
      );
    expect(applyCall?.[1]).toMatchObject({
      body: {
        eventId: adminFixtureIds.event,
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        expectedImpact: preview.summary,
        selectedRowIds: [ticketImportFixtureIds.rowNew],
        reason: 'Potvrzený import účastníků ze SimpleShopu.',
      },
      cache: 'no-store',
    });
    expect(applyCall?.[1]).toHaveProperty('idempotencyKey');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expectPlainAdminMainCopy();
    await expectComponentToPassAxe(adminRoot());
  });

  it('keeps Back read-only, confirms exact impact and reports a mocked apply', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const previewRows = ticketImportPreviewFixtures.clean!.rows.map((row) =>
      row.rowId === ticketImportFixtureIds.rowChanged
        ? {
            ...row,
            sourceStatus: 'paid' as const,
            status: 'new' as const,
            incomingState: 'active' as const,
            currentState: null,
          }
        : row,
    );
    const preview = {
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
      rows: previewRows,
      summary: {
        total: 3,
        new: 2,
        unchanged: 1,
        statusChanged: 0,
        excluded: 0,
        conflict: 0,
        unknown: 0,
      },
    };
    const report = {
      ...ticketImportApplyFixtures.applied!,
      eventId: adminFixtureIds.event,
      selectedRowIds: [
        ticketImportFixtureIds.rowNew,
        ticketImportFixtureIds.rowChanged,
      ],
      result: { created: 2, statusChanged: 0, unchanged: 0 },
    };
    const apply = vi.fn(async () => success(report));
    const port = {
      preview: vi.fn(async () => success(preview)),
      apply,
    } satisfies AdminTicketUpdatePort;
    const screen = await renderComponent(
      <AdminWorkspaceShell api={organizerApi(() => null)} environment="mocked">
        <AdminImportWorkspace port={port} />
      </AdminWorkspaceShell>,
    );

    const stepper = screen.getByRole('navigation', {
      name: 'Postup aktualizace vstupenek',
    });
    for (const label of [
      'Načíst ze SimpleShopu',
      'Vybrat účastníky',
      'Potvrdit import',
      'Výsledek',
    ]) {
      await expect.element(stepper).toHaveTextContent(label);
    }
    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await screen.getByRole('button', { name: 'Zpět ke zdroji' }).click();
    expect(apply).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Zkontrolovat změny' }),
    ).not.toBeInTheDocument();

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await screen
      .getByRole('button', { name: 'Vybrat všechny k importu' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod importu' })
      .fill('Pravidelná kontrola prodejů.');
    await screen
      .getByRole('button', { name: 'Importovat vybrané (2)' })
      .click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Importovat vybrané účastníky?',
        }),
      )
      .toBeVisible();
    const dialog = screen.getByRole('dialog', {
      name: 'Importovat vybrané účastníky?',
    });
    await expect.element(dialog).toHaveTextContent('Importuje 2 účastníci');
    const confirm = dialog.getByRole('button', {
      name: 'Importovat vybrané (2)',
    });
    expect((await confirm.element()).className).not.toContain('danger');
    await acknowledgeDialog(screen);
    await confirm.click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Vybraní účastníci byli importováni',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zobrazit účastníky' }))
      .toHaveAttribute('href', '/admin/ucastnici');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      expect.anything(),
      adminFixtureIds.event,
      expect.objectContaining({
        selectedRowIds: [
          ticketImportFixtureIds.rowNew,
          ticketImportFixtureIds.rowChanged,
        ],
      }),
      expect.any(String),
      expect.any(AbortSignal),
    );
  });

  it('shows a no-change result and retries a temporarily unavailable source', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const clean = ticketImportPreviewFixtures.clean!;
    const unchangedRows = clean.rows.filter(
      ({ status }) => status === 'unchanged',
    );
    const noChanges = {
      ...clean,
      eventId: adminFixtureIds.event,
      rows: unchangedRows,
      summary: {
        total: unchangedRows.length,
        new: 0,
        unchanged: unchangedRows.length,
        statusChanged: 0,
        excluded: 0,
        conflict: 0,
        unknown: 0,
      },
    };
    let attempt = 0;
    const simpleShopSource =
      ticketImportPreviewFixtures.simpleshop_readonly!.source;
    if (simpleShopSource.kind !== 'simpleshop_api') {
      throw new Error('SimpleShop fixture has an unexpected source.');
    }
    const api = organizerApi((endpoint) => {
      if (endpoint !== adminTicketImportPreviewEndpoint) {
        throw new Error('Unexpected admin endpoint.');
      }
      attempt += 1;
      return attempt === 1
        ? problemFailure(ticketImportPreviewProblemFixtures.source_unavailable!)
        : success({
            ...ticketImportPreviewFixtures.simpleshop_readonly!,
            eventId: adminFixtureIds.event,
            rows: noChanges.rows,
            summary: noChanges.summary,
            source: {
              ...simpleShopSource,
              ticketRows: 1,
              sourceRows: 1,
              ignoredSummaryRows: 0,
              multipleQuantitySummaryRows: 0,
              observedStatuses: {
                paid: 1,
                unpaid: 0,
                cancelled: 0,
                refunded: 0,
                unknown: 0,
              },
              codeShape: {
                ...simpleShopSource.codeShape,
                count: 1,
              },
            },
          });
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await expect.element(screen.getByRole('alert')).toBeVisible();
    await screen.getByRole('button', { name: 'Zkusit načíst znovu' }).click();
    await expect
      .element(
        screen.getByText(
          'V SimpleShopu nejsou žádní noví účastníci k importu.',
        ),
      )
      .toBeVisible();
    expect(attempt).toBe(2);
  });

  it('reuses the exact request identity after an ambiguous apply result', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const preview = {
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
    };
    const report = {
      ...ticketImportApplyFixtures.idempotent_replay!,
      eventId: adminFixtureIds.event,
      selectedRowIds: [ticketImportFixtureIds.rowNew],
      result: { created: 1, statusChanged: 0, unchanged: 0 },
    };
    let attempt = 0;
    const idempotencyKeys: string[] = [];
    const apply = vi.fn(
      async (...args: Parameters<AdminTicketUpdatePort['apply']>) => {
        idempotencyKeys.push(args[3]);
        attempt += 1;
        return attempt === 1 ? failure('transport') : success(report);
      },
    );
    const port = {
      preview: vi.fn(async () => success(preview)),
      apply,
    } satisfies AdminTicketUpdatePort;
    const screen = await renderComponent(
      <AdminWorkspaceShell api={organizerApi(() => null)} environment="mocked">
        <AdminImportWorkspace port={port} />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await screen
      .getByRole('checkbox', { name: 'Vybrat Syntetický účastník k importu' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod importu' })
      .fill('Přesná opakovaná aktualizace.');
    await screen
      .getByRole('button', { name: 'Importovat vybrané (1)' })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Importovat vybrané (1)' })
      .click();
    await screen
      .getByRole('button', { name: 'Zopakovat přesně stejný pokus' })
      .click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Server potvrdil dříve dokončený import',
        }),
      )
      .toBeVisible();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
  });

  it('invalidates a stale apply and reloads the exact preview boundary', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const preview = {
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
    };
    const port = {
      preview: vi.fn(async () => success(preview)),
      apply: vi.fn(async () =>
        problemFailure(ticketImportApplyProblemFixtures.stale!),
      ),
    } satisfies AdminTicketUpdatePort;
    const screen = await renderComponent(
      <AdminWorkspaceShell api={organizerApi(() => null)} environment="mocked">
        <AdminImportWorkspace port={port} />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await screen
      .getByRole('checkbox', { name: 'Vybrat Syntetický účastník k importu' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod importu' })
      .fill('Kontrola zastaralé dávky.');
    await screen
      .getByRole('button', { name: 'Importovat vybrané (1)' })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Importovat vybrané (1)' })
      .click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Import zatím nelze potvrdit',
        }),
      )
      .toBeVisible();
    await vi.waitFor(() => expect(port.preview).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole('button', { name: 'Zopakovat přesně stejný pokus' }),
    ).not.toBeInTheDocument();
  });

  it.each(['conflict', 'unknown'] as const)(
    'keeps the %s source problem visible but allows safe rows to be selected',
    async (fixtureName) => {
      window.history.replaceState({}, '', '/admin/vstupenky');
      const preview = {
        ...ticketImportPreviewFixtures[fixtureName]!,
        eventId: adminFixtureIds.event,
      };
      const problemRow = preview.rows.find(({ status }) =>
        fixtureName === 'conflict'
          ? status === 'conflict'
          : status === 'unknown',
      );
      const port = {
        preview: vi.fn(async () => success(preview)),
        apply: vi.fn(async () => {
          throw new Error('A blocked preview must never be applied.');
        }),
      } satisfies AdminTicketUpdatePort;
      const screen = await renderComponent(
        <AdminWorkspaceShell
          api={organizerApi(() => null)}
          environment="mocked"
        >
          <AdminImportWorkspace port={port} />
        </AdminWorkspaceShell>,
      );

      await screen
        .getByRole('button', { name: 'Načíst ze SimpleShopu' })
        .click();
      await expect
        .element(screen.getByRole('combobox', { name: 'Filtrovat záznamy' }))
        .toHaveValue('all');
      expect(document.body.textContent).toContain(problemRow?.contactName);
      expect(
        screen.getByRole('checkbox', {
          name: `Vybrat ${problemRow?.contactName} k importu`,
        }),
      ).not.toBeInTheDocument();
      await screen
        .getByRole('checkbox', {
          name: 'Vybrat Syntetický účastník k importu',
        })
        .click();
      await expect
        .element(screen.getByRole('button', { name: 'Importovat vybrané (1)' }))
        .toBeEnabled();
      expect(port.apply).not.toHaveBeenCalled();
    },
  );

  it('wipes ticket preview state when the online-only source reports offline', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminTicketImportPreviewEndpoint) {
        return failure('offline');
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Aktualizace vstupenek' }),
    ).not.toBeInTheDocument();
  });

  it('wipes ticket preview state when the source session expires', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminTicketImportPreviewEndpoint) {
        return problemFailure(
          ticketImportPreviewProblemFixtures.session_expired!,
        );
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Zdroj vstupenek');
  });

  it('configures per-session questions and assigns a moderator from canonical selects', async () => {
    window.history.replaceState({}, '', '/admin/interakce');
    let overview = structuredClone(adminEngagementOverviewFixtures.default!);
    const mutationBodies: Record<string, unknown>[] = [];
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body?: Record<string, unknown> };
      if (endpoint === adminEngagementOverviewEndpoint) {
        return success(overview);
      }
      if (endpoint === adminEngagementMutationEndpoint) {
        const body = options.body ?? {};
        mutationBodies.push(structuredClone(body));
        if (body.action === 'set_session_questions') {
          overview = {
            ...overview,
            sessions: overview.sessions.map((session) =>
              session.sessionId === adminFixtureIds.secondSession
                ? { ...session, questionsEnabled: true, version: 5 }
                : session,
            ),
          };
          return success(adminEngagementMutationFixtures.session_updated!);
        }
        if (body.action === 'assign_moderator') {
          overview = {
            ...overview,
            assignmentsVersion: 4,
            sessions: overview.sessions.map((session) =>
              session.sessionId === adminFixtureIds.secondSession
                ? {
                    ...session,
                    moderators: [
                      {
                        assignmentId: adminFixtureIds.assignment,
                        userId: adminFixtureIds.operator,
                        displayName: 'Operátor #27',
                        maskedContact: 'o***@example.test',
                      },
                    ],
                  }
                : session,
            ),
          };
          return success(adminEngagementMutationFixtures.moderator_assigned!);
        }
      }
      throw new Error('Unexpected engagement endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminEngagementWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('textbox', { name: 'Důvod pro další operaci' })
      .fill('Povolení dotazů pro vybranou přednášku.');
    await screen
      .getByRole('button', {
        name: 'Povolit otázky pro Panel: firmy v pohybu',
      })
      .click();
    await screen
      .getByRole('checkbox', { name: /Potvrzuji správnou přednášku/ })
      .click();
    await screen
      .getByRole('button', { name: 'Povolit otázky', exact: true })
      .click();
    await expect
      .element(screen.getByText(/uložena do historie změn/i))
      .toBeVisible();
    expectPlainAdminMainCopy();

    await screen
      .getByRole('combobox', { name: 'Přednáška' })
      .selectOptions(adminFixtureIds.secondSession);
    await screen
      .getByRole('combobox', { name: 'Účastník' })
      .selectOptions(adminFixtureIds.operator);
    await screen
      .getByRole('textbox', { name: 'Důvod pro další operaci' })
      .fill('Přiřazení moderátora ke konkrétní přednášce.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat přiřazení moderátora' })
      .click();
    await screen
      .getByRole('checkbox', { name: /Ověřil\/a jsem osobu i přednášku/ })
      .click();
    await screen.getByRole('button', { name: 'Přiřadit moderátora' }).click();

    expect(mutationBodies).toEqual([
      expect.objectContaining({
        action: 'set_session_questions',
        sessionId: adminFixtureIds.secondSession,
        enabled: true,
      }),
      expect.objectContaining({
        action: 'assign_moderator',
        sessionId: adminFixtureIds.secondSession,
        userId: adminFixtureIds.operator,
      }),
    ]);
    expect(document.body.textContent).not.toContain('operator@example.test');
    await expectComponentToPassAxe(adminRoot());
  });

  it('prevents duplicate preview submission and aborts the request on unmount', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    let previewSignal: AbortSignal | undefined;
    const previewRequest = vi.fn((_endpoint: unknown, options: unknown) => {
      previewSignal = (options as { signal?: AbortSignal }).signal;
      return new Promise<unknown>(() => undefined);
    });
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminTicketImportPreviewEndpoint) {
        return previewRequest(endpoint, options);
      }
      throw new Error('No other request is expected during preview.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );
    const button = screen.getByRole('button', {
      name: 'Načíst ze SimpleShopu',
    });

    await button.click();
    await expect
      .element(screen.getByRole('button', { name: 'SimpleShop se načítá…' }))
      .toBeDisabled();
    expect(previewRequest).toHaveBeenCalledTimes(1);
    expect(previewSignal?.aborted).toBe(false);

    await screen.unmount();
    expect(previewSignal?.aborted).toBe(true);
  });

  it('shows all participants immediately and filters without putting PII in the URL', async () => {
    window.history.replaceState({}, '', '/admin/ucastnici');
    const requests: unknown[] = [];
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminParticipantListEndpoint) {
        requests.push(options);
        return success(participantListResponse());
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSupportWorkspace />
      </AdminWorkspaceShell>,
    );

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Syntetický účastník'),
    );
    expect(document.body.textContent).toContain('Testovací návštěvník');
    expect(requests[0]).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/participants/list`,
      cache: 'no-store',
      body: { query: '', limit: 100, offset: 0 },
    });

    await screen
      .getByRole('searchbox', { name: 'Filtrovat účastníky' })
      .fill('citlivy@example.test');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({
      body: { query: 'citlivy@example.test' },
    });
    expect(window.location.href).not.toContain('citlivy');
    await expectComponentToPassAxe(adminRoot());
  });

  it('offers only a common safe bulk action for the current selection', async () => {
    window.history.replaceState({}, '', '/admin/ucastnici');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminParticipantListEndpoint) {
        return success(participantListResponse());
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSupportWorkspace />
      </AdminWorkspaceShell>,
    );

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Syntetický účastník'),
    );
    const visibleCheckbox = (label: string) =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `input[aria-label="${label}"]`,
        ),
      ).find((element) => element.getClientRects().length > 0)!;
    await userEvent.click(visibleCheckbox('Vybrat Syntetický účastník'));
    await userEvent.click(visibleCheckbox('Vybrat Testovací návštěvník'));

    await expect
      .element(screen.getByRole('button', { name: 'Poslat pozvánku' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Zablokovat přístup' }))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Obnovit přístup' }),
    ).not.toBeInTheDocument();
  });

  it('opens a complete participant detail and saves profile and networking data with a reason', async () => {
    window.history.replaceState(
      {},
      '',
      `/admin/ucastnici/${supportFixtureIds.participant}`,
    );
    const detail = participantDetailResponse();
    let updateOptions: unknown;
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminParticipantDetailEndpoint) return success(detail);
      if (endpoint === adminParticipantUpdateEndpoint) {
        updateOptions = options;
        const body = (options as { body: { profile: typeof detail } }).body;
        return success({
          eventId: adminFixtureIds.event,
          outcome: 'updated' as const,
          detail: {
            ...detail,
            ...body.profile,
            profileVersion: detail.profileVersion + 1,
          },
          changedAt: '2026-09-02T10:01:00.000Z',
          audit: { auditId: supportFixtureIds.audit },
        });
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminParticipantDetailWorkspace
          participantId={supportFixtureIds.participant}
        />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Základní údaje' }))
      .toBeVisible();
    await screen.getByRole('textbox', { name: 'Firma' }).fill('Future Lab');
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Oprava na žádost účastníka.');
    await screen.getByRole('button', { name: 'Uložit změny' }).click();

    await expect
      .element(screen.getByText('Změny účastníka byly uloženy.'))
      .toBeVisible();
    expect(updateOptions).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/participants/${supportFixtureIds.participant}`,
      cache: 'no-store',
      body: {
        participantId: supportFixtureIds.participant,
        expectedProfileVersion: 1,
        reason: 'Oprava na žádost účastníka.',
        profile: {
          company: 'Future Lab',
          networkingEnabled: true,
          todayHunting: ['business_partners'],
        },
      },
    });
    expect(
      (updateOptions as { idempotencyKey?: string }).idempotencyKey,
    ).toBeTruthy();
    await expectComponentToPassAxe(adminRoot());
  });

  it('confirms and sends a participant invitation to the current profile email', async () => {
    window.history.replaceState(
      {},
      '',
      `/admin/ucastnici/${supportFixtureIds.participant}`,
    );
    const detail = participantDetailResponse();
    let inviteOptions: unknown;
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminParticipantDetailEndpoint) return success(detail);
      if (endpoint === adminParticipantInviteEndpoint) {
        inviteOptions = options;
        return success({
          eventId: adminFixtureIds.event,
          participantId: supportFixtureIds.participant,
          outcome: 'sent' as const,
          sentAt: '2026-09-02T10:02:00.000Z',
          invitation: {
            status: 'sent' as const,
            lastSentAt: '2026-09-02T10:02:00.000Z',
          },
          audit: { auditId: supportFixtureIds.audit },
        });
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminParticipantDetailWorkspace
          participantId={supportFixtureIds.participant}
        />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('button', { name: 'Poslat pozvánku' }))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Poslat pozvánku' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Poslat účastníkovi pozvánku?',
        }),
      )
      .toBeVisible();
    expect(screen.getByRole('dialog').element().textContent).toContain(
      'ucastnik@example.test',
    );
    expect(screen.getByRole('dialog').element().textContent).toContain(
      'Odkaz platí 5 minut.',
    );
    await acknowledgeDialog(screen);
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odeslat pozvánku' })
      .click();

    await expect
      .element(
        screen.getByText(
          'Pozvánka byla odeslána na ucastnik@example.test.',
        ),
      )
      .toBeVisible();
    expect(inviteOptions).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/participants/${supportFixtureIds.participant}/invite`,
      body: { participantId: supportFixtureIds.participant },
      cache: 'no-store',
    });
    expect(
      (inviteOptions as { idempotencyKey?: string }).idempotencyKey,
    ).toBeTruthy();
    await expectComponentToPassAxe(adminRoot());
  });

  it('shows reservation records to a reader without capacity or attendance mutation controls', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const readOnlyContext = {
      ...adminContextFixtures.organizer!,
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['reservation:any:read'] as const,
      },
    };
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(readOnlyContext);
      if (endpoint === adminReservationSessionsEndpoint) {
        return success(adminReservationSessionFixtures.complete!);
      }
      throw new Error('A reservation reader attempted an unauthorized call.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminReservationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByText('Růst bez zkratek', { exact: true }).last())
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Upravit kapacitu' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Zrušit rezervaci účastníka' }),
    ).not.toBeInTheDocument();
  });

  it('shows the canonical reservation route session-first with accessible capacity progress', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const fullSessions = {
      ...adminReservationSessionFixtures.complete!,
      items: adminReservationSessionFixtures.complete!.items.map((record) =>
        record.sessionId === adminFixtureIds.session
          ? { ...record, confirmedCount: record.capacity ?? 0 }
          : record,
      ),
    };
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationSessionsEndpoint) {
        return success(fullSessions);
      }
      throw new Error('The reservation overview requested a mutation.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Aktivity' }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('progressbar', {
          name: 'Růst bez zkratek: 40 z 40 míst',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('Plná kapacita', { exact: true }).last())
      .toBeVisible();
    expect(document.body.textContent).toContain(
      'Aktivity se načítají po stránkách v pořadí programu.',
    );
    expect(document.body.textContent).not.toContain('Docházka');
    expect(document.body.textContent).not.toContain('attendance');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expectPlainAdminMainCopy();
    await expectComponentToPassAxe(adminRoot());
  });

  it('loads the next reservation-session page without exposing participant PII', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const paths: string[] = [];
    const api = organizerApi((endpoint, rawOptions) => {
      if (endpoint !== adminReservationSessionsEndpoint) {
        throw new Error('The paginated overview requested another endpoint.');
      }
      const options = rawOptions as { readonly path: string };
      paths.push(options.path);
      return success(
        options.path.includes('cursor=')
          ? adminReservationSessionFixtures.last_page!
          : adminReservationSessionFixtures.first_page!,
      );
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('button', { name: 'Načíst další aktivity' }))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Načíst další aktivity' }).click();
    await expect
      .element(screen.getByText('Řízený networking', { exact: true }).last())
      .toBeVisible();
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths.at(-1)).toContain('cursor=fixture-reservation-session-page-2');
    expect(JSON.stringify(paths)).not.toContain('@');
    expect(document.body.textContent).not.toContain('@example');
    await expectComponentToPassAxe(adminRoot());
  });

  it('edits capacity from the activity detail with reserved count as the minimum', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let mutationOptions: unknown;
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminReservationSessionsEndpoint) {
        return success(adminReservationSessionFixtures.complete!);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        mutationOptions = options;
        return success(adminSessionCapacityMutationFixtures.updated!);
      }
      throw new Error('Unexpected reservation endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('combobox', { name: 'Aktivita' })
      .selectOptions(adminFixtureIds.session);
    await screen
      .getByRole('button', { name: 'Zobrazit aktivitu' })
      .first()
      .click();
    const capacity = screen.getByRole('spinbutton', { name: 'Nová kapacita' });
    await expect.element(capacity).toHaveAttribute('min', '40');
    await capacity.fill('42');
    await screen
      .getByRole('textbox', { name: 'Důvod změny kapacity' })
      .fill('Vyšší kapacita byla potvrzena vedoucím sálu.');
    await screen.getByRole('button', { name: 'Upravit kapacitu' }).click();
    await expect
      .element(
        screen.getByText(
          'Kapacita bude změněna na 42 míst; potvrzené rezervace zůstanou zachované.',
        ),
      )
      .toBeVisible();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    expect(mutationOptions).toMatchObject({
      body: {
        sessionId: adminFixtureIds.session,
        expectedVersion: 4,
        capacity: 42,
      },
      cache: 'no-store',
    });
    await expect
      .element(screen.getByText('Kapacita aktivity byla změněna.'))
      .toBeVisible();
  });

  it('cancels a participant reservation separately and retries only the exact ambiguous request', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const attempts: Array<Record<string, unknown>> = [];
    const api = organizerApi((endpoint, rawOptions) => {
      if (endpoint === adminReservationSessionsEndpoint) {
        return success(adminReservationSessionFixtures.complete!);
      }
      if (endpoint === adminReservationMutationEndpoint) {
        const options = rawOptions as Record<string, unknown>;
        attempts.push({
          body: options.body,
          cache: options.cache,
          idempotencyKey: options.idempotencyKey,
          path: options.path,
        });
        return attempts.length === 1
          ? failure('timeout')
          : success(adminReservationMutationFixtures.cancelled!);
      }
      throw new Error('Unexpected reservation endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('combobox', { name: 'Aktivita' })
      .selectOptions(adminFixtureIds.session);
    await screen
      .getByRole('button', { name: 'Zobrazit aktivitu' })
      .first()
      .click();
    await screen
      .getByRole('button', { name: 'Zrušit rezervaci účastníka' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod zrušení' })
      .fill('Účastník požádal podporu o uvolnění místa.');
    await screen.getByRole('button', { name: 'Zkontrolovat zrušení' }).click();
    await expect
      .element(
        screen.getByText(
          'Rezervace bude zrušena a místo se může uvolnit dalšímu čekajícímu.',
        ),
      )
      .toBeVisible();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('button', { name: 'Zrušit rezervaci', exact: true })
      .click();
    await screen
      .getByRole('button', { name: 'Zopakovat přesně stejný pokus' })
      .click();

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]).toMatchObject({
      body: {
        action: 'cancel_reservation',
        reservationId: adminFixtureIds.reservation,
        expectedVersion: 4,
      },
      cache: 'no-store',
    });
    await expect
      .element(screen.getByText('Rezervace účastníka byla zrušena.'))
      .toBeVisible();
  });

  it('reloads the session overview and discards the draft after a stale capacity decision', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let sessionReads = 0;
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationSessionsEndpoint) {
        sessionReads += 1;
        return success(adminReservationSessionFixtures.complete!);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        return problemFailure(adminMutationProblemFixtures.invalid_transition!);
      }
      throw new Error('Unexpected reservation endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('combobox', { name: 'Aktivita' })
      .selectOptions(adminFixtureIds.session);
    await screen.getByRole('button', { name: 'Zobrazit aktivitu' }).click();
    const initialSessionReads = sessionReads;
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('42');
    await screen
      .getByRole('textbox', { name: 'Důvod změny kapacity' })
      .fill('Tento rozpracovaný důvod se po stale odpovědi zahodí.');
    await screen.getByRole('button', { name: 'Upravit kapacitu' }).click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    await expect
      .element(
        screen.getByText(
          'Data se mezitím změnila. Načetli jsme aktuální stav; změnu připravte znovu.',
        ),
      )
      .toBeVisible();
    expect(sessionReads).toBe(initialSessionReads + 1);
    expect(
      screen.getByRole('textbox', { name: 'Důvod změny kapacity' }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      'Tento rozpracovaný důvod se po stale odpovědi zahodí.',
    );
  });

  it('wipes reservation P3 state when either canonical read reports offline', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationSessionsEndpoint)
        return failure('offline');
      throw new Error('Unexpected reservation endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Účastník •001');
    expect(
      screen.getByRole('heading', { name: 'Rezervace a kapacity' }),
    ).not.toBeInTheDocument();
  });

  it('uses only integrated reservation endpoints in the production workspace', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(adminSessionCapacityFixtures.list!);
      }
      throw new Error('The live reservation page requested a mocked endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Rezervace a kapacity',
        }),
      )
      .toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Auditní stopa' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Nastavení akce' }),
    ).not.toBeInTheDocument();
  });

  it('keeps reservation management available when only the capacity read fails', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return failure('transport');
      }
      throw new Error('The degraded reservation page requested a mutation.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Bezpečný snapshot se nepodařilo načíst',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('Růst bez zkratek', { exact: true }).last())
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Upravit kapacitu' }),
    ).not.toBeInTheDocument();

    await screen
      .getByRole('button', { name: 'Připravit změnu' })
      .first()
      .click();
    await expect
      .element(screen.getByRole('heading', { name: /Změna nad snapshotem/ }))
      .toBeVisible();
  });

  it('edits a session capacity independently of a reservation record', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let capacities = structuredClone(adminSessionCapacityFixtures.list!);
    let mutationBody: Record<string, unknown> | null = null;
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body?: Record<string, unknown> };
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(capacities);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        mutationBody = options.body ?? null;
        const response = adminSessionCapacityMutationResponseSchema.parse({
          ...adminSessionCapacityMutationFixtures.updated!,
          record: {
            ...adminSessionCapacityMutationFixtures.updated!.record,
            capacity: options.body?.capacity,
          },
        });
        capacities = {
          ...capacities,
          items: capacities.items.map((record) =>
            record.sessionId === response.record.sessionId
              ? response.record
              : record,
          ),
        };
        return success(response);
      }
      throw new Error('The capacity editor requested an unexpected endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('button', { name: 'Upravit kapacitu' })
      .first()
      .click();
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('42');
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Potvrzená provozní změna kapacity workshopu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu kapacity' })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    await expect
      .element(screen.getByText(/Kapacita aktivity byla změněna/))
      .toBeVisible();
    expect(mutationBody).toMatchObject({
      sessionId: adminFixtureIds.session,
      expectedVersion: 4,
      capacity: 42,
      reason: 'Potvrzená provozní změna kapacity workshopu.',
    });
    expect(mutationBody).not.toHaveProperty('reservationId');
  });

  it('configures networking capacity from an explicit unconfigured state', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let mutationBody: Record<string, unknown> | null = null;
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body?: Record<string, unknown> };
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(adminSessionCapacityFixtures.list!);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        mutationBody = options.body ?? null;
        return success({
          ...adminSessionCapacityMutationFixtures.networking_configured!,
          record: {
            ...adminSessionCapacityMutationFixtures.networking_configured!
              .record,
            capacity: options.body?.capacity,
          },
        });
      }
      throw new Error(
        'The networking editor requested an unexpected endpoint.',
      );
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByText('Kapacita není nastavená'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Nastavit kapacitu' }).click();
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('14');
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Potvrzená provozní kapacita řízeného networkingu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu kapacity' })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    expect(mutationBody).toMatchObject({
      sessionId: adminFixtureIds.networkingSession,
      expectedVersion: 1,
      capacity: 14,
      reason: 'Potvrzená provozní kapacita řízeného networkingu.',
    });
  });

  it('refreshes and clamps the capacity editor after the confirmed count changes', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let capacities = structuredClone(adminSessionCapacityFixtures.list!);
    let capacityListCalls = 0;
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        capacityListCalls += 1;
        return success(capacities);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        capacities = {
          ...capacities,
          items: capacities.items.map((record) =>
            record.sessionId === adminFixtureIds.session
              ? { ...record, confirmedCount: 39 }
              : record,
          ),
        };
        return {
          ok: false,
          kind: 'failure',
          status: 409,
          failure: {
            kind: 'problem',
            problem: adminMutationProblemFixtures.invalid_transition!,
          },
          metadata,
        } as const;
      }
      throw new Error('The capacity editor requested an unexpected endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('button', { name: 'Upravit kapacitu' })
      .first()
      .click();
    const initialListCalls = capacityListCalls;
    const capacity = screen.getByRole('spinbutton', { name: 'Nová kapacita' });
    await capacity.fill('38');
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Ověření souběžně obsazeného místa workshopu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu kapacity' })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    await expect.element(screen.getByText('39 / 40')).toBeVisible();
    await expect.element(capacity).toHaveValue(39);
    expect(capacityListCalls).toBe(initialListCalls + 1);
  });

  it('invalidates edited announcement preview and sends only a reconfirmed canonical version', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    let previewVersion = 1;
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body: unknown };
      if (endpoint === adminAnnouncementPreviewEndpoint) {
        previewVersion += 1;
        const body = options.body as {
          readonly draft: Record<string, unknown>;
        };
        return success(
          adminAnnouncementPreviewResponseSchema.parse({
            ...adminAnnouncementPreviewFixtures.session_audience!,
            eventId: adminFixtureIds.event,
            previewVersion,
            draft: body.draft,
          }),
        );
      }
      if (endpoint === adminAnnouncementSendEndpoint) {
        const body = options.body as {
          readonly previewId: string;
          readonly previewVersion: number;
        };
        return success(
          adminAnnouncementSendResponseSchema.parse({
            ...adminAnnouncementSendFixtures.sent!,
            eventId: adminFixtureIds.event,
            previewId: body.previewId,
            previewVersion: body.previewVersion,
          }),
        );
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    const title = screen.getByRole('textbox', { name: 'Nadpis' });
    await title.fill('Změna sálu workshopu');
    await screen
      .getByRole('textbox', { name: 'Zpráva' })
      .fill('Workshop se přesouvá do sálu Vltava.');
    await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
    await expect
      .element(screen.getByRole('heading', { name: 'Kontrola' }))
      .toBeVisible();
    await title.fill('Změna sálu workshopu – aktualizace');
    await expect
      .element(screen.getByRole('heading', { name: 'Kontrola' }))
      .not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
    await screen
      .getByRole('textbox', { name: 'Důvod odeslání' })
      .fill('Informování přímo dotčené skupiny.');
    await screen.getByRole('button', { name: 'Zkontrolovat odeslání' }).click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Odeslat oznámení' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Oznámení bylo odesláno. Počet příjemců: 37.',
        }),
      )
      .toBeVisible();
    await expectComponentToPassAxe(adminRoot());
  });

  it('uses a named session target without exposing or accepting a raw identifier', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    let receivedAudience: unknown;
    const api = organizerApi((endpoint, rawOptions) => {
      if (endpoint !== adminAnnouncementPreviewEndpoint) {
        throw new Error('Unexpected admin endpoint.');
      }
      const options = rawOptions as {
        readonly body: { readonly draft: { readonly audience: unknown } };
      };
      receivedAudience = options.body.draft.audience;
      return success(
        adminAnnouncementPreviewResponseSchema.parse({
          ...adminAnnouncementPreviewFixtures.session_audience!,
          eventId: adminFixtureIds.event,
          draft: options.body.draft,
        }),
      );
    });
    const targets = adminAnnouncementTargetFixtures.available!.options;
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('textbox', { name: 'Nadpis' })
      .fill('Změna sálu workshopu');
    await screen
      .getByRole('textbox', { name: 'Zpráva' })
      .fill('Workshop se přesouvá do sálu Vltava.');
    expect(
      window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ).toBe(false);
    const audience = screen.getByRole('combobox', { name: 'Komu' });
    await expect.element(audience).toHaveValue('event');
    await audience.selectOptions('session');
    await expect
      .element(screen.getByRole('combobox', { name: 'Aktivita' }))
      .toHaveValue(targets[0]!.sessionId);
    expect(document.body.textContent).toContain('Růst bez zkratek');
    expect(document.body.textContent).toContain('Sál Vltava');
    expect(document.body.textContent).not.toContain(targets[0]!.sessionId);

    await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
    expect(receivedAudience).toEqual({
      kind: 'session',
      sessionId: targets[0]!.sessionId,
    });
    await expect.element(screen.getByText(/Oznámení uvidí/)).toBeVisible();
    await expectComponentToPassAxe(adminRoot());
  });

  it('wipes the announcement workspace when loading targets loses the session', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) {
        return success(adminContextFixtures.organizer!);
      }
      if (endpoint === adminAnnouncementTargetsEndpoint) {
        return failure('session_expired', 401);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Text a publikum');
  });

  it('blocks a zero-recipient announcement before the send confirmation', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    const api = organizerApi((endpoint, rawOptions) => {
      if (endpoint !== adminAnnouncementPreviewEndpoint) {
        throw new Error('Unexpected admin endpoint.');
      }
      const options = rawOptions as {
        readonly body: { readonly draft: unknown };
      };
      return success(
        adminAnnouncementPreviewResponseSchema.parse({
          ...adminAnnouncementPreviewFixtures.empty_audience!,
          eventId: adminFixtureIds.event,
          draft: options.body.draft,
        }),
      );
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('textbox', { name: 'Nadpis' })
      .fill('Prázdné publikum');
    await screen
      .getByRole('textbox', { name: 'Zpráva' })
      .fill('Bezpečné ověření prázdného publika.');
    await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();

    await expect
      .element(screen.getByText('Publikum je prázdné. Oznámení nelze odeslat.'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Zkontrolovat odeslání' }))
      .toBeDisabled();
  });

  it('shows the canonical already-sent receipt without claiming delivery', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as {
        readonly body: { readonly draft?: unknown };
      };
      if (endpoint === adminAnnouncementPreviewEndpoint) {
        return success(
          adminAnnouncementPreviewResponseSchema.parse({
            ...adminAnnouncementPreviewFixtures.session_audience!,
            eventId: adminFixtureIds.event,
            draft: options.body.draft,
          }),
        );
      }
      if (endpoint === adminAnnouncementSendEndpoint) {
        return success(
          adminAnnouncementSendResponseSchema.parse({
            ...adminAnnouncementSendFixtures.idempotent_replay!,
            eventId: adminFixtureIds.event,
          }),
        );
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('textbox', { name: 'Nadpis' })
      .fill('Změna programu');
    await screen
      .getByRole('textbox', { name: 'Zpráva' })
      .fill('Program se změnil, zkontrolujte prosím aktuální přehled.');
    await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
    await screen
      .getByRole('textbox', { name: 'Důvod odeslání' })
      .fill('Opakované ověření stejného oznámení.');
    await screen.getByRole('button', { name: 'Zkontrolovat odeslání' }).click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Odeslat oznámení' }).click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Toto oznámení už bylo odesláno. Počet příjemců: 37. Další kopie nevznikla.',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('doručeno');
  });

  it('retries an ambiguous announcement send with the exact same request', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    const sendCalls: unknown[] = [];
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as Record<string, unknown>;
      if (endpoint === adminAnnouncementPreviewEndpoint) {
        const body = options.body as { readonly draft: unknown };
        return success(
          adminAnnouncementPreviewResponseSchema.parse({
            ...adminAnnouncementPreviewFixtures.session_audience!,
            eventId: adminFixtureIds.event,
            draft: body.draft,
          }),
        );
      }
      if (endpoint === adminAnnouncementSendEndpoint) {
        const { signal, ...stableRequest } = options;
        expect(signal).toBeInstanceOf(AbortSignal);
        sendCalls.push(structuredClone(stableRequest));
        return sendCalls.length === 1
          ? failure('timeout')
          : success(
              adminAnnouncementSendResponseSchema.parse({
                ...adminAnnouncementSendFixtures.sent!,
                eventId: adminFixtureIds.event,
              }),
            );
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('textbox', { name: 'Nadpis' }).fill('Změna sálu');
    await screen
      .getByRole('textbox', { name: 'Zpráva' })
      .fill('Aktivita se přesouvá do sálu Vltava.');
    await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
    await screen
      .getByRole('textbox', { name: 'Důvod odeslání' })
      .fill('Informování všech dotčených účastníků.');
    await screen.getByRole('button', { name: 'Zkontrolovat odeslání' }).click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Odeslat oznámení' }).click();
    await screen
      .getByRole('button', { name: 'Zopakovat přesně stejný pokus' })
      .click();

    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[1]).toEqual(sendCalls[0]);
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Oznámení bylo odesláno. Počet příjemců: 37.',
        }),
      )
      .toBeVisible();
  });

  it('rebuilds a stale preview and requires a fresh confirmation', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    let previewCalls = 0;
    let sendCalls = 0;
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as {
        readonly body: { readonly draft?: unknown };
      };
      if (endpoint === adminAnnouncementPreviewEndpoint) {
        previewCalls += 1;
        return success(
          adminAnnouncementPreviewResponseSchema.parse({
            ...adminAnnouncementPreviewFixtures.session_audience!,
            eventId: adminFixtureIds.event,
            previewVersion: previewCalls + 1,
            draft: options.body.draft,
          }),
        );
      }
      if (endpoint === adminAnnouncementSendEndpoint) {
        sendCalls += 1;
        return problemFailure({
          ...adminAnnouncementSendProblemFixtures.stale_preview!,
          currentPreviewVersion: 3,
        });
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('textbox', { name: 'Nadpis' }).fill('Změna sálu');
    await screen
      .getByRole('textbox', { name: 'Zpráva' })
      .fill('Aktivita se přesouvá do sálu Vltava.');
    await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
    await screen
      .getByRole('textbox', { name: 'Důvod odeslání' })
      .fill('Informování všech dotčených účastníků.');
    await screen.getByRole('button', { name: 'Zkontrolovat odeslání' }).click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Odeslat oznámení' }).click();

    expect(previewCalls).toBe(2);
    expect(sendCalls).toBe(1);
    await expect
      .element(screen.getByRole('heading', { name: 'Kontrola' }))
      .toBeVisible();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('textbox', { name: 'Důvod odeslání' }))
      .toHaveValue('');
  });

  it.each(['offline', 'session_expired'] as const)(
    'wipes the announcement draft after a %s preview failure',
    async (kind) => {
      window.history.replaceState({}, '', '/admin/oznameni');
      const api = organizerApi((endpoint) => {
        if (endpoint === adminAnnouncementPreviewEndpoint) {
          return failure(kind, kind === 'session_expired' ? 401 : 0);
        }
        throw new Error('Unexpected admin endpoint.');
      });
      const screen = await renderComponent(
        <AdminWorkspaceShell api={api} environment="mocked">
          <AdminAnnouncementWorkspace />
        </AdminWorkspaceShell>,
      );

      await screen
        .getByRole('textbox', { name: 'Nadpis' })
        .fill('Citlivý návrh');
      await screen
        .getByRole('textbox', { name: 'Zpráva' })
        .fill('Tento návrh musí být po bezpečnostní chybě odstraněn.');
      await screen
        .getByRole('button', { name: 'Zkontrolovat oznámení' })
        .click();

      await expect
        .element(screen.getByRole('textbox', { name: 'Nadpis' }))
        .not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain('Citlivý návrh');
    },
  );

  it('freezes every visible core setting while an ambiguous exact retry is pending', async () => {
    window.history.replaceState({}, '', '/admin/nastaveni');
    const updateCalls: unknown[] = [];
    let updateCount = 0;
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminEventSettingsEndpoint) {
        return success(adminEventSettingsFixtures.open!);
      }
      if (endpoint === adminEventSettingsUpdateEndpoint) {
        const { signal, ...request } = options as Record<string, unknown>;
        expect(signal).toBeInstanceOf(AbortSignal);
        updateCalls.push(structuredClone(request));
        updateCount += 1;
        return updateCount === 1
          ? failure('timeout')
          : success(adminEventSettingsUpdateFixtures.updated!);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSettingsWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Upravit nastavení' }).click();
    await expect
      .element(screen.getByRole('radio', { name: /^Registrace je otevřená/ }))
      .toHaveFocus();
    const mode = screen.getByRole('radio', { name: /^Pouze pro pozvané/ });
    await mode.click();
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Bezpečné ověření neměnného nastavení.');
    await screen.getByRole('button', { name: 'Uložit změny' }).click();
    await screen.getByRole('button', { name: 'Uložit nastavení' }).click();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Zopakovat přesně stejný pokus',
        }),
      )
      .toBeVisible();
    await expect.element(mode).toBeDisabled();
    await screen
      .getByRole('button', { name: 'Zopakovat přesně stejný pokus' })
      .click();
    await expect
      .element(screen.getByText(/Nastavení bylo uloženo/))
      .toBeVisible();
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]).toEqual(updateCalls[0]);
  });

  it('wipes the settings draft when a stale refresh loses the session', async () => {
    window.history.replaceState({}, '', '/admin/nastaveni');
    let updateRequested = false;
    const api = organizerApi((endpoint) => {
      if (endpoint === adminEventSettingsEndpoint) {
        return !updateRequested
          ? success(adminEventSettingsFixtures.open!)
          : failure('session_expired', 401);
      }
      if (endpoint === adminEventSettingsUpdateEndpoint) {
        updateRequested = true;
        return problemFailure(adminMutationProblemFixtures.stale!);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSettingsWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Upravit nastavení' }).click();
    await screen.getByRole('radio', { name: /^Pouze pro pozvané/ }).click();
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Citlivý návrh musí po ztrátě relace zmizet.');
    await screen.getByRole('button', { name: 'Uložit změny' }).click();
    await screen.getByRole('button', { name: 'Uložit nastavení' }).click();

    await expect
      .element(screen.getByRole('textbox', { name: 'Důvod změny' }))
      .not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      'Citlivý návrh musí po ztrátě relace zmizet.',
    );
  });

  it('shows truthful export-job states and queues CSV without inventing a download', async () => {
    window.history.replaceState({}, '', '/admin/reporty');
    const exportCalls: unknown[] = [];
    const jobsPort: AdminExportJobsPort = {
      loadJobs: vi.fn(async () => adminExportJobListFixtures.mixed!),
    };
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminExportEndpoint) {
        exportCalls.push(options);
        return success({
          eventId: adminFixtureIds.event,
          exportId: adminFixtureIds.export,
          report: 'participant_summary',
          outcome: 'queued',
          state: 'queued',
          queuedAt: '2026-07-25T12:15:00.000+02:00',
          audit: { auditId: adminFixtureIds.auditMutation },
        });
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminReportsWorkspace jobsPort={jobsPort} />
      </AdminWorkspaceShell>,
    );

    await expect.element(screen.getByText('Připravuje se')).toBeVisible();
    await expect
      .element(screen.getByText('Připraven ke stažení'))
      .toBeVisible();
    await expect.element(screen.getByText('Nepodařilo se')).toBeVisible();
    await expect.element(screen.getByText('Odkaz vypršel')).toBeVisible();
    const downloads = screen.getByRole('link', { name: 'Stáhnout' });
    await expect
      .element(downloads)
      .toHaveAttribute(
        'href',
        `/api/v1/admin/events/${adminFixtureIds.event}/exports/${adminFixtureIds.readyExport}`,
      );

    await screen
      .getByRole('textbox', { name: 'Důvod vytvoření reportu' })
      .fill('Provozní kontrola syntetických účastníků.');
    await screen.getByRole('button', { name: 'Vytvořit report' }).click();
    await screen.getByRole('button', { name: 'Zařadit report' }).click();
    await expect.element(screen.getByText(/Report připravujeme/)).toBeVisible();
    expect(exportCalls).toHaveLength(1);
    expect(exportCalls[0]).toMatchObject({
      body: {
        report: 'participant_summary',
        format: 'csv',
        range: null,
        reason: 'Provozní kontrola syntetických účastníků.',
      },
    });
    await expectComponentToPassAxe(adminRoot());
  });

  it('loads export jobs through the integrated production endpoint', async () => {
    window.history.replaceState({}, '', '/admin/reporty');
    const calls: unknown[] = [];
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminExportJobListEndpoint) {
        calls.push(options);
        const path = (options as { path: string }).path;
        if (!path.includes('cursor=')) {
          return success({
            eventId: adminFixtureIds.event,
            items: [adminExportJobListFixtures.mixed!.items[0]!],
            pageInfo: {
              nextCursor: 'fixture-export-page-2',
              hasMore: true,
            },
          });
        }
        return success(adminExportJobListFixtures.mixed!);
      }
      if (endpoint === adminExportEndpoint) {
        throw new Error('Export must not run without confirmation.');
      }
      throw new Error(
        'The live reports page requested an unexpected endpoint.',
      );
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminReportsWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst další reporty' }).click();
    await expect
      .element(screen.getByText('Připraven ke stažení'))
      .toBeVisible();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `/api/v1/admin/events/${adminFixtureIds.event}/exports?limit=25`,
          cache: 'no-store',
        }),
      ]),
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `/api/v1/admin/events/${adminFixtureIds.event}/exports?limit=25&cursor=fixture-export-page-2`,
        }),
      ]),
    );
    await expectComponentToPassAxe(adminRoot());
  });

  it('paginates audit history with the same server filters and human labels', async () => {
    window.history.replaceState({}, '', '/admin/audit');
    const paths: string[] = [];
    const api = organizerApi((endpoint, options) => {
      if (endpoint !== adminAuditEndpoint) {
        throw new Error('Unexpected admin endpoint.');
      }
      const path = (options as { path: string }).path;
      paths.push(path);
      if (path.includes('cursor=')) {
        return success({
          eventId: adminFixtureIds.event,
          items: [adminAuditFixtures.page!.items[1]!],
          pageInfo: { nextCursor: null, hasMore: false },
        });
      }
      return success(adminAuditFixtures.first_page!);
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAuditWorkspace />
      </AdminWorkspaceShell>,
    );

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Upravil nastavení akce');
    });
    await screen
      .getByRole('combobox', { name: 'Oblast' })
      .selectOptions('settings');
    await vi.waitFor(() => {
      expect(paths.at(-1)).toContain('category=settings');
    });
    await screen
      .getByRole('combobox', { name: 'Uživatel' })
      .selectOptions('user');
    await screen
      .getByRole('combobox', { name: 'Výsledek' })
      .selectOptions('succeeded');
    await vi.waitFor(() => {
      expect(paths.at(-1)).toContain('actor=user');
      expect(paths.at(-1)).toContain('outcome=succeeded');
    });
    await screen.getByText('Technické údaje').first().click();
    await screen
      .getByRole('textbox', { name: 'Request ID' })
      .fill('admin-request-0001');
    await vi.waitFor(() => {
      expect(paths.at(-1)).toContain('requestId=admin-request-0001');
    });
    await screen.getByRole('button', { name: 'Načíst další změny' }).click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Citlivé údaje byly skryty.');
    });
    expect(paths.at(-1)).toContain('category=settings');
    expect(paths.at(-1)).toContain('actor=user');
    expect(paths.at(-1)).toContain('outcome=succeeded');
    expect(paths.at(-1)).toContain('requestId=admin-request-0001');
    expect(paths.at(-1)).toContain('cursor=fixture-admin-audit-page-2');
    expect(document.body.textContent).not.toContain('update_settings');
    expect(document.body.textContent).not.toContain('cancel_reservation');
    await expectComponentToPassAxe(adminRoot());
  });

  it('keeps archived event settings semantically read-only', async () => {
    window.history.replaceState({}, '', '/admin/nastaveni');
    const archived = {
      ...adminContextFixtures.organizer!,
      event: { ...adminContextFixtures.organizer!.event, phase: 'archived' },
    } as const;
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(archived);
      if (endpoint === adminEventSettingsEndpoint) {
        return success(adminEventSettingsFixtures.closed!);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSettingsWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByText('Archivovaná akce je pouze ke čtení.'))
      .toBeVisible();
    expect(document.body.textContent).toContain('Registrace je uzavřená');
    expect(
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent?.trim() === 'Upravit nastavení',
      ),
    ).toBe(false);
    expect(document.querySelector('input')).toBeNull();
    await expectComponentToPassAxe(adminRoot());
  });

  it('renders the aggregate operations snapshot without exposing queue payloads', async () => {
    window.history.replaceState({}, '', '/admin/reporty');
    const overview = adminOperationsOverviewResponseSchema.parse({
      ...adminOperationsOverviewFixtures.degraded!,
      eventId: adminFixtureIds.event,
    });
    const api = organizerApi((endpoint) => {
      if (endpoint === adminOperationsOverviewEndpoint) {
        return success(overview);
      }
      if (endpoint === adminExportEndpoint) {
        throw new Error('Export must not run without confirmation.');
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminOperationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', { name: 'Bezpečný queue a DLQ souhrn' }),
      )
      .toBeVisible();
    await expect.element(screen.getByText('1 v DLQ')).toBeVisible();
    expect(document.body.textContent).not.toContain('recipient@example.test');
    expect(document.body.textContent).not.toContain('raw-secret-token');
    await expectComponentToPassAxe(adminRoot());
  });
});
