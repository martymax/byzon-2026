import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loginMocks = vi.hoisted(() => ({
  render: vi.fn(),
  staging: false,
}));

vi.mock('../components/magic-link-login', () => ({
  MagicLinkLogin: (props: Readonly<Record<string, unknown>>) => {
    loginMocks.render(props);
    return <div data-magic-link-login="true" />;
  },
}));

vi.mock('../server/staging-environment', () => ({
  isStagingEnvironment: () => loginMocks.staging,
}));

import HomePage, { metadata } from './page';

describe('conference sign-in homepage', () => {
  beforeEach(() => {
    loginMocks.render.mockReset();
    loginMocks.staging = false;
  });

  it('enables direct e-mail login only for the staging environment', async () => {
    loginMocks.staging = true;

    renderToStaticMarkup(await HomePage({}));

    expect(loginMocks.render).toHaveBeenCalledWith({
      directEmailLogin: true,
      returnTo: '/po-prihlaseni',
    });
  });

  it('opens the safe magic-link login without a ticket activation gate', async () => {
    const markup = renderToStaticMarkup(await HomePage({}));

    expect(loginMocks.render.mock.calls[0]?.[0]).toEqual({
      returnTo: '/po-prihlaseni',
    });
    expect(markup).toBe('<div data-magic-link-login="true"></div>');
  });

  it('keeps the login document private and out of search results', () => {
    expect(metadata).toMatchObject({
      title: 'Přihlášení',
      robots: { index: false, follow: false },
    });
  });
});
