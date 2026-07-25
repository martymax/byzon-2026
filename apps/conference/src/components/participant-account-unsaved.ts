import { useEffect, useRef } from 'react';

import { requestClientNavigation } from '@/lib/client-navigation-events';

const guardStateKey = '__byzonParticipantProfileDraftGuard';

const withoutGuardState = (): Record<string, unknown> => {
  const state =
    window.history.state &&
    typeof window.history.state === 'object' &&
    !Array.isArray(window.history.state)
      ? { ...(window.history.state as Record<string, unknown>) }
      : {};
  delete state[guardStateKey];
  return state;
};

export const useParticipantAccountUnsavedGuard = (dirty: boolean) => {
  const allowNavigation = useRef(false);
  const sentinelPushed = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentState =
      window.history.state &&
      typeof window.history.state === 'object' &&
      !Array.isArray(window.history.state)
        ? (window.history.state as Record<string, unknown>)
        : {};

    if (!dirty) {
      allowNavigation.current = false;
      if (currentState[guardStateKey] === true) {
        const cleanState = { ...currentState };
        delete cleanState[guardStateKey];
        window.history.replaceState(cleanState, '', window.location.href);
      }
      sentinelPushed.current = false;
      return;
    }

    allowNavigation.current = false;
    if (currentState[guardStateKey] !== true) {
      window.history.pushState(
        { ...currentState, [guardStateKey]: true },
        '',
        window.location.href,
      );
      sentinelPushed.current = true;
    }

    const confirmLeave = () =>
      window.confirm(
        'Opravdu chcete profil opustit? Neuložené změny se zahodí.',
      );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNavigation.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const guardLink = (event: MouseEvent) => {
      if (
        allowNavigation.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) {
        return;
      }
      const destination = new URL(link.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash !== current.hash
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!confirmLeave()) return;

      allowNavigation.current = true;
      const href = `${destination.pathname}${destination.search}${destination.hash}`;
      const navigate = () => {
        if (
          destination.origin === current.origin &&
          (destination.protocol === 'http:' ||
            destination.protocol === 'https:')
        ) {
          requestClientNavigation(href);
          return;
        }
        window.location.assign(link.href);
      };
      if (
        sentinelPushed.current &&
        window.history.state &&
        typeof window.history.state === 'object' &&
        !Array.isArray(window.history.state) &&
        (window.history.state as Record<string, unknown>)[guardStateKey] ===
          true
      ) {
        window.history.replaceState(
          withoutGuardState(),
          '',
          window.location.href,
        );
        sentinelPushed.current = false;
        window.addEventListener('popstate', navigate, { once: true });
        window.history.back();
        return;
      }
      navigate();
    };
    const guardBack = () => {
      if (allowNavigation.current) return;
      if (confirmLeave()) {
        allowNavigation.current = true;
        sentinelPushed.current = false;
        const navigation = (
          window as Window & {
            readonly navigation?: { readonly canGoBack?: boolean };
          }
        ).navigation;
        const navigateToFallback = () => {
          const beforeNavigation = window.location.href;
          requestClientNavigation('/app/vice');
          window.setTimeout(() => {
            if (window.location.href === beforeNavigation) {
              allowNavigation.current = false;
            }
          }, 100);
        };
        if (navigation?.canGoBack === false) {
          navigateToFallback();
          return;
        }
        let navigated = false;
        const observeNavigation = () => {
          navigated = true;
        };
        window.addEventListener('popstate', observeNavigation, { once: true });
        window.history.back();
        window.setTimeout(() => {
          window.removeEventListener('popstate', observeNavigation);
          if (!navigated) {
            navigateToFallback();
          }
        }, 100);
        return;
      }
      window.history.pushState(
        { ...currentState, [guardStateKey]: true },
        '',
        window.location.href,
      );
    };

    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', guardBack);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', guardBack);
      document.removeEventListener('click', guardLink, true);
      let shouldConsumeSentinel = false;
      if (
        sentinelPushed.current &&
        window.history.state &&
        typeof window.history.state === 'object' &&
        !Array.isArray(window.history.state) &&
        (window.history.state as Record<string, unknown>)[guardStateKey] ===
          true
      ) {
        window.history.replaceState(
          withoutGuardState(),
          '',
          window.location.href,
        );
        shouldConsumeSentinel = !allowNavigation.current;
      }
      sentinelPushed.current = false;
      if (shouldConsumeSentinel) {
        window.history.back();
      }
    };
  }, [dirty]);
};
