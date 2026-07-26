import { describe, expect, it } from 'vitest';

import { hasSingleGuardedPreviewImport } from './source-preview-guard.mjs';

const previewModule = '../../test/mocks/checkin-preview-operator';

describe('production source preview guard', () => {
  it('accepts one dynamic preview import nested in the positive environment guard', () => {
    const source = `
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        if (previewAvailable()) {
          const preview = await import('${previewModule}');
          return preview.default;
        }
      }
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(true);
  });

  it('rejects an import after an empty positive guard', () => {
    const source = `
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {}
      await import('${previewModule}');
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });

  it('rejects comments that only resemble a guarded import', () => {
    const source = `
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        // await import('${previewModule}');
      }
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });

  it('rejects duplicate imports even when one is guarded', () => {
    const source = `
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        await import('${previewModule}');
      }
      await import('${previewModule}');
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });

  it('rejects a duplicate unguarded backtick import', () => {
    const source = `
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        await import('${previewModule}');
      }
      await import(\`${previewModule}\`);
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });

  it('rejects a computed dynamic import outside the guard', () => {
    const source = `
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        await import('${previewModule}');
      }
      await import(previewModulePath);
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });

  it('rejects a static import of the guarded preview module', () => {
    const source = `
      import {
        CheckinPreviewOperator,
      } from '${previewModule}';
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        await import('${previewModule}');
      }
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });

  it('rejects a CommonJS preview reference outside the guard', () => {
    const source = `
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        await import('${previewModule}');
      }
      require('${previewModule}');
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });

  it('rejects a multiline static import of a related preview module', () => {
    const adminPreviewModule =
      '../../../components/admin-content-demo-workspace';
    const source = `
      import {
        createAdminContentPreviewPort,
      } from '@/lib/admin-content-preview-port';
      if (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
      ) {
        await import('${adminPreviewModule}');
      }
    `;

    expect(
      hasSingleGuardedPreviewImport(source, adminPreviewModule, [
        'admin-content-demo-workspace',
        'admin-content-preview-port',
      ]),
    ).toBe(false);
  });

  it('rejects a negative environment guard that Turbopack cannot eliminate', () => {
    const source = `
      if (
        process.env.NODE_ENV !== 'development' &&
        process.env.NODE_ENV !== 'test'
      ) {
        notFound();
      }
      await import('${previewModule}');
    `;

    expect(hasSingleGuardedPreviewImport(source, previewModule)).toBe(false);
  });
});
