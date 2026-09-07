import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const layoutMocks = vi.hoisted(() => ({
  accountScope: vi.fn(),
  frontendPreviewAvailable: vi.fn(),
  loadParticipantLayoutEventContext: vi.fn(),
  navigation: vi.fn(),
  notifications: vi.fn(),
  sessionContext: vi.fn(),
  resolveSessionContext: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/server/auth', () => ({
  auth: { api: { getSession: layoutMocks.getSession } },
}));
vi.mock('@/server/database', () => ({ database: { db: {} } }));
vi.mock('@/server/participant-session-context', () => ({
  resolveParticipantSessionContext: layoutMocks.resolveSessionContext,
}));

vi.mock('@/server/current-event', () => ({
  loadParticipantLayoutEventContext:
    layoutMocks.loadParticipantLayoutEventContext,
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: layoutMocks.frontendPreviewAvailable,
}));

vi.mock('@/components/participant-layout-shell', () => ({
  ParticipantLayoutShell: ({
    accountScope,
    children,
    navigationMode,
    notificationsEnabled,
    sessionContext,
  }: {
    readonly accountScope:
      | { readonly kind: 'active'; readonly eventId: string }
      | { readonly kind: 'archived'; readonly eventFingerprint: string }
      | { readonly kind: 'unavailable' };
    readonly children: React.ReactNode;
    readonly navigationMode?:
      | 'active'
      | 'active-preview'
      | 'archived'
      | 'archived-preview'
      | 'unavailable';
    readonly notificationsEnabled?: boolean;
    readonly sessionContext?: unknown;
  }) => {
    layoutMocks.accountScope(accountScope);
    layoutMocks.navigation(navigationMode);
    layoutMocks.notifications(notificationsEnabled);
    layoutMocks.sessionContext(sessionContext);
    return <div data-mode={navigationMode}>{children}</div>;
  },
}));

import ParticipantLayout, {
  dynamic,
  participantAccountScope,
  participantShellNavigationMode,
} from './layout';

describe('participant layout event-phase gate', () => {
  beforeEach(() => {
    layoutMocks.accountScope.mockReset();
    layoutMocks.frontendPreviewAvailable.mockReset();
    layoutMocks.frontendPreviewAvailable.mockReturnValue(false);
    layoutMocks.loadParticipantLayoutEventContext.mockReset();
    layoutMocks.navigation.mockReset();
    layoutMocks.notifications.mockReset();
    layoutMocks.sessionContext.mockReset();
    layoutMocks.getSession.mockReset().mockResolvedValue(null);
    layoutMocks.resolveSessionContext.mockReset().mockResolvedValue(null);
  });

  it('passes independently verified admin roles to every participant page', async () => {
    layoutMocks.loadParticipantLayoutEventContext.mockResolvedValue({
      currentEvent: { kind: 'unavailable' },
    });
    layoutMocks.getSession.mockResolvedValue({ user: { id: 'admin-id' } });
    const context = { isAdmin: true, isParticipant: false };
    layoutMocks.resolveSessionContext.mockResolvedValue(context);
    renderToStaticMarkup(await ParticipantLayout({ children: <p>Účet</p> }));
    expect(layoutMocks.resolveSessionContext).toHaveBeenCalledWith(
      {},
      'admin-id',
    );
    expect(layoutMocks.sessionContext).toHaveBeenCalledWith(context);
  });

  it('forces a fresh server-derived scope for every participant request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('keeps account recovery reachable if session navigation cannot be loaded', async () => {
    layoutMocks.loadParticipantLayoutEventContext.mockResolvedValue({
      currentEvent: { kind: 'available', event: { id: 'event-id' } },
    });
    layoutMocks.resolveSessionContext.mockRejectedValue(
      new Error('role lookup unavailable'),
    );
    const report = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const markup = renderToStaticMarkup(
        await ParticipantLayout({ children: <p>Správa přihlášení</p> }),
      );
      expect(markup).toContain('Správa přihlášení');
      expect(layoutMocks.sessionContext).toHaveBeenCalledWith(null);
      expect(report).toHaveBeenCalledOnce();
    } finally {
      report.mockRestore();
    }
  });

  it.each([
    [{ kind: 'available', event: {} }, false, 'active'],
    [{ kind: 'available', event: {} }, true, 'active-preview'],
    [{ kind: 'archived' }, false, 'archived'],
    [{ kind: 'archived' }, true, 'archived-preview'],
    [{ kind: 'unavailable' }, true, 'unavailable'],
  ] as const)(
    'maps %j with preview %s to the %s shell',
    (state, previewAvailable, expectedMode) => {
      expect(participantShellNavigationMode(state, previewAvailable)).toBe(
        expectedMode,
      );
    },
  );

  it('projects only the active event id into the private account scope', () => {
    expect(
      participantAccountScope({
        kind: 'available',
        event: { id: '019f7e6f-62ed-7c87-bce7-b742be58ce0b' },
      }),
    ).toEqual({
      kind: 'active',
      eventId: '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
    });
    expect(
      participantAccountScope(
        { kind: 'archived' },
        '9caa2f149fcc7d8e862b204f15035cc4a72782f6d49ef14698672e50dd3ee86a',
      ),
    ).toEqual({
      kind: 'archived',
      eventFingerprint:
        '9caa2f149fcc7d8e862b204f15035cc4a72782f6d49ef14698672e50dd3ee86a',
    });
    expect(participantAccountScope({ kind: 'unavailable' })).toEqual({
      kind: 'unavailable',
    });
  });

  it('renders the archive-aware shell without passing event metadata to the client navigation', async () => {
    layoutMocks.loadParticipantLayoutEventContext.mockResolvedValueOnce({
      currentEvent: { kind: 'archived' },
      eventFingerprint:
        '9caa2f149fcc7d8e862b204f15035cc4a72782f6d49ef14698672e50dd3ee86a',
    });

    const markup = renderToStaticMarkup(
      await ParticipantLayout({ children: <p>Obsah archivního účtu</p> }),
    );

    expect(markup).toContain('data-mode="archived"');
    expect(markup).toContain('Obsah archivního účtu');
    expect(layoutMocks.navigation).toHaveBeenCalledWith('archived');
    expect(layoutMocks.notifications).toHaveBeenCalledWith(false);
    expect(layoutMocks.accountScope).toHaveBeenCalledWith({
      kind: 'archived',
      eventFingerprint:
        '9caa2f149fcc7d8e862b204f15035cc4a72782f6d49ef14698672e50dd3ee86a',
    });
  });

  it('enables the notification center only for a participant-visible event', async () => {
    layoutMocks.loadParticipantLayoutEventContext.mockResolvedValueOnce({
      currentEvent: {
        kind: 'available',
        event: {
          id: '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
          status: 'live',
        },
      },
    });

    renderToStaticMarkup(
      await ParticipantLayout({ children: <p>Aktivní aplikace</p> }),
    );

    expect(layoutMocks.notifications).toHaveBeenCalledWith(true);
  });

  it('renders no participant navigation mode for a draft or unavailable event', async () => {
    layoutMocks.loadParticipantLayoutEventContext.mockResolvedValueOnce({
      currentEvent: { kind: 'unavailable' },
    });

    const markup = renderToStaticMarkup(
      await ParticipantLayout({ children: <p>Bezpečný stav</p> }),
    );

    expect(markup).toContain('data-mode="unavailable"');
    expect(layoutMocks.navigation).toHaveBeenCalledWith('unavailable');
    expect(layoutMocks.accountScope).toHaveBeenCalledWith({
      kind: 'unavailable',
    });
  });
});
