import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

import ConfirmLoginPage from './page';

describe('login confirmation page', () => {
  it('renders a native POST form without any automatic verification or token link', async () => {
    const markup = renderToStaticMarkup(
      await ConfirmLoginPage({
        searchParams: Promise.resolve({
          token: 'secret',
          callbackURL: '/app/networking',
        }),
      }),
    );
    expect(markup).toContain('method="post"');
    expect(markup).toContain('action="/api/auth/magic-link/verify"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('Dokončit přihlášení');
    expect(markup).toContain('name="token" value="secret"');
    expect(markup).not.toContain('<a');
    expect(markup).not.toContain('<script');
  });

  it.each([{}, { token: '' }, { token: ['one', 'two'] }])(
    'recovers a missing or ambiguous token',
    async (query) => {
      await expect(
        ConfirmLoginPage({ searchParams: Promise.resolve(query) }),
      ).rejects.toThrow('redirect:/prihlaseni?error=INVALID_TOKEN');
    },
  );
});
