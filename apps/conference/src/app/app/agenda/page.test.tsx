import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  agenda: vi.fn(),
  loadCurrentEventId: vi.fn(),
}));

vi.mock('@/components/participant-agenda', () => ({
  ParticipantAgenda: ({ eventId }: { readonly eventId: string }) => {
    pageMocks.agenda(eventId);
    return <div data-event-id={eventId}>Osobní agenda</div>;
  },
}));

vi.mock('@/server/current-event', () => ({
  loadCurrentEventId: pageMocks.loadCurrentEventId,
}));

import ParticipantAgendaPage from './page';

describe('participant agenda server boundary', () => {
  beforeEach(() => {
    pageMocks.agenda.mockReset();
    pageMocks.loadCurrentEventId.mockReset();
  });

  it('renders a safe unavailable state when the current event cannot be resolved', async () => {
    pageMocks.loadCurrentEventId.mockResolvedValueOnce(null);

    const markup = renderToStaticMarkup(await ParticipantAgendaPage());

    expect(markup).toContain('Osobní agenda není dostupná');
    expect(pageMocks.agenda).not.toHaveBeenCalled();
  });

  it('renders the live journey for an available event', async () => {
    pageMocks.loadCurrentEventId.mockResolvedValueOnce(
      '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
    );

    const markup = renderToStaticMarkup(await ParticipantAgendaPage());

    expect(markup).toContain('Osobní agenda');
    expect(pageMocks.agenda).toHaveBeenCalledWith(
      '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
    );
  });
});
