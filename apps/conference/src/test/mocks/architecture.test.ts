import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const mockRoot = dirname(fileURLToPath(import.meta.url));
const allowedExternalImports = new Set([
  '@byzon/domain/contracts',
  '@byzon/domain/contracts/admin',
  '@byzon/domain/contracts/check-in',
  '@byzon/domain/contracts/support',
  '@byzon/domain/contracts/ticket-import',
  '@byzon/test-support',
  '@byzon/test-support/fixtures',
  '@byzon/test-support/fixtures/admin',
  '@byzon/test-support/fixtures/check-in',
  '@byzon/test-support/fixtures/support',
  '@byzon/test-support/fixtures/ticket-import',
  'msw',
  'msw/browser',
  'msw/node',
  'zod',
]);
const forbiddenTokens = ['@byzon/database', '@/server', 'server-only', 'next/'];

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });

const importedSpecifiers = (source: string): string[] =>
  [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );

describe('dev/test mock architecture', () => {
  it('keeps handlers independent of server and database code', () => {
    for (const file of sourceFiles(mockRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const token of forbiddenTokens) {
        expect(
          source,
          `${relative(mockRoot, file)} imports ${token}`,
        ).not.toContain(token);
      }
      for (const specifier of importedSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          expect(
            target.startsWith(`${mockRoot}/`) || target === mockRoot,
            `${relative(mockRoot, file)} escapes the mock boundary`,
          ).toBe(true);
        } else {
          expect(
            allowedExternalImports.has(specifier),
            `${relative(mockRoot, file)} imports ${specifier}`,
          ).toBe(true);
        }
      }
    }
  });
});
