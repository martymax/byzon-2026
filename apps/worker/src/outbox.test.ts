import { describe, expect, it } from 'vitest';

import { protectSpreadsheetCell } from './outbox';

describe('operational export CSV protection', () => {
  it.each(['=1+1', '+cmd', '-2+3', '@SUM(A:A)', '   =hidden'])(
    'neutralizes spreadsheet formula %s',
    (value) => {
      expect(protectSpreadsheetCell(value)).toContain("'");
      expect(protectSpreadsheetCell(value)).toMatch(/^"/);
    },
  );

  it('quotes delimiters and quotes without changing ordinary text', () => {
    expect(protectSpreadsheetCell('BYZON, "2026"')).toBe('"BYZON, ""2026"""');
  });
});
