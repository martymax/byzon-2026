import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const layoutMocks = vi.hoisted(() => ({
  accountScope: vi.fn(),
  loadParticipantLayoutEventContext: vi.fn(),
  navigation: vi.fn(),
}));

vi.mock('@/server/current-event', () => ({
  loadParticipantLayoutEventContext:
    layoutMocks.loadParticipantLayoutEventContext,
}));

vi.mock('@/components/participant-layout-shell', () => ({
  ParticipantLayoutShell: ({
    accountScope,
    children,
    navigationMode,
  }: {
    readonly accountScope:
      | { readonly kind: 'active'; readonly eventId: string }
      | { readonly kind: 'archived'; readonly eventFingerprint: string }
      | { readonly kind: 'unavailable' };
    readonly children: React.ReactNode;
    readonly navigationMode?: 'active' | 'archived' | 'unavailable';
  }) => {
    layoutMocks.accountScope(accountScope);
    layoutMocks.navigation(navigationMode);
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
    layoutMocks.loadParticipantLayoutEventContext.mockReset();
    layoutMocks.navigation.mockReset();
  });

  it('forces a fresh server-derived scope for every participant request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it.each([
    [{ kind: 'available', event: {} }, 'active'],
    [{ kind: 'archived' }, 'archived'],
    [{ kind: 'unavailable' }, 'unavailable'],
  ] as const)('maps %j to the %s shell', (state, expectedMode) => {
    expect(participantShellNavigationMode(state)).toBe(expectedMode);
  });

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
    expect(layoutMocks.accountScope).toHaveBeenCalledWith({
      kind: 'archived',
      eventFingerprint:
        '9caa2f149fcc7d8e862b204f15035cc4a72782f6d49ef14698672e50dd3ee86a',
    });
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
