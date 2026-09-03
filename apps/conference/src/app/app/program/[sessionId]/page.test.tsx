import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  loadCurrentEventId: vi.fn(),
  sessionView: vi.fn(),
}));

vi.mock('@/components/program-view', () => ({
  SessionView: (properties: unknown) => {
    pageMocks.sessionView(properties);
    return <div>Detail programu</div>;
  },
}));

vi.mock('@/server/current-event', () => ({
  loadCurrentEventId: pageMocks.loadCurrentEventId,
}));

import SessionPage from './page';

describe('participant session agenda boundary', () => {
  beforeEach(() => {
    pageMocks.loadCurrentEventId.mockReset();
    pageMocks.sessionView.mockReset();
  });

  it.each([
    [undefined, 'program'],
    ['agenda', 'agenda'],
  ] as const)(
    'shows the live agenda action and maps return origin %s to %s',
    async (from, returnOrigin) => {
      pageMocks.loadCurrentEventId.mockResolvedValueOnce(
        '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
      );

      renderToStaticMarkup(
        await SessionPage({
          params: Promise.resolve({ sessionId: 'session-1' }),
          searchParams: Promise.resolve({
            day: '2026-09-18',
            ...(from ? { from } : {}),
          }),
        }),
      );

      expect(pageMocks.sessionView).toHaveBeenCalledWith(
        expect.objectContaining({
          chooseCoach: false,
          returnOrigin,
          showAgendaAction: true,
        }),
      );
    },
  );

  it('opens a coaching slot without preselecting the representative coach', async () => {
    pageMocks.loadCurrentEventId.mockResolvedValueOnce(
      '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
    );

    renderToStaticMarkup(
      await SessionPage({
        params: Promise.resolve({ sessionId: 'coaching-session-1' }),
        searchParams: Promise.resolve({ coaching: 'choose' }),
      }),
    );

    expect(pageMocks.sessionView).toHaveBeenCalledWith(
      expect.objectContaining({
        chooseCoach: true,
        sessionId: 'coaching-session-1',
      }),
    );
  });
});
