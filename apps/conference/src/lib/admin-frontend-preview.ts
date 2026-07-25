import { notFound } from 'next/navigation';

import { isFrontendPreviewAvailable } from './frontend-preview';

/**
 * Mock administration journeys must fail closed outside a frontend preview.
 * The integrated /admin/obsah route intentionally does not call this guard.
 */
export const requireAdminFrontendPreview = (): void => {
  if (!isFrontendPreviewAvailable()) notFound();
};
