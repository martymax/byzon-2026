import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import nextConfig, { publicShellCacheControl } from '../../../next.config';

describe('public offline shell response policy', () => {
  it('marks every unhashed shell endpoint explicitly public and revalidated', async () => {
    const rules = await nextConfig.headers?.();

    for (const source of [
      '/offline',
      '/manifest.webmanifest',
      '/icons/:path*',
    ]) {
      expect(
        rules?.find((rule) => rule.source === source)?.headers,
      ).toContainEqual({
        key: 'Cache-Control',
        value: publicShellCacheControl,
      });
    }
    expect(publicShellCacheControl).toMatch(/(?:^|,)\s*public(?:\s|,|$)/i);
    expect(publicShellCacheControl).not.toMatch(/\b(?:private|no-store)\b/i);
  });

  it('forces the generated shell manifest and worker through revalidation', async () => {
    const rules = await nextConfig.headers?.();

    for (const source of ['/sw-shell-manifest.js', '/sw.js']) {
      expect(
        rules?.find((rule) => rule.source === source)?.headers,
      ).toContainEqual({
        key: 'Cache-Control',
        value: 'no-cache, no-store, must-revalidate',
      });
    }
  });

  it('packages the generated manifest after Next has emitted hashed route assets', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { readonly scripts?: { readonly build?: string } };

    expect(packageJson.scripts?.build).toContain(
      'next build && node scripts/offline-shell-manifest.mjs',
    );
  });
});
