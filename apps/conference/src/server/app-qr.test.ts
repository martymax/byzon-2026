import { describe, expect, it, vi } from 'vitest';

import {
  CANONICAL_APP_QR_PAYLOAD,
  createCanonicalAppQrSvg,
  readCanonicalAppQr,
} from './app-qr';

describe('general application QR', () => {
  it('encodes only the canonical credential-free application origin', async () => {
    const encode = vi.fn().mockResolvedValue('<svg><path /></svg>');
    const svg = await createCanonicalAppQrSvg(encode);
    expect(encode).toHaveBeenCalledWith(
      CANONICAL_APP_QR_PAYLOAD,
      expect.objectContaining({ type: 'svg', errorCorrectionLevel: 'H' }),
    );
    expect(CANONICAL_APP_QR_PAYLOAD).toBe('https://app.byzon.cz');
    expect(CANONICAL_APP_QR_PAYLOAD).not.toContain('/app/program/');
    expect(svg).toContain('data-byzon-qr-kind="general-app"');
    expect(svg).toContain('nejde o vstupenku ani session QR');
  });

  it('serves a version-cacheable SVG without cookies or credentials', async () => {
    const response = await readCanonicalAppQr(
      new Request('https://app.byzon.cz/api/v1/public/app-qr.svg'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
