import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ContentWorkspaceProps {
  readonly eventId: string;
  readonly initialResource: string;
  readonly onSecurityFailure: (failure: { readonly message: string }) => void;
  readonly readOnly: boolean;
  readonly timezone: string;
}

const mocks = vi.hoisted(() => ({
  invalidateSensitive: vi.fn(),
  useAdminWorkspace: vi.fn(),
  workspace: vi.fn((props: ContentWorkspaceProps) => (
    <div
      data-read-only={String(props.readOnly)}
      data-testid="content-workspace"
    />
  )),
}));

vi.mock('./admin-workspace-shell', () => ({
  useAdminWorkspace: mocks.useAdminWorkspace,
}));
vi.mock('./admin-content-workspace', () => ({
  AdminContentWorkspace: mocks.workspace,
}));

import { AdminContentProductionWorkspace } from './admin-content-production-workspace';

const shellValue = (
  phase: 'live' | 'archived',
  permissions: readonly string[] = ['program:manage'],
) => ({
  context: { event: { phase } },
  eventId: '019fb200-0000-7000-8000-000000000001',
  eventTimezone: 'Europe/Prague',
  invalidateSensitive: mocks.invalidateSensitive,
  permissions,
});

describe('AdminContentProductionWorkspace', () => {
  beforeEach(() => {
    mocks.invalidateSensitive.mockReset();
    mocks.useAdminWorkspace.mockReset();
    mocks.workspace.mockClear();
  });

  it('uses only the authoritative admin shell event and production fetch port', () => {
    mocks.useAdminWorkspace.mockReturnValue(shellValue('live'));

    const markup = renderToStaticMarkup(
      <AdminContentProductionWorkspace initialResource="sessions" />,
    );

    expect(markup).toContain('<h1>Program a obsah</h1>');
    expect(mocks.workspace.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        eventId: '019fb200-0000-7000-8000-000000000001',
        initialResource: 'sessions',
        readOnly: false,
        timezone: 'Europe/Prague',
      }),
    );
    expect(mocks.workspace.mock.calls[0]![0]).not.toHaveProperty('port');
  });

  it.each([
    ['archived event', shellValue('archived')],
    ['missing permission', shellValue('live', [])],
  ])('keeps content read-only for an %s', (_label, value) => {
    mocks.useAdminWorkspace.mockReturnValue(value);

    renderToStaticMarkup(
      <AdminContentProductionWorkspace initialResource="pages" />,
    );

    expect(mocks.workspace.mock.calls[0]![0]).toMatchObject({
      readOnly: true,
    });
  });

  it('closes the whole shell scope after a content security failure', () => {
    mocks.useAdminWorkspace.mockReturnValue(shellValue('live'));
    renderToStaticMarkup(
      <AdminContentProductionWorkspace initialResource="partners" />,
    );

    mocks.workspace.mock.calls[0]![0].onSecurityFailure({
      message: 'Přístup byl odebrán.',
    });

    expect(mocks.invalidateSensitive).toHaveBeenCalledWith(
      'Přístup byl odebrán.',
    );
  });
});
