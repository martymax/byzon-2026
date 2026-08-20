import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const previewMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/admin-frontend-preview', () => ({
  requireAdminFrontendPreview: gateMock,
}));
vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: previewMock,
}));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));
vi.mock('@/components/admin-overview-workspace', () => ({
  AdminOverviewWorkspace: () => null,
}));
vi.mock('@/components/admin-import-workspace', () => ({
  AdminImportWorkspace: () => null,
}));
vi.mock('@/components/admin-support-workspace', () => ({
  AdminSupportWorkspace: () => null,
}));
vi.mock('@/components/admin-announcement-workspace', () => ({
  AdminAnnouncementWorkspace: () => null,
}));
vi.mock('@/components/admin-operations-workspace', () => ({
  AdminOperationsWorkspace: () => null,
}));
vi.mock('@/components/admin-reservation-workspace', () => ({
  AdminReservationWorkspace: () => null,
}));

import AdminAuditPage from './audit/page';
import AdminImportPage from './import/page';
import AdminSettingsPage from './nastaveni/page';
import AdminAnnouncementsPage from './oznameni/page';
import AdminOverviewPage from './page';
import AdminOperationsPage from './provoz/page';
import AdminReportsPage from './reporty/page';
import AdminReservationsPage from './rezervace/page';
import AdminRolesPage from './role/page';
import AdminSupportPage from './support/page';
import AdminParticipantsPage from './ucastnici/page';
import AdminTicketsPage from './vstupenky/page';

const mockRoutes = [
  ['import', AdminImportPage],
  ['support', AdminSupportPage],
  ['announcements', AdminAnnouncementsPage],
  ['operations', AdminOperationsPage],
  ['canonical tickets', AdminTicketsPage],
  ['canonical participants', AdminParticipantsPage],
  ['canonical roles', AdminRolesPage],
  ['canonical reports', AdminReportsPage],
  ['canonical audit', AdminAuditPage],
  ['canonical settings', AdminSettingsPage],
] as const;

describe('F4 direct mock admin route boundary', () => {
  beforeEach(() => {
    gateMock.mockReset();
    redirectMock.mockReset();
    previewMock.mockReset();
    previewMock.mockReturnValue(false);
    gateMock.mockImplementation(() => {
      throw new Error('ADMIN_PREVIEW_NOT_FOUND');
    });
  });

  it.each([['overview', AdminOverviewPage]] as const)(
    'keeps the integrated %s route available in production',
    (_name, page) => {
      expect(() => page()).not.toThrow();
      expect(gateMock).not.toHaveBeenCalled();
    },
  );

  it('selects the live-only reservation workspace in production', () => {
    const page = AdminReservationsPage();

    expect(page.props.mode).toBe('reservations');
    expect(gateMock).not.toHaveBeenCalled();

    previewMock.mockReturnValue(true);
    expect(AdminReservationsPage().props.mode).toBe('full');
  });

  it.each(mockRoutes)('keeps the %s route production-hidden', (_name, page) => {
    expect(() => page()).toThrow('ADMIN_PREVIEW_NOT_FOUND');
    expect(gateMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['legacy import', AdminImportPage, '/admin/vstupenky'],
    ['legacy support', AdminSupportPage, '/admin/ucastnici'],
    ['legacy operations', AdminOperationsPage, '/admin/role'],
  ] as const)(
    'redirects %s to its canonical route in preview',
    (_name, page, canonicalPath) => {
      gateMock.mockReset();

      page();

      expect(gateMock).toHaveBeenCalledOnce();
      expect(redirectMock).toHaveBeenCalledWith(canonicalPath);
    },
  );
});
