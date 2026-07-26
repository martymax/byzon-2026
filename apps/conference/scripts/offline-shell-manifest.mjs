import { createHash } from 'node:crypto';
import { cp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SHELL_ASSETS = Object.freeze([
  '/offline',
  '/icons/icon.svg',
  '/icons/maskable.svg',
  '/brand/logo.png',
  '/manifest.webmanifest',
]);

const NEXT_STATIC_PREFIX = '/_next/static/';
const MAX_SHELL_ASSETS = 256;
const MAX_SHELL_ASSET_BYTES = 2 * 1024 * 1024;

export const shellAssetDigest = (content) =>
  createHash('sha256').update(content).digest('hex');

export const shellManifestVersion = (assets, digests) =>
  shellAssetDigest(
    JSON.stringify(assets.map((asset) => [asset, digests[asset]])),
  );

export const extractOfflineShellAssets = (html) => {
  const assets = new Set();
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const asset = match[1];
    if (
      asset === '/manifest.webmanifest' ||
      asset === '/brand/logo.png' ||
      asset.startsWith(NEXT_STATIC_PREFIX)
    ) {
      assets.add(asset);
    }
  }
  return [...assets].sort();
};

const assertRegularAsset = async (path, label) => {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new TypeError(`${label} is missing.`);
  }
  if (!metadata.isFile() || metadata.size > MAX_SHELL_ASSET_BYTES) {
    throw new TypeError(`${label} is not a bounded regular file.`);
  }
};

const readShellAsset = async ({
  asset,
  html,
  publicDirectory,
  routeDirectory,
  staticDirectory,
}) => {
  if (asset === '/offline') {
    const content = Buffer.from(html, 'utf8');
    if (content.byteLength > MAX_SHELL_ASSET_BYTES) {
      throw new TypeError(`${asset} is not a bounded regular file.`);
    }
    return content;
  }

  const path = asset.startsWith(NEXT_STATIC_PREFIX)
    ? join(staticDirectory, asset.slice(NEXT_STATIC_PREFIX.length))
    : asset === '/manifest.webmanifest' && routeDirectory
      ? join(routeDirectory, 'manifest.webmanifest.body')
      : join(publicDirectory, asset.slice(1));
  await assertRegularAsset(path, asset);
  return readFile(path);
};

export const createOfflineShellManifest = async ({
  html,
  publicDirectory,
  routeDirectory,
  staticDirectory,
}) => {
  const referencedAssets = extractOfflineShellAssets(html);
  const assets = [
    ...REQUIRED_SHELL_ASSETS,
    ...referencedAssets.filter(
      (asset) => !REQUIRED_SHELL_ASSETS.includes(asset),
    ),
  ];
  if (
    assets.length > MAX_SHELL_ASSETS ||
    !assets.some((asset) => asset.endsWith('.css')) ||
    !assets.some((asset) => asset.endsWith('.js')) ||
    !assets.some((asset) => asset.endsWith('.woff2')) ||
    !referencedAssets.includes('/manifest.webmanifest')
  ) {
    throw new TypeError('Offline HTML does not expose a complete shell.');
  }
  for (const asset of assets) {
    if (
      asset.includes('\\') ||
      asset.includes('..') ||
      asset.includes('?') ||
      asset.includes('#') ||
      !/^\/[A-Za-z0-9._/-]+$/.test(asset)
    ) {
      throw new TypeError(`Unsafe offline shell asset ${asset}.`);
    }
  }
  const digestEntries = await Promise.all(
    assets.map(async (asset) => [
      asset,
      shellAssetDigest(
        await readShellAsset({
          asset,
          html,
          publicDirectory,
          routeDirectory,
          staticDirectory,
        }),
      ),
    ]),
  );
  const digests = Object.freeze(Object.fromEntries(digestEntries));
  return Object.freeze({
    assets: Object.freeze(assets),
    digests,
    version: shellManifestVersion(assets, digests),
  });
};

export const renderOfflineShellManifest = ({ assets, digests, version }) =>
  `'use strict';\nself.__BYZON_SHELL_MANIFEST__=Object.freeze({version:${JSON.stringify(
    version,
  )},assets:Object.freeze(${JSON.stringify(
    assets,
  )}),digests:Object.freeze(${JSON.stringify(digests)})});\n`;

export const packageOfflineShell = async (appRoot) => {
  const nextDirectory = join(appRoot, '.next');
  const publicDirectory = join(appRoot, 'public');
  const staticDirectory = join(nextDirectory, 'static');
  const standaloneRoot = join(
    nextDirectory,
    'standalone',
    'apps',
    'conference',
  );
  const standalonePublic = join(standaloneRoot, 'public');
  const standaloneStatic = join(standaloneRoot, '.next', 'static');
  const html = await readFile(
    join(nextDirectory, 'server', 'app', 'offline.html'),
    'utf8',
  );
  const manifest = await createOfflineShellManifest({
    html,
    publicDirectory,
    routeDirectory: join(nextDirectory, 'server', 'app'),
    staticDirectory,
  });
  const sourceDestination = join(publicDirectory, 'sw-shell-manifest.js');
  const sourceTemporary = `${sourceDestination}.tmp`;
  await writeFile(
    sourceTemporary,
    renderOfflineShellManifest(manifest),
    'utf8',
  );
  await rename(sourceTemporary, sourceDestination);

  await Promise.all([
    rm(standalonePublic, { force: true, recursive: true }),
    rm(standaloneStatic, { force: true, recursive: true }),
  ]);
  await Promise.all([
    cp(publicDirectory, standalonePublic, { recursive: true }),
    cp(staticDirectory, standaloneStatic, { recursive: true }),
  ]);
  return manifest;
};

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = await packageOfflineShell(appRoot);
  console.log(
    `Packaged ${manifest.assets.length} offline shell assets (${manifest.version}).`,
  );
}
