import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_SHELL_ASSETS,
  shellManifestVersion,
} from './offline-shell-manifest.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, '..');
const sourceRoot = resolve(appRoot, 'src');
const mockRoot = resolve(sourceRoot, 'test/mocks');
const componentTestRoot = resolve(sourceRoot, 'test/component');
const instrumentationPath = resolve(sourceRoot, 'instrumentation-client.ts');
const checkinPreviewPagePath = resolve(sourceRoot, 'app/check-in/page.tsx');
const participantCurrentEventPath = resolve(
  sourceRoot,
  'server/current-event.ts',
);
const generatedWorkerPath = resolve(appRoot, 'public/mockServiceWorker.js');
const buildRoot = resolve(appRoot, '.next');
const mode = process.argv[2];
const standaloneAppRoot = resolve(
  buildRoot,
  'standalone',
  'apps',
  'conference',
);
const standaloneShellManifestPath = resolve(
  standaloneAppRoot,
  'public/sw-shell-manifest.js',
);
const nextStaticPrefix = '/_next/static/';

const failures = [];
const runtimeExtensions = new Set([
  '.js',
  '.mjs',
  '.json',
  '.css',
  '.html',
  '.ts',
  '.tsx',
]);
const forbiddenRuntimePatterns = [
  ['MSW browser import', /msw\/browser/],
  ['MSW Node import', /msw\/node/],
  ['test-support import', /@byzon\/test-support/],
  ['mock runtime marker', /BYZON_MOCK_RUNTIME_F0_05/],
  ['mock environment switch', /NEXT_PUBLIC_BYZON_API_MOCKS/],
  ['mock worker asset', /mockServiceWorker\.js/],
  ['mock source path', /(?:\/|\\)test(?:\/|\\)mocks/],
  ['Vitest browser runtime', /vitest-browser-react|vitest\/browser/],
  ['axe Playwright runtime', /@axe-core\/playwright/],
  ['axe browser runtime', /(?:^|["'/])axe-core(?:["'/]|$)/m],
  ['component test source path', /(?:\/|\\)test(?:\/|\\)component/],
  [
    'check-in demo transport import',
    /from\s*['"][^'"]*checkin-demo-api(?:\.[cm]?[jt]sx?)?['"]/,
  ],
];
const forbiddenBuildPatterns = [
  ...forbiddenRuntimePatterns,
  ['check-in preview scenario marker', /BYZON_CHECKIN_PREVIEW_SCENARIOS_F5/],
  [
    'check-in synthetic scenario code',
    /DEMO-(?:VALID|DUPLICATE|CANCELLED|REFUNDED|BLOCKED|UNKNOWN|ERROR)/,
  ],
  ['participant preview event marker', /BYZON_PARTICIPANT_PREVIEW_EVENT_F6/],
];

const filesUnder = (directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    let stats;
    try {
      stats = lstatSync(path);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    if (stats.isSymbolicLink()) return [];
    return stats.isDirectory() ? filesUnder(path) : [path];
  });
};

const reportMatches = (file, source, patterns = forbiddenRuntimePatterns) => {
  for (const [label, pattern] of patterns) {
    if (pattern.test(source)) {
      failures.push(`${relative(appRoot, file)} contains ${label}`);
    }
  }
};

const checkStandaloneShellManifest = () => {
  if (!existsSync(standaloneShellManifestPath)) {
    failures.push(
      '.next standalone output is missing public/sw-shell-manifest.js',
    );
    return;
  }
  const source = readFileSync(standaloneShellManifestPath, 'utf8');
  const match =
    /^'use strict';\nself\.__BYZON_SHELL_MANIFEST__=Object\.freeze\(\{version:("[0-9a-f]{8}"),assets:Object\.freeze\((\[[^\r\n]+\])\)\}\);\n$/.exec(
      source,
    );
  if (!match) {
    failures.push(
      '.next standalone shell manifest does not match the generated format',
    );
    return;
  }

  let version;
  let assets;
  try {
    version = JSON.parse(match[1]);
    assets = JSON.parse(match[2]);
  } catch {
    failures.push('.next standalone shell manifest is not valid JSON');
    return;
  }
  if (
    !Array.isArray(assets) ||
    assets.length > 256 ||
    assets.some((asset) => typeof asset !== 'string') ||
    new Set(assets).size !== assets.length ||
    REQUIRED_SHELL_ASSETS.some((asset) => !assets.includes(asset)) ||
    !assets.some((asset) => asset.endsWith('.css')) ||
    !assets.some((asset) => asset.endsWith('.js')) ||
    !assets.some((asset) => asset.endsWith('.woff2')) ||
    shellManifestVersion(assets) !== version
  ) {
    failures.push(
      '.next standalone shell manifest is incomplete or has an invalid fingerprint',
    );
    return;
  }

  for (const asset of assets) {
    if (
      asset.includes('\\') ||
      asset.includes('..') ||
      asset.includes('?') ||
      asset.includes('#') ||
      !/^\/[A-Za-z0-9._/-]+$/.test(asset)
    ) {
      failures.push(
        `.next standalone shell manifest contains unsafe asset ${asset}`,
      );
      continue;
    }

    let packagedPath = null;
    if (asset.startsWith(nextStaticPrefix)) {
      packagedPath = resolve(
        standaloneAppRoot,
        '.next/static',
        asset.slice(nextStaticPrefix.length),
      );
    } else if (asset === '/manifest.webmanifest') {
      packagedPath = resolve(
        standaloneAppRoot,
        '.next/server/app/manifest.webmanifest.body',
      );
    } else if (asset !== '/offline') {
      packagedPath = resolve(standaloneAppRoot, 'public', asset.slice(1));
    }
    if (
      packagedPath &&
      (!existsSync(packagedPath) || !lstatSync(packagedPath).isFile())
    ) {
      failures.push(
        `.next standalone shell asset ${asset} is not packaged as a regular file`,
      );
    }
  }

  for (const routeAsset of ['.next/server/app/offline.html', 'public/sw.js']) {
    const packagedPath = resolve(standaloneAppRoot, routeAsset);
    if (!existsSync(packagedPath) || !lstatSync(packagedPath).isFile()) {
      failures.push(
        `.next standalone offline runtime is missing ${routeAsset}`,
      );
    }
  }
};

const checkSourceBoundary = () => {
  const packageJsonPath = resolve(appRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  for (const dependency of ['msw', '@byzon/test-support', 'axe-core']) {
    if (packageJson.dependencies?.[dependency]) {
      failures.push(`${dependency} must remain a devDependency`);
    }
    if (!packageJson.devDependencies?.[dependency]) {
      failures.push(`${dependency} must be declared as a devDependency`);
    }
  }

  if (existsSync(generatedWorkerPath)) {
    failures.push(
      'public/mockServiceWorker.js is generated for development and must be removed before production build',
    );
  }

  for (const file of filesUnder(sourceRoot)) {
    if (
      file === instrumentationPath ||
      file.startsWith(`${mockRoot}/`) ||
      file.startsWith(`${componentTestRoot}/`) ||
      /\.test\.[cm]?[jt]sx?$/.test(file)
    ) {
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const patterns =
      file === checkinPreviewPagePath || file === participantCurrentEventPath
        ? forbiddenRuntimePatterns.filter(
            ([label]) => label !== 'mock source path',
          )
        : forbiddenRuntimePatterns;
    reportMatches(file, readFileSync(file, 'utf8'), patterns);
  }

  if (!existsSync(instrumentationPath)) {
    failures.push('src/instrumentation-client.ts is missing');
    return;
  }
  const instrumentation = readFileSync(instrumentationPath, 'utf8')
    .replace(/^export \{\};\s*/, '')
    .trim();
  if (
    !instrumentation.startsWith(
      "if (process.env.NODE_ENV === 'development') {",
    ) ||
    !instrumentation.endsWith('}')
  ) {
    failures.push(
      'instrumentation-client mock bootstrap must stay inside the development-only top-level guard',
    );
  }
  if (/^import\s/m.test(instrumentation)) {
    failures.push('instrumentation-client must not statically import mocks');
  }
  if (!instrumentation.includes("await import('./test/mocks/browser')")) {
    failures.push(
      'instrumentation-client must dynamically import browser mocks',
    );
  }

  const checkinPreviewPage = readFileSync(checkinPreviewPagePath, 'utf8');
  if (
    !checkinPreviewPage.includes("process.env.NODE_ENV !== 'development'") ||
    !checkinPreviewPage.includes("process.env.NODE_ENV !== 'test'") ||
    !/await\s+import\(\s*['"]\.\.\/\.\.\/test\/mocks\/checkin-preview-operator['"]\s*\)/.test(
      checkinPreviewPage,
    )
  ) {
    failures.push(
      'check-in preview scenarios must stay behind the explicit build-time environment guard and dynamic import',
    );
  }

  const participantCurrentEvent = readFileSync(
    participantCurrentEventPath,
    'utf8',
  );
  if (
    !participantCurrentEvent.includes(
      "process.env.NODE_ENV !== 'development'",
    ) ||
    !participantCurrentEvent.includes("process.env.NODE_ENV !== 'test'") ||
    !participantCurrentEvent.includes(
      "process.env.BYZON_FRONTEND_PREVIEW !== 'enabled'",
    ) ||
    !/await\s+import\(\s*['"]\.\.\/test\/mocks\/participant-preview-event['"]\s*\)/.test(
      participantCurrentEvent,
    )
  ) {
    failures.push(
      'participant preview event must stay behind explicit environment guards and a dynamic mock import',
    );
  }
};

const checkBuildBoundary = () => {
  if (!existsSync(buildRoot)) {
    failures.push('.next production output is missing');
    return;
  }
  const roots = ['static', 'server', 'standalone'].map((name) =>
    resolve(buildRoot, name),
  );
  const buildFiles = roots
    .flatMap(filesUnder)
    .filter((file) => runtimeExtensions.has(extname(file)));
  if (buildFiles.length === 0) {
    failures.push('no production artifacts were found to inspect');
    return;
  }
  for (const file of buildFiles) {
    const source = readFileSync(file, 'utf8');
    if (basename(file) === 'package.json') {
      const packageJson = JSON.parse(source);
      for (const dependency of ['msw', '@byzon/test-support', 'axe-core']) {
        if (
          packageJson.dependencies?.[dependency] ||
          packageJson.optionalDependencies?.[dependency]
        ) {
          failures.push(
            `${relative(appRoot, file)} declares runtime dependency ${dependency}`,
          );
        }
      }
      continue;
    }
    reportMatches(file, source, forbiddenBuildPatterns);
  }
  checkStandaloneShellManifest();
};

if (mode === 'source') {
  checkSourceBoundary();
} else if (mode === 'build') {
  checkBuildBoundary();
} else {
  failures.push(
    'usage: node scripts/check-production-mock-boundary.mjs <source|build>',
  );
}

if (failures.length > 0) {
  console.error('Production mock boundary failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Production mock boundary (${mode}) passed.`);
}
