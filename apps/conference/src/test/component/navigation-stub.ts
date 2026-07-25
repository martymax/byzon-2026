import { useSyncExternalStore } from 'react';

const subscribeToNavigation = (onStoreChange: () => void) => {
  window.addEventListener('popstate', onStoreChange);
  return () => window.removeEventListener('popstate', onStoreChange);
};

export const usePathname = (): string =>
  useSyncExternalStore(
    subscribeToNavigation,
    () => window.location.pathname,
    () => '/',
  );

export const useSearchParams = (): URLSearchParams => {
  const search = useSyncExternalStore(
    subscribeToNavigation,
    () => window.location.search,
    () => '',
  );
  return new URLSearchParams(search);
};

const navigate = (href: string, replace: boolean) => {
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method](window.history.state, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export const useRouter = () => ({
  push: (href: string, options?: { readonly scroll?: boolean }) => {
    void options;
    navigate(href, false);
  },
  replace: (href: string, options?: { readonly scroll?: boolean }) => {
    void options;
    navigate(href, true);
  },
});
