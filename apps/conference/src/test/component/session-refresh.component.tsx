import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRefresh } from '../../components/session-refresh';
import { renderComponent } from './render';

const authenticated = () =>
  Response.json({ session: { id: 'session' }, user: { id: 'user' } });

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('persistent browser and installed-app sessions', () => {
  it('resumes a signed-in app opened from the PWA start URL instead of asking for a new login', async () => {
    const navigate = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => authenticated());
    await renderComponent(<SessionRefresh fetch={fetch} navigate={navigate} />);
    await expect.poll(() => navigate.mock.calls).toEqual([['/po-prihlaseni']]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/get-session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([
    '/prihlaseni?returnTo=%2Fadmin%2Frezervace',
    '/prihlaseni?returnTo=https%3A%2F%2Fattacker.test',
  ])('resumes only an allowlisted destination from %s', async (path) => {
    window.history.replaceState({}, '', path);
    const navigate = vi.fn();
    await renderComponent(
      <SessionRefresh
        fetch={async () => authenticated()}
        navigate={navigate}
      />,
    );
    await expect.poll(() => navigate.mock.calls.length).toBe(1);
    expect(navigate).toHaveBeenCalledWith(
      path.includes('attacker') ? '/po-prihlaseni' : '/admin/rezervace',
    );
  });

  it('rechecks a pending login when the user returns from their email', async () => {
    const navigate = vi.fn();
    const anonymous = Response.json(null);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(anonymous)
      .mockImplementation(async () => authenticated());
    await renderComponent(<SessionRefresh fetch={fetch} navigate={navigate} />);
    await expect.poll(() => fetch.mock.calls.length).toBe(1);
    await expect.poll(() => anonymous.bodyUsed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => navigate.mock.calls.length).toBe(1);
  });

  it('recovers from network failures without logging out or moving a protected page', async () => {
    window.history.replaceState({}, '', '/app/networking');
    const navigate = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockImplementation(async () => authenticated());
    await renderComponent(<SessionRefresh fetch={fetch} navigate={navigate} />);
    await expect.poll(() => fetch.mock.calls.length).toBe(1);
    window.dispatchEvent(new Event('online'));
    await expect.poll(() => fetch.mock.calls.length).toBe(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not duplicate pending refreshes and ignores responses after unmount', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const navigate = vi.fn();
    const screen = await renderComponent(
      <SessionRefresh fetch={fetch} navigate={navigate} />,
    );
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    expect(fetch).toHaveBeenCalledTimes(1);
    await screen.unmount();
    finish(authenticated());
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renews an open app periodically without redirecting its current task', async () => {
    window.history.replaceState({}, '', '/app');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => authenticated());
    const navigate = vi.fn();
    const screen = await renderComponent(
      <SessionRefresh fetch={fetch} navigate={navigate} />,
    );
    await expect.poll(() => fetch.mock.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
    await screen.unmount();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('leaves an explicit email confirmation to its own login flow', async () => {
    window.history.replaceState(
      {},
      '',
      '/prihlaseni/potvrzeni?token=synthetic',
    );
    const fetch = vi.fn<typeof globalThis.fetch>();
    await renderComponent(<SessionRefresh fetch={fetch} navigate={vi.fn()} />);
    expect(fetch).not.toHaveBeenCalled();
  });
});
