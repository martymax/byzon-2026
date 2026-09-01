import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  previewAvailable: vi.fn(),
  loadCurrentEvent: vi.fn(),
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: mocks.previewAvailable,
}));
vi.mock('@/server/current-event', () => ({
  loadCurrentEvent: mocks.loadCurrentEvent,
}));
vi.mock('../../../components/admin-content-demo-workspace', () => ({
  AdminContentDemoWorkspace: () => (
    <section data-testid="synthetic-content">Syntetický obsah</section>
  ),
}));
vi.mock('@/components/admin-content-workspace', () => ({
  AdminContentWorkspace: ({
    eventId,
    initialResource,
    port,
    readOnly,
    timezone,
  }: {
    readonly eventId: string;
    readonly initialResource?: string;
    readonly port?: unknown;
    readonly readOnly: boolean;
    readonly timezone: string;
  }) => (
    <section
      data-event-id={eventId}
      data-initial-resource={initialResource}
      data-port-injected={String(Boolean(port))}
      data-read-only={String(readOnly)}
      data-testid="integrated-content-workspace"
      data-timezone={timezone}
    >
      Editor a publikace
    </section>
  ),
}));

import AdminContentPage from './page';

describe('/admin/obsah preview and production branches', () => {
  beforeEach(() => {
    mocks.previewAvailable.mockReset();
    mocks.loadCurrentEvent.mockReset();
  });

  it('uses a safe synthetic content snapshot without touching the DB in preview', async () => {
    mocks.previewAvailable.mockReturnValue(true);

    const markup = renderToStaticMarkup(await AdminContentPage());

    expect(markup).toContain('synthetic-content');
    expect(markup).not.toContain('integrated-content-workspace');
    expect(mocks.loadCurrentEvent).not.toHaveBeenCalled();
  });

  it('mounts one shared production workspace with the authoritative event scope', async () => {
    mocks.previewAvailable.mockReturnValue(false);
    mocks.loadCurrentEvent.mockResolvedValue({
      id: 'event-integrated-0001',
      status: 'live',
      timezone: 'Europe/Prague',
    });

    const markup = renderToStaticMarkup(await AdminContentPage());

    expect(markup).toContain('integrated-content-workspace');
    expect(markup).toContain('data-event-id="event-integrated-0001"');
    expect(markup).toContain('data-timezone="Europe/Prague"');
    expect(markup).toContain('data-read-only="false"');
    expect(markup).toContain('data-port-injected="false"');
    expect(markup).not.toContain('synthetic-content');
    expect(mocks.loadCurrentEvent).toHaveBeenCalledOnce();
  });

  it('keeps an archived production event read-only', async () => {
    mocks.previewAvailable.mockReturnValue(false);
    mocks.loadCurrentEvent.mockResolvedValue({
      id: 'event-integrated-0002',
      status: 'archived',
      timezone: 'Europe/Prague',
    });

    const markup = renderToStaticMarkup(await AdminContentPage());

    expect(markup).toContain('data-read-only="true"');
  });

  it('maps only allowlisted view and type query values into initial content state', async () => {
    mocks.previewAvailable.mockReturnValue(false);
    mocks.loadCurrentEvent.mockResolvedValue({
      id: 'event-integrated-0003',
      status: 'live',
      timezone: 'Europe/Prague',
    });

    const selected = renderToStaticMarkup(
      await AdminContentPage({
        searchParams: Promise.resolve({
          oblast: 'practical',
          typ: 'faqs',
          unsafe: 'participant@example.test',
        }),
      }),
    );
    const rejected = renderToStaticMarkup(
      await AdminContentPage({
        searchParams: Promise.resolve({
          oblast: 'practical',
          typ: 'sessions',
        }),
      }),
    );

    expect(selected).toContain('data-initial-resource="faqs"');
    expect(selected).not.toContain('participant@example.test');
    expect(rejected).toContain('data-initial-resource="pages"');
  });
});
