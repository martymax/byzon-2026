import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { eventRoles } from '@byzon/domain';
import { guidePath, roleGuides } from '@byzon/mail/guides';
import { guideContent } from '../../lib/public-guides';
import { requiresOnboardingAccess } from '../../lib/onboarding-access-policy';
import GuidesPage from './page';
import RoleGuidePage, { generateStaticParams } from './[role]/page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));

describe('public role guides', () => {
  it('covers every human role and has matching email destinations', () => {
    expect(roleGuides.map(({ role }) => role).sort()).toEqual(
      eventRoles.filter((role) => role !== 'system_worker').sort(),
    );
    const index = renderToStaticMarkup(<GuidesPage />);
    expect(generateStaticParams()).toHaveLength(roleGuides.length);
    for (const guide of roleGuides) {
      expect(index).toContain(`href="${guidePath(guide.slug)}"`);
      expect(requiresOnboardingAccess(guidePath(guide.slug))).toBe(false);
    }
    expect(requiresOnboardingAccess('/navody')).toBe(false);
  });
  it.each(roleGuides)(
    'renders $title without an account and with valid section links',
    async (guide) => {
      const markup = renderToStaticMarkup(
        await RoleGuidePage({ params: Promise.resolve({ role: guide.slug }) }),
      );
      const content = guideContent(guide.slug);
      expect(markup).toContain('Bez přihlášení');
      expect(markup).toContain('id="rychly-start"');
      expect(markup).toContain(
        `returnTo=${encodeURIComponent(content.destination)}`,
      );
      for (const section of content.sections) {
        expect(markup).toContain(`href="#${section.id}"`);
        expect(markup).toContain(`id="${section.id}"`);
      }
    },
  );
  it('rejects unknown roles instead of exposing a generic privileged guide', async () => {
    await expect(
      RoleGuidePage({ params: Promise.resolve({ role: 'system_worker' }) }),
    ).rejects.toThrow('not found');
  });
});
