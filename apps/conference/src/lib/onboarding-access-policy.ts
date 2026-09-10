const recoveryPaths = new Set([
  '/app/soukromi',
  '/app/nastaveni',
  '/api/v1/me/bootstrap',
  '/api/v1/me/onboarding',
  '/api/v1/me/privacy-requests',
  '/api/v1/me/session-action',
  '/api/v1/auth/logout-all',
]);
export const within = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`);

export const requiresOnboardingAccess = (pathname: string): boolean => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (recoveryPaths.has(path) || within(path, '/api/v1/public')) return false;
  return ['/app', '/admin', '/host', '/moderator', '/api/v1'].some((root) =>
    within(path, root),
  );
};
