export const usePathname = (): string => window.location.pathname;

const navigate = (href: string, replace: boolean) => {
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method](window.history.state, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export const useRouter = () => ({
  push: (href: string) => navigate(href, false),
  replace: (href: string) => navigate(href, true),
});
