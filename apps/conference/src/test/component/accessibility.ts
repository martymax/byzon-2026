import axe, { type Result } from 'axe-core';
import { expect } from 'vitest';

const WCAG_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
] as const;

export const summarizeAxeViolations = (violations: readonly Result[]) =>
  violations.map(({ id, impact, help, helpUrl, nodes }) => ({
    id,
    impact,
    help,
    helpUrl,
    nodeCount: nodes.length,
  }));

export const expectComponentToPassAxe = async (
  container: HTMLElement,
): Promise<void> => {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: [...WCAG_TAGS] },
  });

  expect(
    summarizeAxeViolations(results.violations),
    'Expected no automatic component WCAG A/AA violations',
  ).toEqual([]);
};
