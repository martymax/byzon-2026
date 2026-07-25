import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  loadParticipantCurrentEvent: vi.fn(),
  participantHome: vi.fn(),
}));

vi.mock('@/server/current-event', () => ({
  loadParticipantCurrentEvent: pageMocks.loadParticipantCurrentEvent,
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

  it('renders a metadata-free archived state with only safe account routes', async () => {
    pageMocks.loadParticipantCurrentEvent.mockResolvedValueOnce({
      kind: 'archived',
    });

    const markup = renderToStaticMarkup(await ParticipantHomePage());

    expect(markup).toContain('Akce byla archivována');
    expect(markup).toContain('href="/app/soukromi"');
    expect(markup).toContain('href="/app/nastaveni"');
    expect(
      [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(['/app/soukromi', '/app/nastaveni']);
    for (const marker of sensitiveMarkers) {
      expect(markup).not.toContain(marker);
    }
    expect(markup).not.toContain('participant-home-client');
    expect(pageMocks.participantHome).not.toHaveBeenCalled();
  });
});
