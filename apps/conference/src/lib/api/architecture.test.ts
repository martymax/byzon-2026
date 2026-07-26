import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const apiRoot = dirname(fileURLToPath(import.meta.url));
const allowedExternalImports = new Set(['@byzon/domain/contracts', 'zod']);
const forbiddenTokens = [
  '@byzon/database',
  '@byzon/test-support',
  'server-only',
  'next/',
  'react',
];

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

describe('API port architecture', () => {
  it('keeps the browser transport independent of server, database and fixtures', () => {
    for (const file of sourceFiles(apiRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const token of forbiddenTokens) {
        expect(
          source,
          `${relative(apiRoot, file)} imports ${token}`,
        ).not.toContain(token);
      }

      for (const specifier of importedSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          expect(
            target.startsWith(`${apiRoot}/`) || target === apiRoot,
            `${relative(apiRoot, file)} escapes the API boundary`,
          ).toBe(true);
        } else {
          expect(
            allowedExternalImports.has(specifier),
            `${relative(apiRoot, file)} imports ${specifier}`,
          ).toBe(true);
        }
      }
    }
  });
});
