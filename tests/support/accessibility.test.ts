import { describe, expect, it } from 'vitest';

import { summarizeAxeViolations } from './accessibility';

describe('axe report redaction', () => {
  it('keeps CI output actionable without copying DOM text or HTML', () => {
    const report = summarizeAxeViolations([
      {
        id: 'label',
        impact: 'critical',
        help: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/label',
        nodes: [
          {
            html: '<input value="private@example.test">',
            failureSummary: 'Private text',
            target: ['input[value="private@example.test"]'],
          },
        ],
      },
    ]);

    expect(report).toEqual([
      {
        id: 'label',
        impact: 'critical',
        help: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/label',
        nodeCount: 1,
        selectors: ['input[value]'],
      },
    ]);
    expect(JSON.stringify(report)).not.toContain('private@example.test');
    expect(JSON.stringify(report)).not.toContain('<input');
  });
});
