import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const architectureTestPath = fileURLToPath(import.meta.url);
const componentTestRoot = dirname(architectureTestPath);
const sourceRoot = join(componentTestRoot, '../..');
const forbiddenComponentTokens = [
  '@byzon/database',
  '@/server',
  'server-only',
  'next/',
];
const testOnlyTokens = [
  'axe-core',
  'vitest-browser-react',
  'vitest/browser',
  '/test/component',
];

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });

describe('browser component test boundary', () => {
  it('keeps browser tests independent of database and server modules', () => {
    const violations = sourceFiles(sourceRoot)
      .filter(
        (file) =>
          file !== architectureTestPath &&
          (file.startsWith(`${componentTestRoot}/`) ||
            file.endsWith('.component.tsx')),
      )
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return forbiddenComponentTokens
          .filter((token) => source.includes(token))
          .map((token) => `${relative(sourceRoot, file)} contains ${token}`);
      });

    expect(violations).toEqual([]);
  });

  it('prevents production source from importing the browser test runtime', () => {
    const violations = sourceFiles(sourceRoot)
      .filter(
        (file) =>
          !file.startsWith(`${componentTestRoot}/`) &&
          !file.endsWith('.component.tsx') &&
          !file.endsWith('.test.ts') &&
          !file.endsWith('.test.tsx'),
      )
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return testOnlyTokens
          .filter((token) => source.includes(token))
          .map((token) => `${relative(sourceRoot, file)} contains ${token}`);
      });

    expect(violations).toEqual([]);
  });
});
