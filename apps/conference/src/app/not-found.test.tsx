import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NotFoundPage, { metadata } from './not-found';

describe('conference not-found page', () => {
  it('offers a clear route back to the participant application', () => {
    const markup = renderToStaticMarkup(<NotFoundPage />);

    expect(markup).toContain('Chyba 404');
    expect(markup).toContain('href="/app"');
    expect(markup).toContain('Zpět do aplikace');
  });

  it('keeps the missing route out of search results', () => {
    expect(metadata).toMatchObject({
      title: 'Stránka nenalezena',
      robots: { index: false, follow: false },
    });
  });
});
