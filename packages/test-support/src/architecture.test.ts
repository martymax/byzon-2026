import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WORKSPACE_DIRECTORY = resolve(SOURCE_DIRECTORY, '../../..');
const IMPORT_SPECIFIER_PATTERN = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  'zod',
  '@byzon/domain',
  '@byzon/domain/contracts',
  '@byzon/domain/contracts/check-in',
]);

const sources = (directory = SOURCE_DIRECTORY): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return sources(entryPath);
    return extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts')
      ? [entryPath]
      : [];
  });

const isAllowedImport = (specifier: string, sourcePath: string): boolean => {
  if (ALLOWED_EXTERNAL_IMPORTS.has(specifier)) return true;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;

  const resolvedImport = resolve(dirname(sourcePath), specifier);
  const pathFromSource = relative(SOURCE_DIRECTORY, resolvedImport);
  return (
    pathFromSource === '' ||
    (!pathFromSource.startsWith('../') && pathFromSource !== '..')
  );
};

describe('test-support dependency boundary', () => {
  it('allows only shared contracts and package-local fixture code', () => {
    const violations = sources().flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, 'utf8');
      return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)]
        .map((match) => match[1])
        .filter(
          (specifier): specifier is string =>
            typeof specifier === 'string' &&
            !isAllowedImport(specifier, sourcePath),
        )
        .map((specifier) => `${sourcePath}: ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it('is not a runtime dependency of any application package', () => {
    const applicationsDirectory = join(WORKSPACE_DIRECTORY, 'apps');
    const violations = readdirSync(applicationsDirectory, {
      withFileTypes: true,
    }).flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const packagePath = join(
        applicationsDirectory,
        entry.name,
        'package.json',
      );
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      return packageJson.dependencies?.['@byzon/test-support']
        ? [packagePath]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
