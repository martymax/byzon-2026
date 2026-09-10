import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramAccessForm } from '../../components/admin-program-access';
import { HostRoleLinks } from '../../components/host-role-links';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';
import '../../app/styles.css';
import styles from '../../components/admin-workspace.module.css';
const eventId = '019fa200-0000-7000-8000-000000000001',
  userId = '019fa200-0000-7000-8000-000000000002',
  speakerId = '019fa200-0000-7000-8000-000000000003';
afterEach(() => vi.unstubAllGlobals());
describe('program collaborator setup', () => {
  it('requires preview and keeps the exact pending mutation for network retry', async () => {
    const bodies: string[] = [],
      keys: string[] = [];
    const person = {
      participantId: userId,
      displayName: 'Dana Řečnice',
      maskedEmail: 'd…@example.test',
      membershipStatus: 'active',
      invitationStatus: 'not_sent',
      source: 'manual',
      baselineReady: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const path = String(input);
        if (path.endsWith('/options'))
          return Response.json({
            eventId,
            speakers: [
              { id: speakerId, name: 'Dana Řečnice', linkedUserId: null },
            ],
            rooms: [],
            sessions: [],
          });
        if (path.endsWith('/search'))
          return Response.json({ eventId, items: [person] });
        if (path.endsWith('/preview'))
          return Response.json({
            eventId,
            participant: person,
            assignmentsVersion: 1,
            previewHash: 'a'.repeat(64),
            roles: [
              { role: 'speaker', sessionIds: [], roomIds: [], revoke: false },
            ],
            sessions: [],
            speakerProfileId: speakerId,
            speakerVersion: 1,
            operation: 'apply',
          });
        bodies.push(String(options?.body));
        keys.push(new Headers(options?.headers).get('idempotency-key')!);
        if (bodies.length === 1) throw new TypeError('Spojení bylo přerušeno');
        return Response.json({
          eventId,
          assignmentsVersion: 2,
          outcome: 'applied',
          auditId: speakerId,
        });
      }),
    );
    const screen = await renderComponent(
      <main data-admin-root className={styles.workspace}>
        <h1>Administrace</h1>
        <h2>Programoví spolupracovníci</h2>
        <ProgramAccessForm eventId={eventId} invalidate={vi.fn()} />
      </main>,
    );
    await screen
      .getByRole('textbox', { name: '1. Vyhledat existujícího účastníka' })
      .fill('Dana');
    await screen.getByRole('button', { name: 'Vyhledat', exact: true }).click();
    await screen
      .getByRole('button', { name: 'Dana Řečnice · d…@example.test' })
      .click();
    await screen
      .getByRole('combobox', { name: 'Profil řečníka v programu' })
      .selectOptions(speakerId);
    await screen
      .getByRole('button', { name: 'Zobrazit náhled oprávnění' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Příprava programu');
    await Promise.allSettled(
      screen.container
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
    await expectComponentToPassAxe(screen.container);
    await screen
      .getByRole('button', { name: 'Potvrdit nastavení přístupu' })
      .click();
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Spojení bylo přerušeno');
    await screen
      .getByRole('button', { name: 'Potvrdit nastavení přístupu' })
      .click();
    await expect
      .element(
        screen.getByText(
          'Přístup byl nastaven. Pozvánka se automaticky neodesílá.',
        ),
      )
      .toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(keys[0]).toBe(keys[1]);
  });
  it('keeps moderator choices while filtering and renders compact accessible rows', async () => {
    const person = {
      participantId: userId,
      displayName: 'Max Martynenko',
      maskedEmail: 'm…@example.test',
      membershipStatus: 'active',
      invitationStatus: 'accepted',
      source: 'manual',
      baselineReady: true,
    };
    const titles = [
      'Host to pozná: Lidskost jako nejdůležitější ingredience gastro byznysu',
      'Co vás dostalo sem, vás dál nedostane',
      'Co mi nikdo neřekl o tom být CEO',
      'Šimon Srp',
      'Zrádci lidskosti – moderovaná diskuze',
      'Jak vyjednávat lidsky a získávat zákazníky jinak než slevami',
    ];
    const sessions = titles.map((title, i) => ({
      id: `019fa200-0000-7000-8000-${String(i + 10).padStart(12, '0')}`,
      title,
      startsAt: '2026-09-18T08:00:00.000Z',
      endsAt: '2026-09-18T08:45:00.000Z',
      roomName: i % 2 ? 'Leadership Stage' : 'BYZON Stage',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/options')
          ? Response.json({ eventId, speakers: [], rooms: [], sessions })
          : Response.json({ eventId, items: [person] }),
      ),
    );
    const screen = await renderComponent(
      <main
        data-admin-root
        className={styles.workspace}
        style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}
      >
        <section className={styles.panel}>
          <h1 style={{ fontSize: '24px', lineHeight: 1.3 }}>
            Programoví spolupracovníci
          </h1>
          <ProgramAccessForm eventId={eventId} invalidate={vi.fn()} />
        </section>
      </main>,
    );
    await screen
      .getByRole('textbox', { name: '1. Vyhledat existujícího účastníka' })
      .fill('Max');
    await screen.getByRole('button', { name: 'Vyhledat', exact: true }).click();
    await screen
      .getByRole('button', { name: 'Max Martynenko · m…@example.test' })
      .click();
    await screen
      .getByRole('combobox', { name: '2. Spolupráce' })
      .selectOptions('moderator');
    const first = screen.getByRole('checkbox', {
      name: titles[0]!,
      exact: true,
    });
    await first.click();
    await screen
      .getByRole('searchbox', { name: 'Vyhledat přednášku' })
      .fill('simon');
    await expect
      .element(screen.getByRole('checkbox', { name: 'Šimon Srp' }))
      .toBeVisible();
    expect(screen.getByRole('checkbox').elements()).toHaveLength(1);
    await expect.element(screen.getByText('Vybráno 1 z 6')).toBeVisible();
    await screen
      .getByRole('searchbox', { name: 'Vyhledat přednášku' })
      .fill('');
    await expect.element(first).toBeChecked();
    const bounds = first.element().getBoundingClientRect();
    expect(bounds.width).toBeLessThanOrEqual(24);
    expect(bounds.height).toBeLessThanOrEqual(24);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });
  it('shows only server-granted host capabilities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          eventId,
          userId,
          activities: false,
          moderation: true,
          followUps: false,
          pendingAnswerCount: 0,
        }),
      ),
    );
    const screen = await renderComponent(
      <main>
        <h1>Můj účet</h1>
        <HostRoleLinks eventId={eventId} userId={userId} />
      </main>,
    );
    await expect
      .element(screen.getByRole('link', { name: 'Moderování' }))
      .toHaveAttribute('href', '/host/moderace');
    expect(
      screen.getByRole('link', { name: 'Vedoucí aktivity' }).elements(),
    ).toHaveLength(0);
    const heading = screen
      .getByRole('heading', { name: 'Moje role' })
      .element();
    const link = screen.getByRole('link', { name: 'Moderování' }).element();
    expect(heading.getBoundingClientRect().bottom).toBeLessThan(
      link.getBoundingClientRect().top,
    );
    expect(link.getBoundingClientRect().left).toBeCloseTo(
      heading.getBoundingClientRect().left,
      0,
    );
    await expectComponentToPassAxe(screen.container);
  });
});
