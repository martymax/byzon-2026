import {
  participantContentFixtures,
  participantProgramFixtures,
  participantProgramProblemFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { PracticalContent } from '../../components/content-directory';
import { EmptyContent, ResourceStatus } from '../../components/content-state';
import { ProgramView } from '../../components/program-view';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { renderComponent } from './render';

const apiFor = (fixture: unknown) =>
  createFetchApiClient({
    maxRetries: 0,
    fetch: async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'component-content-0001',
        },
      }),
  });

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', window.location.pathname);
});

describe('CS-CONTENT-01 participant UI', () => {
  it('filters a contract-valid program and preserves the selection in the URL', async () => {
    const screen = await renderComponent(
      <ProgramView
        eventId={participantProgramFixtures.happy!.eventId}
        api={apiFor(participantProgramFixtures.happy)}
      />,
    );

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen
      .getByRole('combobox', { name: 'Typ' })
      .selectOptions('workshop');

    await expect.element(screen.getByText('1 bodů programu')).toBeVisible();
    await expect.element(screen.getByText('Růst bez zkratek')).toBeVisible();
    expect(new URL(window.location.href).searchParams.get('type')).toBe(
      'workshop',
    );
  });

  it('renders explicit empty and offline recovery states with touch targets', async () => {
    const retry = vi.fn();
    const screen = await renderComponent(
      <>
        <ResourceStatus state={{ status: 'offline' }} onRetry={retry} />
        <EmptyContent
          title="Program zatím není publikovaný"
          detail="Obsah se objeví po publikaci."
        />
      </>,
    );

    const action = screen.getByRole('button', { name: 'Zkusit znovu' });
    await expect.element(screen.getByText('Jste offline')).toBeVisible();
    await expect
      .element(screen.getByText('Program zatím není publikovaný'))
      .toBeVisible();
    await action.click();
    expect(retry).toHaveBeenCalledOnce();
    const bounds = await action.element().getBoundingClientRect();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  });

  it('maps an obfuscated server permission response to safe participant copy', async () => {
    const problem = participantProgramProblemFixtures.permission!;
    const api = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(problem, {
          status: problem.status,
          headers: {
            'content-type': 'application/problem+json',
            'x-request-id': problem.requestId,
          },
        }),
    });
    const screen = await renderComponent(
      <ProgramView
        eventId={participantProgramFixtures.happy!.eventId}
        api={api}
      />,
    );

    await expect.element(screen.getByText('Obsah není dostupný')).toBeVisible();
    await expect.element(screen.getByText(/nemáte přístup/)).toBeVisible();
    expect(document.body.textContent).not.toContain(problem.detail);
  });

  it('wraps long Czech practical content without horizontal overflow', async () => {
    const screen = await renderComponent(
      <PracticalContent
        eventId={participantContentFixtures.happy!.eventId}
        api={apiFor(participantContentFixtures.happy)}
      />,
    );

    await expect.element(screen.getByText('Před příjezdem')).toBeVisible();
    await expect
      .element(screen.getByText(/Extrémnědlouhéčeskéslovoproověřeníbezpečného/))
      .toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
  });

  it('shows a useful empty state for an empty practical-content response', async () => {
    const screen = await renderComponent(
      <PracticalContent
        eventId={participantContentFixtures.empty!.eventId}
        api={apiFor(participantContentFixtures.empty)}
      />,
    );

    await expect
      .element(screen.getByText('Praktické informace zatím nejsou zveřejněné'))
      .toBeVisible();
  });
});
