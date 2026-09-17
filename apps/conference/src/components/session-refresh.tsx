'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import {
  POST_LOGIN_DESTINATION,
  resolveAuthReturnTo,
} from '../lib/auth-return';

const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const navigateToSession = (destination: string) =>
  window.location.replace(destination);

/** Renew HttpOnly cookies in the same browser/PWA that is using the session. */
export const SessionRefresh = ({
  fetch = globalThis.fetch,
  navigate = navigateToSession,
}: {
  readonly fetch?: typeof globalThis.fetch;
  readonly navigate?: (destination: string) => void;
}) => {
  const pathname = usePathname();
  const search = useSearchParams();
  const loginEntry = pathname === '/' || pathname === '/prihlaseni';
  const destination = resolveAuthReturnTo(
    search.get('returnTo') ?? undefined,
    POST_LOGIN_DESTINATION,
  );

  useEffect(() => {
    // A confirmation link can intentionally sign in a different account.
    if (pathname === '/prihlaseni/potvrzeni') return;
    let stopped = false;
    let pending = false;
    let refreshAgain = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (stopped || document.visibilityState === 'hidden' || !navigator.onLine)
        return;
      if (pending) {
        refreshAgain = true;
        return;
      }
      pending = true;
      try {
        const response = await fetch('/api/auth/get-session', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: '{}',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        });
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (
          !stopped &&
          loginEntry &&
          data &&
          typeof data === 'object' &&
          'session' in data &&
          data.session &&
          'user' in data &&
          data.user
        ) {
          navigate(destination);
        }
      } catch {
        // A temporary network failure must never sign the user out.
      } finally {
        pending = false;
        if (refreshAgain && !stopped) {
          refreshAgain = false;
          queueMicrotask(() => void refresh());
        }
      }
    };
    // Let Strict Mode's setup/cleanup settle before starting a request.
    queueMicrotask(() => void refresh());
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [fetch, navigate, pathname, loginEntry, destination]);

  return null;
};
