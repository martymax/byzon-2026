import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const previewMock = vi.hoisted(() => vi.fn());
const routeWorkspaceMocks = vi.hoisted(() => ({
  audit: vi.fn(() => null),
  overview: vi.fn(() => null),
  reports: vi.fn(() => null),
  reservations: vi.fn(() => null),
  settings: vi.fn(() => null),
  speakers: vi.fn(() => null),
  team: vi.fn(() => null),
}));

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
  AdminOverviewWorkspace: routeWorkspaceMocks.overview,
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
vi.mock('@/components/admin-reports-workspace', () => ({
  AdminReportsRedesign: routeWorkspaceMocks.reports,
}));
vi.mock('@/components/admin-team-workspace', () => ({
  AdminTeamRedesign: routeWorkspaceMocks.team,
}));
vi.mock('@/components/admin-engagement-workspace', () => ({
  AdminEngagementWorkspace: () => null,
}));
vi.mock('@/components/admin-reservation-workspace', () => ({
  AdminReservationWorkspace: () => null,
}));
vi.mock('@/components/admin-audit-workspace', () => ({
  AdminAuditRedesign: routeWorkspaceMocks.audit,
}));
vi.mock('@/components/admin-reservations-redesign', () => ({
  AdminReservationsRedesign: routeWorkspaceMocks.reservations,
}));
vi.mock('@/components/admin-settings-workspace', () => ({
  AdminSettingsRedesign: routeWorkspaceMocks.settings,
}));
vi.mock('@/components/admin-content-production-workspace', () => ({
  AdminContentProductionWorkspace: routeWorkspaceMocks.speakers,
}));

import AdminAuditPage from './audit/page';
import AdminImportPage from './import/page';
import AdminEngagementPage from './interakce/page';
import AdminSettingsPage from './nastaveni/page';
import AdminAnnouncementsPage from './oznameni/page';
import AdminOverviewPage from './page';
import AdminOperationsPage from './provoz/page';
import AdminReportsPage from './reporty/page';
import AdminSpeakersPage from './recnici/page';
import AdminReservationsPage from './rezervace/page';
import AdminRolesPage from './role/page';
import AdminSupportPage from './support/page';
import AdminParticipantsPage from './ucastnici/page';
import AdminTicketsPage from './vstupenky/page';

const mockRoutes = [
  ['import', AdminImportPage],
  ['support', AdminSupportPage],
  ['operations', AdminOperationsPage],
] as const;

const integratedRoutes = [
  ['overview', AdminOverviewPage],
  ['announcements', AdminAnnouncementsPage],
  ['canonical participants', AdminParticipantsPage],
  ['canonical roles', AdminRolesPage],
  ['canonical reports', AdminReportsPage],
  ['canonical speakers', AdminSpeakersPage],
  ['canonical audit', AdminAuditPage],
  ['canonical settings', AdminSettingsPage],
  ['canonical engagement', AdminEngagementPage],
  ['canonical participant import', AdminTicketsPage],
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

  it.each(integratedRoutes)(
    'keeps the integrated %s route available in production',
    (_name, page) => {
      expect(() => page()).not.toThrow();
      expect(gateMock).not.toHaveBeenCalled();
    },
  );

  it('gives each split management route its own workspace', () => {
    expect(AdminOverviewPage().type).toBe(routeWorkspaceMocks.overview);
    expect(AdminReservationsPage().type).toBe(routeWorkspaceMocks.reservations);
    expect(AdminRolesPage().type).toBe(routeWorkspaceMocks.team);
    expect(AdminReportsPage().type).toBe(routeWorkspaceMocks.reports);
    expect(AdminAuditPage().type).toBe(routeWorkspaceMocks.audit);
    expect(AdminSettingsPage().type).toBe(routeWorkspaceMocks.settings);
    expect(AdminSpeakersPage().type).toBe(routeWorkspaceMocks.speakers);
    expect(gateMock).not.toHaveBeenCalled();
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
