import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONTRACTS_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const IMPORT_SPECIFIER_PATTERN = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

const contractSources = (directory = CONTRACTS_DIRECTORY): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return contractSources(entryPath);
    return extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts')
      ? [entryPath]
      : [];
  });

const isAllowedContractImport = (
  specifier: string,
  sourcePath: string,
): boolean => {
  if (specifier === 'zod') return true;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;

  const resolvedImport = resolve(dirname(sourcePath), specifier);
  const pathFromContracts = relative(CONTRACTS_DIRECTORY, resolvedImport);
  return (
    pathFromContracts === '' ||
    (!pathFromContracts.startsWith('../') && pathFromContracts !== '..')
  );
};

describe('frontend contract boundary', () => {
  it('allows only Zod and imports that stay inside the contract directory', () => {
    const sourcePath = join(CONTRACTS_DIRECTORY, 'feature.ts');

    expect(isAllowedContractImport('zod', sourcePath)).toBe(true);
    expect(isAllowedContractImport('./base.js', sourcePath)).toBe(true);
    expect(isAllowedContractImport('@byzon/database', sourcePath)).toBe(false);
    expect(
      isAllowedContractImport('../../../database/src/index.js', sourcePath),
    ).toBe(false);
    expect(isAllowedContractImport('server-only', sourcePath)).toBe(false);
  });

  it('does not import database, framework or server-only modules', () => {
    const violations = contractSources().flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, 'utf8');
      return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)]
        .map((match) => match[1])
        .filter(
          (specifier): specifier is string =>
            typeof specifier === 'string' &&
            !isAllowedContractImport(specifier, sourcePath),
        )
        .map((specifier) => `${sourcePath}: ${specifier}`);
    });

    expect(violations).toEqual([]);
  });
});
