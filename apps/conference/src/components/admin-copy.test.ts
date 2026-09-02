import { describe, expect, it } from 'vitest';

import {
  adminCountForms,
  findForbiddenAdminMainCopy,
  formatCzechCount,
} from './admin-copy';

describe('admin Czech copy', () => {
  it.each([
    [0, '0 položek'],
    [1, '1 položka'],
    [2, '2 položky'],
    [4, '4 položky'],
    [5, '5 položek'],
    [21, '21 položek'],
  ] as const)(
    'formats %i with the correct Czech plural form',
    (count, label) => {
      expect(formatCzechCount(count, adminCountForms.item)).toBe(label);
    },
  );

  it('keeps long localized counts readable', () => {
    expect(formatCzechCount(12_345, adminCountForms.recipient)).toBe(
      '12 345 příjemců',
    );
  });

  it.each([
    'F4 interakce',
    'P3 data',
    'Tato změna je online-only.',
    'Event scope',
    'Načítám canonical snapshot.',
    'Doplňte auditní důvod.',
    'Spustit apply',
    'Zobrazit checksum',
    'Report se vytvoří asynchronně.',
  ])('detects forbidden implementation copy: %s', (copy) => {
    expect(findForbiddenAdminMainCopy(copy)).not.toBeNull();
  });

  it('accepts the plain-language production equivalent', () => {
    expect(
      findForbiddenAdminMainCopy(
        'Tato část vyžaduje připojení. Důvod se uloží do historie změn.',
      ),
    ).toBeNull();
  });
});
