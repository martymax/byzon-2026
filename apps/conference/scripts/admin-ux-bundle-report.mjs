import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const nextRoot = path.join(appRoot, '.next');
const staticRoot = path.join(nextRoot, 'static', 'chunks');

const routes = [
  ['overview', 'admin/page'],
  ['content', 'admin/obsah/page'],
  ['tickets', 'admin/vstupenky/page'],
  ['participants', 'admin/ucastnici/page'],
  ['reservations', 'admin/rezervace/page'],
  ['announcements', 'admin/oznameni/page'],
  ['engagement', 'admin/interakce/page'],
  ['team', 'admin/role/page'],
  ['reports', 'admin/reporty/page'],
  ['audit', 'admin/audit/page'],
  ['settings', 'admin/nastaveni/page'],
];

const parseManifest = async (routePath) => {
  const manifestPath = path.join(
    nextRoot,
    'server',
    'app',
    `${routePath}_client-reference-manifest.js`,
  );
  const source = await readFile(manifestPath, 'utf8');
  const assignment = source.match(/ = (\{.*\});?\s*$/s);
  if (!assignment?.[1]) {
    throw new Error(`Cannot parse client reference manifest: ${manifestPath}`);
  }
  return JSON.parse(assignment[1]);
};

const entryChunks = (manifest, suffix) => {
  const match = Object.entries(manifest.entryJSFiles).find(([key]) =>
    key.endsWith(suffix),
  );
  if (!match) throw new Error(`Missing entryJSFiles key ending in ${suffix}`);
  return new Set(match[1]);
};

const sizeOf = async (chunks) => {
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const chunk of chunks) {
    const relative = chunk.replace(/^static\/chunks\//, '');
    const filePath = path.join(staticRoot, relative);
    rawBytes += (await stat(filePath)).size;
    gzipBytes += gzipSync(await readFile(filePath), { level: 9 }).byteLength;
  }
  return { gzipBytes, rawBytes };
};

const overviewManifest = await parseManifest('admin/page');
const sharedChunks = entryChunks(
  overviewManifest,
  'apps/conference/src/app/admin/layout',
);
const shared = await sizeOf(sharedChunks);
const routeResults = {};

for (const [name, routePath] of routes) {
  const manifest = await parseManifest(routePath);
  const routeChunks = entryChunks(
    manifest,
    `apps/conference/src/app/${routePath}`,
  );
  const exclusiveChunks = new Set(
    [...routeChunks].filter((chunk) => !sharedChunks.has(chunk)),
  );
  routeResults[name] = {
    chunks: exclusiveChunks.size,
    ...(await sizeOf(exclusiveChunks)),
  };
}

const report = {
  generatedBy: 'apps/conference/scripts/admin-ux-bundle-report.mjs',
  node: process.version,
  shared: { chunks: sharedChunks.size, ...shared },
  routes: routeResults,
};

const baselineIndex = process.argv.indexOf('--baseline');
if (baselineIndex >= 0) {
  const baselinePath = process.argv[baselineIndex + 1];
  if (!baselinePath) throw new Error('--baseline requires a JSON path');
  const baseline = JSON.parse(
    await readFile(path.resolve(baselinePath), 'utf8'),
  );
  const sharedDelta = report.shared.gzipBytes - baseline.shared.gzipBytes;
  if (sharedDelta > baseline.shared.gzipBytes * 0.1) {
    throw new Error(`Shared admin gzip grew by ${sharedDelta} B (>10%).`);
  }
  for (const [name, result] of Object.entries(report.routes)) {
    const previous = baseline.routes[name];
    if (!previous) throw new Error(`Baseline is missing route ${name}.`);
    const delta = result.gzipBytes - previous.gzipBytes;
    if (delta > 20 * 1024) {
      throw new Error(`${name} route gzip grew by ${delta} B (>20 KiB).`);
    }
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
