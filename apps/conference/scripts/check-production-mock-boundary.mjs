import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, '..');
const sourceRoot = resolve(appRoot, 'src');
const mockRoot = resolve(sourceRoot, 'test/mocks');
const componentTestRoot = resolve(sourceRoot, 'test/component');
const instrumentationPath = resolve(sourceRoot, 'instrumentation-client.ts');
const checkinPreviewPagePath = resolve(sourceRoot, 'app/check-in/page.tsx');
const generatedWorkerPath = resolve(appRoot, 'public/mockServiceWorker.js');
const buildRoot = resolve(appRoot, '.next');
const mode = process.argv[2];

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
      file === checkinPreviewPagePath
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
