import { describe, expect, it } from 'vitest';
import { publicationFieldDiff } from './publication-field-diff';

describe('publication field comparison', () => {
  it('compares full text and clears values without including unchanged fields or internal IDs', () => {
    expect(
      publicationFieldDiff(
        {
          id: 'secret',
          title: 'Stejný název',
          description: 'První řádek.\nPůvodní text.',
          summary: 'Shrnutí',
        },
        {
          id: 'secret',
          title: 'Stejný název',
          description: 'První řádek.\nNový text.',
          summary: null,
        },
        {},
        {},
      ),
    ).toEqual([
      {
        field: 'description',
        label: 'Popis',
        before: 'První řádek.\nPůvodní text.',
        after: 'První řádek.\nNový text.',
      },
      { field: 'summary', label: 'Shrnutí', before: 'Shrnutí', after: null },
    ]);
  });

  it('resolves references from their respective publication snapshots', () => {
    expect(
      publicationFieldDiff(
        { speakerIds: ['old'] },
        { speakerIds: ['new'] },
        { speakers: [{ id: 'old', firstName: 'Anna', lastName: 'Nová' }] },
        { speakers: [{ id: 'new', firstName: 'Petr', lastName: 'Malý' }] },
      ),
    ).toEqual([
      {
        field: 'speakerIds',
        label: 'Řečníci',
        before: 'Anna Nová',
        after: 'Petr Malý',
      },
    ]);
  });

  it('shows values on only the appropriate side for additions and removals', () => {
    const item = { id: 'hidden', title: 'Novinka' };
    expect(publicationFieldDiff(undefined, item, {}, {})).toEqual([
      { field: 'title', label: 'Název', before: null, after: 'Novinka' },
    ]);
    expect(publicationFieldDiff(item, undefined, {}, {})).toEqual([
      { field: 'title', label: 'Název', before: 'Novinka', after: null },
    ]);
  });
});
