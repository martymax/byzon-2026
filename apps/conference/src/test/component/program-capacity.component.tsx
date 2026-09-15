import { participantProgramFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { ProgramView } from '../../components/program-view';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';
import '../../app/styles.css';

const fixture = participantProgramFixtures.happy!;

describe('program capacity', () => {
  it('shows capacity and remaining places in the responsive schedule', async () => {
    const data = structuredClone(fixture);
    for (const session of data.program.sessions)
      session.availability = { capacity: 20, remaining: 0 };
    const api = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(data, {
          headers: { 'x-request-id': 'component-program-capacity-0001' },
        }),
    });
    const screen = await renderComponent(
      <main className="app-page">
        <h1>Program</h1>
        <ProgramView eventId={data.eventId} api={api} />
      </main>,
    );
    await expect
      .element(page.getByText('Kapacita: 20 · Volná místa: 0').first())
      .toBeInTheDocument();
    await expectComponentToPassAxe(screen.container);
    await expect
      .element(screen.container)
      .toMatchScreenshot('program-capacity');
  });
});
