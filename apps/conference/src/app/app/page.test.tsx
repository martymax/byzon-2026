import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  frontendPreviewAvailable: vi.fn(),
  loadParticipantCurrentEvent: vi.fn(),
  participantHome: vi.fn(),
}));

vi.mock('@/server/current-event', () => ({
  loadParticipantCurrentEvent: pageMocks.loadParticipantCurrentEvent,
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: pageMocks.frontendPreviewAvailable,
}));

vi.mock('@/components/participant-home', () => ({
  ParticipantHome: (properties: unknown) => {
    pageMocks.participantHome(properties);
    return <div data-testid="participant-home-client" />;
  },
}));

import ParticipantHomePage from './page';

const sensitiveMarkers = [
  '20000000-0000-4000-8000-000000000099',
  '2037-03-01T02:03:04.000Z',
  '2037-03-04T05:06:07.000Z',
  'Private/Timezone',
];

describe('participant home server boundary', () => {
  beforeEach(() => {
    pageMocks.frontendPreviewAvailable.mockReset();
    pageMocks.frontendPreviewAvailable.mockReturnValue(false);
    pageMocks.loadParticipantCurrentEvent.mockReset();
    pageMocks.participantHome.mockReset();
  });

  it('renders a static safe state without instantiating the participant client path', async () => {
    pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
      kind: 'unavailable',
    });

    const markup = renderToStaticMarkup(await ParticipantHomePage());

    expect(markup).toContain('Akce není dostupná');
    expect(markup).not.toContain('participant-home-client');
    expect(pageMocks.participantHome).not.toHaveBeenCalled();
  });

  it('does not serialize hidden event identifiers, dates, or timezone markers', async () => {
    pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
      kind: 'unavailable',
    });

    const markup = renderToStaticMarkup(await ParticipantHomePage());

    for (const marker of sensitiveMarkers) {
      expect(markup).not.toContain(marker);
    }
    expect(pageMocks.participantHome).not.toHaveBeenCalled();
  });

  it('renders a metadata-free production archive without mock-only routes', async () => {
    pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
      kind: 'archived',
    });

    const markup = renderToStaticMarkup(await ParticipantHomePage());

    expect(markup).toContain('Akce byla archivována');
    expect(
      [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual([]);
    for (const marker of sensitiveMarkers) {
      expect(markup).not.toContain(marker);
    }
    expect(markup).not.toContain('participant-home-client');
    expect(pageMocks.participantHome).not.toHaveBeenCalled();
  });

  it('exposes archived account routes only in frontend preview', async () => {
    pageMocks.frontendPreviewAvailable.mockReturnValueOnce(true);
    pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
      kind: 'archived',
    });

    const markup = renderToStaticMarkup(await ParticipantHomePage());

    expect(
      [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(['/app/soukromi', '/app/nastaveni']);
    expect(markup).toContain('dál spravovat v účtu');
    expect(pageMocks.participantHome).not.toHaveBeenCalled();
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    'passes agenda availability %s through the server preview boundary',
    async (previewAvailable, expected) => {
      pageMocks.frontendPreviewAvailable.mockReturnValueOnce(previewAvailable);
      pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
        kind: 'available',
        event: {
          endsAt: new Date('2026-09-20T15:00:00.000Z'),
          id: '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
          startsAt: new Date('2026-09-18T07:00:00.000Z'),
          status: 'live',
          timezone: 'Europe/Prague',
        },
      });

      renderToStaticMarkup(await ParticipantHomePage());

      expect(pageMocks.participantHome).toHaveBeenCalledWith(
        expect.objectContaining({ enableAgendaJourney: expected }),
      );
    },
  );
});
