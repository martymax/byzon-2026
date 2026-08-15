import { activityRosterFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

import '../../app/styles.css';
import { ActivityRoster } from '../../components/activity-roster';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

describe('activity roster', () => {
  it('shows only the minimal assigned-session roster without mutation controls', async () => {
    const screen = await renderComponent(
      <ActivityRoster data={activityRosterFixtures.assigned!} />,
    );

    await expect
      .element(
        screen.getByRole('heading', { name: 'Mastermind Expertního Boardu' }),
      )
      .toBeVisible();
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    await expect.element(screen.getByText('Ukázková firma')).toBeVisible();
    await expect.element(screen.getByText('Čekací listina')).toBeVisible();
    expect(screen.getByRole('button').elements()).toHaveLength(0);
    expect(screen.container.textContent).not.toContain('@');
    expect(screen.container.textContent).not.toContain('+420');
    await expectComponentToPassAxe(screen.container);
  });

  it('has an explicit empty assigned-scope state', async () => {
    const screen = await renderComponent(
      <ActivityRoster data={activityRosterFixtures.empty!} />,
    );

    await expect
      .element(
        screen.getByRole('heading', { name: 'Nemáte přiřazenou aktivitu' }),
      )
      .toBeVisible();
  });
});
