import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createOfflineShellManifest,
  extractOfflineShellAssets,
  packageOfflineShell,
  renderOfflineShellManifest,
  shellAssetDigest,
  shellManifestVersion,
} from './offline-shell-manifest.mjs';

const temporaryDirectories = [];

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'byzon-shell-'));
  temporaryDirectories.push(root);
  const publicDirectory = join(root, 'public');
  const staticDirectory = join(root, 'static');
  await Promise.all([
    mkdir(join(publicDirectory, 'brand'), { recursive: true }),
    mkdir(join(publicDirectory, 'icons'), { recursive: true }),
    mkdir(join(staticDirectory, 'chunks'), { recursive: true }),
    mkdir(join(staticDirectory, 'media'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(publicDirectory, 'brand', 'logo.png'), 'logo'),
    writeFile(join(publicDirectory, 'icons', 'icon.svg'), '<svg/>'),
    writeFile(join(publicDirectory, 'icons', 'maskable.svg'), '<svg/>'),
    writeFile(join(publicDirectory, 'manifest.webmanifest'), '{}'),
    writeFile(join(staticDirectory, 'chunks', 'app.css'), 'body{}'),
    writeFile(join(staticDirectory, 'chunks', 'app.js'), 'self.app=1'),
    writeFile(join(staticDirectory, 'media', 'font.woff2'), 'font'),
  ]);
  return { publicDirectory, staticDirectory };
};

const completeHtml = `<!doctype html>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preload" href="/_next/static/media/font.woff2">
  <link rel="stylesheet" href="/_next/static/chunks/app.css">
  <script src="/_next/static/chunks/app.js"></script>
  <img src="/brand/logo.png" alt="">
  <a href="/">ignored</a>`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('offline shell build manifest', () => {
  it('extracts and renders every deterministic route dependency', async () => {
    const paths = await fixture();
    const manifest = await createOfflineShellManifest({
      html: completeHtml,
      ...paths,
    });

    expect(extractOfflineShellAssets(completeHtml)).toEqual([
      '/_next/static/chunks/app.css',
      '/_next/static/chunks/app.js',
      '/_next/static/media/font.woff2',
      '/brand/logo.png',
      '/manifest.webmanifest',
    ]);
    expect(manifest.assets).toEqual([
      '/offline',
      '/icons/icon.svg',
      '/icons/maskable.svg',
      '/brand/logo.png',
      '/manifest.webmanifest',
      '/_next/static/chunks/app.css',
      '/_next/static/chunks/app.js',
      '/_next/static/media/font.woff2',
    ]);
    expect(Object.keys(manifest.digests)).toEqual(manifest.assets);
    expect(manifest.digests['/offline']).toBe(shellAssetDigest(completeHtml));
    expect(manifest.digests['/icons/icon.svg']).toBe(
      shellAssetDigest('<svg/>'),
    );
    expect(manifest.digests['/brand/logo.png']).toBe(shellAssetDigest('logo'));
    expect(manifest.version).toBe(
      shellManifestVersion(manifest.assets, manifest.digests),
    );
    expect(renderOfflineShellManifest(manifest)).toContain(
      'self.__BYZON_SHELL_MANIFEST__=Object.freeze',
    );
    expect(renderOfflineShellManifest(manifest)).toContain(
      'digests:Object.freeze',
    );
  });

  it('rotates the fingerprint when route or stable asset content changes', async () => {
    const paths = await fixture();
    const original = await createOfflineShellManifest({
      html: completeHtml,
      ...paths,
    });
    const changedRoute = await createOfflineShellManifest({
      html: completeHtml.replace('ignored', 'changed route copy'),
      ...paths,
    });

    expect(changedRoute.assets).toEqual(original.assets);
    expect(changedRoute.digests['/offline']).not.toBe(
      original.digests['/offline'],
    );
    expect(changedRoute.version).not.toBe(original.version);

    await writeFile(
      join(paths.publicDirectory, 'icons', 'icon.svg'),
      '<svg><title>changed</title></svg>',
    );
    const changedIcon = await createOfflineShellManifest({
      html: completeHtml,
      ...paths,
    });

    expect(changedIcon.assets).toEqual(original.assets);
    expect(changedIcon.digests['/icons/icon.svg']).not.toBe(
      original.digests['/icons/icon.svg'],
    );
    expect(changedIcon.version).not.toBe(original.version);
  });

  it('fails the production build for an incomplete or missing dependency', async () => {
    const paths = await fixture();
    await expect(
      createOfflineShellManifest({
        html: completeHtml.replace(
          '/_next/static/chunks/app.js',
          '/_next/static/chunks/missing.js',
        ),
        ...paths,
      }),
    ).rejects.toThrow('/_next/static/chunks/missing.js');
    await expect(
      createOfflineShellManifest({
        html: '<link rel="manifest" href="/manifest.webmanifest">',
        ...paths,
      }),
    ).rejects.toThrow('complete shell');
  });

  it('writes the same generated manifest for standard and standalone production serving', async () => {
    const root = await mkdtemp(join(tmpdir(), 'byzon-package-shell-'));
    temporaryDirectories.push(root);
    const publicDirectory = join(root, 'public');
    const nextDirectory = join(root, '.next');
    const staticDirectory = join(nextDirectory, 'static');
    await Promise.all([
      mkdir(join(publicDirectory, 'brand'), { recursive: true }),
      mkdir(join(publicDirectory, 'icons'), { recursive: true }),
      mkdir(join(staticDirectory, 'chunks'), { recursive: true }),
      mkdir(join(staticDirectory, 'media'), { recursive: true }),
      mkdir(join(nextDirectory, 'server', 'app'), { recursive: true }),
      mkdir(join(nextDirectory, 'standalone', 'apps', 'conference'), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      writeFile(join(publicDirectory, 'sw.js'), 'worker'),
      writeFile(join(publicDirectory, 'brand', 'logo.png'), 'logo'),
      writeFile(join(publicDirectory, 'icons', 'icon.svg'), '<svg/>'),
      writeFile(join(publicDirectory, 'icons', 'maskable.svg'), '<svg/>'),
      writeFile(join(staticDirectory, 'chunks', 'app.css'), 'body{}'),
      writeFile(join(staticDirectory, 'chunks', 'app.js'), 'self.app=1'),
      writeFile(join(staticDirectory, 'media', 'font.woff2'), 'font'),
      writeFile(
        join(nextDirectory, 'server', 'app', 'offline.html'),
        completeHtml,
      ),
      writeFile(
        join(nextDirectory, 'server', 'app', 'manifest.webmanifest.body'),
        '{}',
      ),
    ]);

    const manifest = await packageOfflineShell(root);
    const source = await readFile(
      join(publicDirectory, 'sw-shell-manifest.js'),
      'utf8',
    );
    const standalone = await readFile(
      join(
        nextDirectory,
        'standalone',
        'apps',
        'conference',
        'public',
        'sw-shell-manifest.js',
      ),
      'utf8',
    );

    expect(source).toBe(standalone);
    expect(source).toContain(manifest.version);
    await expect(
      readFile(
        join(
          nextDirectory,
          'standalone',
          'apps',
          'conference',
          '.next',
          'static',
          'chunks',
          'app.js',
        ),
        'utf8',
      ),
    ).resolves.toContain('self.app');
  });
});
