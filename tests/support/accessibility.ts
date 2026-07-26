import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const WCAG_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
] as const;

interface AxeViolationLike {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly unknown[];
}

export const summarizeAxeViolations = (
  violations: readonly AxeViolationLike[],
) =>
  violations.map(({ id, impact, help, helpUrl, nodes }) => ({
    id,
    impact,
    help,
    helpUrl,
    nodeCount: nodes.length,
  }));

export const expectPageToPassAxe = async (page: Page): Promise<void> => {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_TAGS])
    .analyze();

  expect(
    summarizeAxeViolations(results.violations),
    'Expected no automatic WCAG A/AA violations',
  ).toEqual([]);
};
