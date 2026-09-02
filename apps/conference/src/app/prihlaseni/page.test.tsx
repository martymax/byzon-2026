import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loginMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('../../components/magic-link-login', () => ({
  MagicLinkLogin: (props: Readonly<Record<string, unknown>>) => {
    loginMocks.render(props);
    return <div data-magic-link-login="true" />;
  },
}));

import LoginPage from './page';

describe('dedicated sign-in page', () => {
  beforeEach(() => {
    loginMocks.render.mockReset();
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
