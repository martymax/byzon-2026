import { describe, expect, it, vi } from 'vitest';

const previewMocks = vi.hoisted(() => ({
  available: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('./frontend-preview', () => ({
  isFrontendPreviewAvailable: previewMocks.available,
}));
vi.mock('next/navigation', () => ({
  notFound: previewMocks.notFound,
}));

import { requireAdminFrontendPreview } from './admin-frontend-preview';

describe('F4 mock admin preview boundary', () => {
  it('fails closed outside the explicitly enabled frontend preview', () => {
    previewMocks.available.mockReturnValue(false);

    expect(() => requireAdminFrontendPreview()).toThrow('NEXT_NOT_FOUND');
    expect(previewMocks.notFound).toHaveBeenCalledOnce();
  });

  it('allows the synthetic journeys only when preview is available', () => {
    previewMocks.available.mockReturnValue(true);

    expect(() => requireAdminFrontendPreview()).not.toThrow();
  });
});
