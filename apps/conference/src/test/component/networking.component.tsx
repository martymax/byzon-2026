import {
  networkingDirectoryResponseSchema,
  networkingSettingsSchema,
  type NetworkingSettingsUpdateRequest,
} from '@byzon/domain/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { NetworkingDirectory } from '../../components/networking-directory';
import {
  networkingDirectoryEndpoint,
  networkingSettingsReadEndpoint,
  networkingSettingsUpdateEndpoint,
} from '../../lib/b-interactions-api';
import type { ApiPort } from '../../lib/api';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const metadata = { requestId: 'networking-component-0001' } as const;
const settings = networkingSettingsSchema.parse({
  eventId: '01910000-0000-7000-8000-000000000001',
  userId: '01910000-0000-7000-8000-000000000301',
  version: 1,
  networkingEnabled: false,
  introduction: '',
  company: '',
  jobTitle: '',
  participantNumber: null,
  todayHunting: [],
  contactEmail: 'alex@example.test',
  phone: null,
  linkedinUrl: null,
  emailVisibility: 'hidden',
  phoneVisibility: 'hidden',
  linkedinVisibility: 'hidden',
  updatedAt: '2026-09-02T10:00:00.000Z',
});

const success = <Value,>(data: Value) =>
  ({ ok: true, kind: 'success', status: 200, data, metadata }) as const;

const networkingApi = (
  onUpdate: (body: NetworkingSettingsUpdateRequest) => void,
  initialSettings = settings,
  onDirectoryRequest?: (path: string) => void,
): ApiPort => ({
  request: vi.fn(async (endpoint, options) => {
    if (endpoint === networkingSettingsReadEndpoint) {
      return success(initialSettings);
    }
    if (endpoint === networkingSettingsUpdateEndpoint) {
      const body = options.body as NetworkingSettingsUpdateRequest;
      onUpdate(body);
      const { expectedVersion: _expectedVersion, ...updatedSettings } = body;
      void _expectedVersion;
      return success(
        networkingSettingsSchema.parse({
          ...initialSettings,
          ...updatedSettings,
          version: 2,
          updatedAt: '2026-09-02T10:05:00.000Z',
        }),
      );
    }
    if (endpoint === networkingDirectoryEndpoint) {
      onDirectoryRequest?.(options.path);
      return success(
        networkingDirectoryResponseSchema.parse({
          eventId: initialSettings.eventId,
          items: [],
          pageInfo: { hasMore: false, nextCursor: null },
        }),
      );
    }
    throw new Error('Networking requested an unexpected endpoint.');
  }) as unknown as ApiPort['request'],
});

beforeEach(() => {
  window.history.replaceState({}, '', '/app/networking');
});

describe('participant networking settings', () => {
  it('lets the participant opt in with validated public profile fields', async () => {
    const updates: NetworkingSettingsUpdateRequest[] = [];
    const screen = await renderComponent(
      <NetworkingDirectory api={networkingApi((body) => updates.push(body))} />,
    );

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Networking' }))
      .toBeVisible();
    await screen
      .getByRole('checkbox', { name: 'Zobrazit můj profil v adresáři' })
      .click();
    await screen.getByLabelText('Firma').fill('BYZON Labs');
    await screen.getByLabelText('Pozice').fill('Zakladatelka');
    await screen.getByLabelText('Číslo účastníka').fill('042');
    await screen.getByRole('checkbox', { name: 'Know-how' }).click();
    await screen
      .getByLabelText('LinkedIn')
      .fill('https://www.linkedin.com/in/alex-novak');
    await screen.getByRole('button', { name: 'Uložit nastavení' }).click();

    await expect
      .element(screen.getByText('Profil je uložený a viditelný v adresáři.'))
      .toBeVisible();
    expect(updates).toEqual([
      expect.objectContaining({
        networkingEnabled: true,
        company: 'BYZON Labs',
        jobTitle: 'Zakladatelka',
        participantNumber: '042',
        todayHunting: ['know_how'],
        linkedinUrl: 'https://www.linkedin.com/in/alex-novak',
        emailVisibility: 'directory',
      }),
    ]);
    await expectComponentToPassAxe(screen.container);
  });

  it('keeps invalid contact data local and focuses the error summary', async () => {
    const updates: NetworkingSettingsUpdateRequest[] = [];
    const screen = await renderComponent(
      <NetworkingDirectory api={networkingApi((body) => updates.push(body))} />,
    );

    await screen.getByLabelText('LinkedIn').fill('https://example.com/alex');
    await screen.getByRole('button', { name: 'Uložit nastavení' }).click();

    const summary = screen.getByLabelText('Zkontrolujte zadané údaje');
    await expect.element(summary).toHaveFocus();
    await expect
      .element(summary)
      .toHaveTextContent('Použijte úplnou HTTPS adresu profilu');
    expect(updates).toEqual([]);
  });

  it('searches the opted-in directory by the complete participant number', async () => {
    const requests: string[] = [];
    const enabledSettings = networkingSettingsSchema.parse({
      ...settings,
      networkingEnabled: true,
      participantNumber: '042',
      emailVisibility: 'directory',
      phoneVisibility: 'directory',
      linkedinVisibility: 'directory',
    });
    const screen = await renderComponent(
      <NetworkingDirectory
        api={networkingApi(
          () => undefined,
          enabledSettings,
          (path) => requests.push(path),
        )}
      />,
    );

    await screen.getByLabelText('Hledat podle networking čísla').fill('042');
    await vi.waitFor(() =>
      expect(requests).toContain(
        '/api/v1/networking/directory?participantNumber=042',
      ),
    );
    await expectComponentToPassAxe(screen.container);
  });
});
