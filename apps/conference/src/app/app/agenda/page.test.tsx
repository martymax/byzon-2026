import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  agenda: vi.fn(),
  frontendPreviewAvailable: vi.fn(),
  loadCurrentEventId: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: pageMocks.notFound,
}));

vi.mock('@/components/participant-agenda', () => ({
  ParticipantAgenda: ({ eventId }: { readonly eventId: string }) => {
    pageMocks.agenda(eventId);
    return <div data-event-id={eventId}>Osobní agenda</div>;
  },
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: pageMocks.frontendPreviewAvailable,
}));

vi.mock('@/server/current-event', () => ({
  loadCurrentEventId: pageMocks.loadCurrentEventId,
}));

import ParticipantAgendaPage from './page';

describe('participant agenda preview boundary', () => {
  beforeEach(() => {
    pageMocks.agenda.mockReset();
    pageMocks.frontendPreviewAvailable.mockReset();
    pageMocks.loadCurrentEventId.mockReset();
    pageMocks.notFound.mockClear();
  });

  it('rejects a production deep link before event or private data is loaded', async () => {
    pageMocks.frontendPreviewAvailable.mockReturnValueOnce(false);

    await expect(ParticipantAgendaPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(pageMocks.notFound).toHaveBeenCalledOnce();
    expect(pageMocks.loadCurrentEventId).not.toHaveBeenCalled();
    expect(pageMocks.agenda).not.toHaveBeenCalled();
  });

  it('renders the mocked journey only for an available preview event', async () => {
    pageMocks.frontendPreviewAvailable.mockReturnValueOnce(true);
    pageMocks.loadCurrentEventId.mockResolvedValueOnce(
      '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
    );

    const markup = renderToStaticMarkup(await ParticipantAgendaPage());

    expect(markup).toContain('Osobní agenda');
    expect(pageMocks.agenda).toHaveBeenCalledWith(
      '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
    );
    expect(pageMocks.notFound).not.toHaveBeenCalled();
  });
});
