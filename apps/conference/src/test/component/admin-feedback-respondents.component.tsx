import '../../app/styles.css';
import { beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  adminContextFixtures,
  adminFixtureIds,
} from '@byzon/test-support/fixtures';
import type {
  FeedbackRespondent,
  FeedbackRespondentDetail,
} from '@byzon/domain/contracts';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import { AdminFeedbackRespondents } from '../../components/admin-feedback-respondents';
import { adminContextEndpoint } from '../../lib/admin-api';
import {
  feedbackRespondentsEndpoint,
  feedbackRespondentEndpoint,
} from '../../lib/admin-feedback-api';
import type { ApiPort } from '../../lib/api/endpoint';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const person: FeedbackRespondent = {
  id: '019fb200-0000-7000-8000-000000000092',
  name: 'Jan Klidný',
  email: 'jan@example.test',
  role: 'speaker',
  status: 'in_progress',
  answerCount: 3,
  overallRating: 'Výborná',
  updatedAt: '2026-09-23T10:30:00Z',
  completedAt: null,
};
const detail: FeedbackRespondentDetail = {
  eventId: adminFixtureIds.event,
  respondent: person,
  sections: [
    {
      id: 'overall',
      title: 'Jaký byl váš BYZON?',
      answers: [
        {
          id: 'score',
          label: 'Jak hodnotíte konferenci celkově?',
          value: 'Výborná',
        },
        {
          id: 'comment',
          label: 'Co vám nejvíc utkvělo?',
          value: 'Výborné diskuse.\nVíce času na otázky příště.',
        },
      ],
    },
    {
      id: 'about',
      title: 'Ještě něco o vás',
      answers: [{ id: 'city', label: 'Odkud jste?', value: null }],
    },
  ],
};
const success = (data: unknown) => ({
  ok: true,
  kind: 'success',
  status: 200,
  data,
  metadata: { requestId: 'respondents-test' },
});
const setup = async (
  participantId?: string,
  detailResult: unknown = success({ data: detail }),
) => {
  const requests = vi.fn(
    async (endpoint: unknown, options: { path?: string }) => {
      if (endpoint === adminContextEndpoint)
        return success(adminContextFixtures.organizer!);
      if (endpoint === feedbackRespondentEndpoint)
        return typeof detailResult === 'function'
          ? detailResult()
          : detailResult;
      if (endpoint === feedbackRespondentsEndpoint) {
        const query = new URL(options.path!, 'https://example.test')
          .searchParams;
        const isEmpty = query.get('search') === 'Nobody';
        return success({
          data: {
            eventId: adminFixtureIds.event,
            items: isEmpty ? [] : [person],
            total: isEmpty ? 0 : 26,
            page: Number(query.get('page')),
            pageSize: 25,
          },
        });
      }
      throw new Error('Unexpected endpoint');
    },
  );
  const api = { request: requests } as unknown as ApiPort;
  const screen = await renderComponent(
    <AdminWorkspaceShell api={api}>
      <AdminFeedbackRespondents {...(participantId ? { participantId } : {})} />
    </AdminWorkspaceShell>,
  );
  return { screen, requests };
};
beforeEach(() =>
  window.history.replaceState({}, '', '/admin/hodnoceni/ucastnici'),
);

it('lists partial responses, pages and searches without revealing answer contents in the list', async () => {
  const { screen, requests } = await setup();
  await expect
    .element(screen.getByRole('heading', { name: 'Respondenti (26)' }))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole('link', { name: 'Zobrazit odpovědi: Jan Klidný' }),
    )
    .toHaveAttribute('href', expect.stringContaining(person.id));
  await screen.getByRole('button', { name: 'Další', exact: true }).click();
  await expect
    .element(screen.getByText('Strana 2 z 2', { exact: false }))
    .toBeVisible();
  await expectComponentToPassAxe(
    document.querySelector<HTMLElement>('[data-admin-root]')!,
  );
  screen
    .getByRole('heading', { name: 'Respondenti (26)' })
    .element()
    .scrollIntoView({ block: 'start' });
  await page.screenshot({
    path: `.vitest-attachments/feedback-respondents-list-${window.innerWidth}.png`,
  });
  await screen
    .getByRole('searchbox', { name: 'Hledat účastníka' })
    .fill('Nobody');
  await expect
    .element(
      screen.getByRole('heading', { name: 'Žádní respondenti v tomto výběru' }),
    )
    .toBeVisible();
  expect(
    requests.mock.calls.some(
      ([endpoint, options]) =>
        endpoint === feedbackRespondentsEndpoint &&
        options.path?.includes('search=Nobody&page=1'),
    ),
  ).toBe(true);
});

it('shows readable individual answers, optional unanswered questions and a return link', async () => {
  const { screen } = await setup(person.id);
  await expect
    .element(screen.getByRole('heading', { name: person.name }))
    .toBeVisible();
  await expect
    .element(screen.getByText('Výborné diskuse.', { exact: false }))
    .toBeVisible();
  await expect
    .element(screen.getByRole('heading', { name: 'Ještě něco o vás' }))
    .not.toBeInTheDocument();
  await screen
    .getByRole('checkbox', { name: 'Zobrazit i nezodpovězené otázky' })
    .click();
  await expect
    .element(screen.getByRole('heading', { name: 'Ještě něco o vás' }))
    .toBeVisible();
  await expect
    .element(screen.getByText('Bez odpovědi', { exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole('link', { name: 'Zpět na přehled účastníků' }))
    .toHaveAttribute(
      'href',
      expect.stringContaining('/admin/hodnoceni/ucastnici?'),
    );
  await expectComponentToPassAxe(
    document.querySelector<HTMLElement>('[data-admin-root]')!,
  );
  screen
    .getByRole('heading', { name: 'Jaký byl váš BYZON?' })
    .element()
    .scrollIntoView({ block: 'start' });
  await page.screenshot({
    path: `.vitest-attachments/feedback-respondent-detail-${window.innerWidth}.png`,
  });
});

it('never renders a response belonging to another participant', async () => {
  const { screen } = await setup(
    person.id,
    success({
      data: {
        ...detail,
        respondent: { ...person, id: '019fb200-0000-7000-8000-000000000093' },
      },
    }),
  );
  await expect
    .element(
      screen.getByText('Odpovědi nelze bezpečně přiřadit k účastníkovi.', {
        exact: false,
      }),
    )
    .toBeVisible();
  await expect
    .element(screen.getByText('Výborné diskuse.', { exact: false }))
    .not.toBeInTheDocument();
});

it('offers retry after an unavailable detail without showing stale responses', async () => {
  let available = false;
  const { screen } = await setup(person.id, () =>
    available
      ? success({ data: detail })
      : { ok: false, failure: { kind: 'transport' } },
  );
  await expect.element(screen.getByRole('alert')).toBeVisible();
  await expect
    .element(screen.getByRole('heading', { name: person.name }))
    .not.toBeInTheDocument();
  available = true;
  await screen.getByRole('button', { name: 'Zkusit znovu' }).click();
  await expect
    .element(screen.getByRole('heading', { name: person.name }))
    .toBeVisible();
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});
