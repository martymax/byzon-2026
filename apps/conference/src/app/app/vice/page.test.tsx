import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  loadParticipantCurrentEvent: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: pageMocks.notFound,
}));

vi.mock('@/server/current-event', () => ({
  loadParticipantCurrentEvent: pageMocks.loadParticipantCurrentEvent,
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: () => true,
}));

vi.mock('@/components/participant-account-more', () => ({
  ParticipantMoreHub: () => <div>Soukromý rozcestník účtu</div>,
}));

import ParticipantMorePage, { canOpenParticipantMore } from './page';

describe('participant More server phase boundary', () => {
  beforeEach(() => {
    pageMocks.loadParticipantCurrentEvent.mockReset();
    pageMocks.notFound.mockClear();
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
  });
});
