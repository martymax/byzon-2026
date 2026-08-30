import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildSessionDeepLink, renderSessionQrSvg } from './session-qr';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

describe('session QR', () => {
  it('creates a stable credential-free deep link', () => {
    expect(
      buildSessionDeepLink('https://app.byzon.cz/other?q=secret', SESSION_ID),
    ).toBe(`https://app.byzon.cz/app/program/${SESSION_ID}`);
  });

  it('rejects an insecure production origin', () => {
    expect(() =>
      buildSessionDeepLink('http://app.byzon.cz', SESSION_ID),
    ).toThrow('HTTPS');
  });

  it('renders a standalone SVG QR without the source URL in metadata', async () => {
    const deepLink = buildSessionDeepLink('https://app.byzon.cz', SESSION_ID);
    const svg = await renderSessionQrSvg(deepLink);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('<path');
    expect(svg).not.toContain('credential');
    expect(() => unzipSync(new Uint8Array())).toThrow();
  });
});
