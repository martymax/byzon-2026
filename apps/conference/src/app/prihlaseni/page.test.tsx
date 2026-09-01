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
});
