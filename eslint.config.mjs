import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores(['**/.next/**', '**/dist/**', 'assets/**', '**/*.html']),
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: {
      next: { rootDir: 'apps/conference' },
      react: { version: '19.2' },
    },
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    files: ['apps/conference/src/modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/internal/**'],
              message:
                'Importujte veřejné rozhraní modulu, ne jeho interní implementaci.',
            },
          ],
        },
      ],
    },
  },
]);
