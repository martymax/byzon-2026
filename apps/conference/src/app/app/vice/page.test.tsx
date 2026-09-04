import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  frontendPreviewAvailable: vi.fn(),
  loadParticipantCurrentEvent: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  participantMoreHub: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: pageMocks.notFound,
}));

vi.mock('@/server/current-event', () => ({
  loadParticipantCurrentEvent: pageMocks.loadParticipantCurrentEvent,
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: pageMocks.frontendPreviewAvailable,
}));

vi.mock('@/components/participant-account-more', () => ({
  ParticipantMoreHub: (props: Readonly<Record<string, unknown>>) => {
    pageMocks.participantMoreHub(props);
    return <div>Soukromý rozcestník účtu</div>;
  },
}));

import ParticipantMorePage, { canOpenParticipantMore } from './page';

describe('participant account hub server phase boundary', () => {
  beforeEach(() => {
    pageMocks.frontendPreviewAvailable.mockReset();
    pageMocks.frontendPreviewAvailable.mockReturnValue(false);
    pageMocks.loadParticipantCurrentEvent.mockReset();
    pageMocks.notFound.mockClear();
    pageMocks.participantMoreHub.mockReset();
  });

  it.each([
    [{ kind: 'archived' }, false],
    [{ kind: 'unavailable' }, false],
    [{ kind: 'available', event: {} }, true],
  ] as const)('maps %j to deep-link availability %s', (state, expected) => {
    expect(canOpenParticipantMore(state)).toBe(expected);
  });

  it.each(['archived', 'unavailable'] as const)(
    'rejects an %s deep link before the private client hub is rendered',
    async (kind) => {
      pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({ kind });

      await expect(ParticipantMorePage()).rejects.toThrow('NEXT_NOT_FOUND');
      expect(pageMocks.notFound).toHaveBeenCalledOnce();
    },
  );

  it('renders the hub only for an available participant event', async () => {
    pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
      kind: 'available',
      event: {},
    });

    expect(renderToStaticMarkup(await ParticipantMorePage())).toContain(
      'Soukromý rozcestník účtu',
    );
    expect(pageMocks.notFound).not.toHaveBeenCalled();
    expect(pageMocks.participantMoreHub).toHaveBeenCalledWith({
      ticketAvailable: false,
    });
  });

  it('exposes the ticket destination only in frontend preview', async () => {
    pageMocks.frontendPreviewAvailable.mockReturnValue(true);
    pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
      kind: 'available',
      event: {},
    });

    renderToStaticMarkup(await ParticipantMorePage());

    expect(pageMocks.participantMoreHub).toHaveBeenCalledWith({
      ticketAvailable: true,
    });
  });
});
