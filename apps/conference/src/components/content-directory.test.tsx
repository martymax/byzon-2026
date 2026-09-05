import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { PublishedContent } from '@byzon/domain/contracts';

vi.mock('./content-state', () => ({
  EmptyContent: () => null,
  ResourceStatus: () => null,
  useParticipantContent: () => null,
  useParticipantProgram: () => null,
}));

import { PartnerLogoGrid } from './content-directory';

const linkedPartner: PublishedContent['partners'][number] = {
  id: '01910000-0000-7000-8000-000000000006',
  slug: 'partner-test',
  name: 'Partner Test',
  descriptionMarkdown: null,
  websiteUrl: 'https://partner.example.test/',
  category: null,
  tier: null,
  logoAssetId: null,
  status: 'published',
  sortOrder: 0,
  version: 1,
};

describe('partner logo grid', () => {
  it('opens a partner website in a new panel with safe external-link semantics', () => {
    const markup = renderToStaticMarkup(
      <PartnerLogoGrid partners={[linkedPartner]} />,
    );

    expect(markup).toContain('href="https://partner.example.test/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(
      'aria-label="Partner Test – web partnera (otevře se v novém panelu)"',
    );
  });

  it('hides the replaced Livest entry when Frame Land is available', () => {
    const markup = renderToStaticMarkup(
      <PartnerLogoGrid
        partners={[
          {
            ...linkedPartner,
            id: `${linkedPartner.id.slice(0, -1)}7`,
            slug: 'livest',
            name: 'LIVEST',
          },
          {
            ...linkedPartner,
            id: `${linkedPartner.id.slice(0, -1)}8`,
            slug: 'frame-land',
            name: 'Frame Land',
          },
        ]}
      />,
    );

    expect(markup).toContain('Frame Land');
    expect(markup).not.toContain('LIVEST');
  });
});
