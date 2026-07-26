import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loginFlowMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('@/components/login-flow', () => ({
  LoginFlow: (props: Readonly<Record<string, unknown>>) => {
    loginFlowMocks.render(props);
    return <div data-login-flow="true" />;
  },
}));

import HomePage, { metadata } from './page';

describe('conference sign-in homepage', () => {
  beforeEach(() => {
    loginFlowMocks.render.mockReset();
  });

  it('opens the safe magic-link login without a marketing journey hub', () => {
    const markup = renderToStaticMarkup(<HomePage />);

    expect(loginFlowMocks.render.mock.calls[0]?.[0]).toEqual({
      mode: 'recovery',
      presentation: 'login',
      returnTo: '/app',
    });
    expect(markup).toBe('<div data-login-flow="true"></div>');
  });

  it('keeps the login document private and out of search results', () => {
    expect(metadata).toMatchObject({
      title: 'Přihlášení',
      robots: { index: false, follow: false },
    });
  });
});
