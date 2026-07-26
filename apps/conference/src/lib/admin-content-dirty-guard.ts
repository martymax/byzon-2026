export const ADMIN_CONTENT_SCOPE_CHANGE_EVENT =
  'byzon:admin-content-before-scope-change';

export const mayLeaveAdminContentDraft = (): boolean =>
  typeof window === 'undefined'
    ? true
    : window.dispatchEvent(
        new Event(ADMIN_CONTENT_SCOPE_CHANGE_EVENT, { cancelable: true }),
      );
