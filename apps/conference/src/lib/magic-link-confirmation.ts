export const MAGIC_LINK_VERIFY_PATH = '/api/auth/magic-link/verify';
export const MAGIC_LINK_CONFIRMATION_PATH = '/prihlaseni/potvrzeni';
export const MAGIC_LINK_FIELDS = [
  'token',
  'callbackURL',
  'errorCallbackURL',
  'newUserCallbackURL',
] as const;
