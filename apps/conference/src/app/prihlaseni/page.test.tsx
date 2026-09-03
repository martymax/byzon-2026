import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loginMocks = vi.hoisted(() => ({
  render: vi.fn(),
  staging: false,
}));

vi.mock('../../components/magic-link-login', () => ({
  MagicLinkLogin: (props: Readonly<Record<string, unknown>>) => {
    loginMocks.render(props);
    return <div data-magic-link-login="true" />;
  },
}));

vi.mock('../../server/staging-environment', () => ({
  isStagingEnvironment: () => loginMocks.staging,
}));

import LoginPage from './page';

describe('dedicated sign-in page', () => {
  beforeEach(() => {
    loginMocks.render.mockReset();
    loginMocks.staging = false;
  });

  it('enables direct e-mail login only for the staging environment', async () => {
    loginMocks.staging = true;

    renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({ returnTo: '/app' }) }),
    );

    expect(loginMocks.render).toHaveBeenCalledWith({
      directEmailLogin: true,
      returnTo: '/app',
    });
  });

  it('uses the role-aware destination by default', async () => {
    renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({}) }),
    );

    expect(loginMocks.render).toHaveBeenCalledWith({
      returnTo: '/po-prihlaseni',
    });
  });

  it('keeps an explicit allowlisted admin destination', async () => {
    renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ returnTo: '/admin/interakce' }),
      }),
    );

    expect(loginMocks.render).toHaveBeenCalledWith({
      returnTo: '/admin/interakce',
    });
  });

  it('marks an expired or consumed link without reflecting unknown errors', async () => {
    renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({
          error: 'INVALID_TOKEN',
          returnTo: '/app',
        }),
      }),
    );
    expect(loginMocks.render).toHaveBeenLastCalledWith({
      invalidLink: true,
      returnTo: '/app',
    });

    loginMocks.render.mockReset();
    renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ error: 'unexpected' }),
      }),
    );
    expect(loginMocks.render).toHaveBeenLastCalledWith({
      returnTo: '/po-prihlaseni',
    });
  });
});
