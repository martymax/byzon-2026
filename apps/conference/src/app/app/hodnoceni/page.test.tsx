import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  load: vi.fn(),
  feedbackLink: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/event-survey', () => ({ EventRating: () => null }));
vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: () => false,
}));
vi.mock('@/server/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('@/server/current-event', () => ({
  loadParticipantCurrentEvent: mocks.load,
}));
vi.mock('@/server/participant-feedback-link', () => ({
  participantFeedbackLink: mocks.feedbackLink,
}));
import EventRatingPage from './page';

beforeEach(() => vi.clearAllMocks());
it('redirects anonymous visitors back through participant login before loading the survey', async () => {
  mocks.getSession.mockResolvedValue(null);
  await expect(EventRatingPage()).rejects.toThrow(
    'redirect:/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fhodnoceni',
  );
  expect(mocks.load).not.toHaveBeenCalled();
});
it('routes a signed-in participant to the same resumable evaluation used in email', async () => {
  mocks.getSession.mockResolvedValue({ user: { id: 'participant' } });
  mocks.load.mockResolvedValue({
    kind: 'available',
    event: { id: 'event', endsAt: new Date('2026-09-19T20:00:00Z') },
  });
  mocks.feedbackLink.mockResolvedValue('/hodnoceni/scoped-token');
  await expect(EventRatingPage()).rejects.toThrow(
    'redirect:/hodnoceni/scoped-token',
  );
  expect(mocks.feedbackLink).toHaveBeenCalledWith('event', 'participant');
});
