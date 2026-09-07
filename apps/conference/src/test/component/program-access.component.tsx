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
    await expectComponentToPassAxe(screen.container);
  });
});
