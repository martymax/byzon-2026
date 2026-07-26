import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  frontendPreviewAvailable: vi.fn(),
  loadCurrentEventId: vi.fn(),
  sessionView: vi.fn(),
}));

vi.mock('@/components/program-view', () => ({
  SessionView: (properties: unknown) => {
    pageMocks.sessionView(properties);
    return <div>Detail programu</div>;
  },
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: pageMocks.frontendPreviewAvailable,
}));

vi.mock('@/server/current-event', () => ({
  loadCurrentEventId: pageMocks.loadCurrentEventId,
}));

import SessionPage from './page';

describe('participant session agenda preview boundary', () => {
  beforeEach(() => {
    pageMocks.frontendPreviewAvailable.mockReset();
    pageMocks.loadCurrentEventId.mockReset();
    pageMocks.sessionView.mockReset();
  });

  it.each([
    [false, false, 'program'],
    [true, true, 'agenda'],
  ] as const)(
    'maps preview availability %s to agenda action %s and %s return',
    async (previewAvailable, showAgendaAction, returnOrigin) => {
      pageMocks.frontendPreviewAvailable.mockReturnValueOnce(previewAvailable);
      pageMocks.loadCurrentEventId.mockResolvedValueOnce(
        '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
      );

      renderToStaticMarkup(
        await SessionPage({
          params: Promise.resolve({ sessionId: 'session-1' }),
          searchParams: Promise.resolve({
            day: '2026-09-18',
            from: 'agenda',
          }),
        }),
      );

      expect(pageMocks.sessionView).toHaveBeenCalledWith(
        expect.objectContaining({
          returnOrigin,
          showAgendaAction,
        }),
      );
    },
  );
});
