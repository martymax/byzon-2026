import type {
  AdminActorRole,
  AdminAssignmentRole,
  AdminAuditAction,
  AdminAuditActor,
  AdminAuditCategory,
  AdminAuditEntry,
  AdminContextResponse,
  AdminEventSettings,
  AdminExportReport,
  AdminOperationsOverviewResponse,
  AdminReservationAction,
  AdminReservationRecord,
  AdminRoleAssignment,
  AdminSessionCapacityRecord,
} from '@byzon/domain/contracts/admin';
import type {
  AdminAnnouncementAudience,
  AdminAnnouncementSendResponse,
  AnnouncementSeverity,
  SupportAccessState,
  SupportAction,
  SupportTicketState,
  TicketImportIdentitySource,
  TicketImportIssueCode,
  TicketImportRowStatus,
  TicketImportSourceStatus,
  TicketImportTicketState,
} from '@byzon/domain/contracts';
import type {
  AdminEngagementFeatures,
  AdminEngagementSession,
} from '@byzon/domain/contracts/admin-engagement';

import type { AdminContentResource } from '@/lib/admin-content-api';

export const adminPhaseLabels = {
  draft: 'Příprava',
  activation_open: 'Aktivace otevřena',
  live: 'Akce právě probíhá',
  ended: 'Akce skončila',
  archived: 'Archivováno · pouze čtení',
} satisfies Record<AdminContextResponse['event']['phase'], string>;

export const adminActorRoleLabels = {
  organizer_admin: 'Administrátor',
  checkin_operator: 'Obsluha odbavení',
  moderator: 'Moderátor',
  room_operator: 'Vedoucí aktivity',
} satisfies Record<AdminActorRole, string>;

export const adminAssignmentRoleLabels = {
  checkin_operator: 'Obsluha odbavení',
  moderator: 'Moderátor',
  room_operator: 'Vedoucí aktivity',
} satisfies Record<AdminAssignmentRole, string>;

export const adminAssignmentStateLabels = {
  active: 'Aktivní',
  scheduled: 'Naplánováno',
} satisfies Record<AdminRoleAssignment['state'], string>;

export const adminMetricLabels = {
  activation: 'Aktivace účastníků',
  import: 'Aktualizace vstupenek',
  content: 'Program a obsah',
  checkin: 'Odbavení',
  reservation: 'Rezervace',
  notification: 'Oznámení',
} satisfies Record<
  AdminOperationsOverviewResponse['metrics'][number]['id'],
  string
>;

export const adminMetricStateLabels = {
  healthy: 'V pořádku',
  attention: 'Vyžaduje pozornost',
  degraded: 'Omezený provoz',
} satisfies Record<
  AdminOperationsOverviewResponse['metrics'][number]['state'],
  string
>;

export const adminQueueLabels = {
  default: 'Běžné úlohy',
  notifications: 'Oznámení',
  exports: 'Reporty',
} satisfies Record<
  AdminOperationsOverviewResponse['queues'][number]['queue'],
  string
>;

export const adminAuditCategoryLabels = {
  support: 'Účastníci',
  import: 'Aktualizace vstupenek',
  announcement: 'Oznámení',
  role: 'Tým',
  reservation: 'Rezervace',
  settings: 'Nastavení',
  export: 'Reporty',
} satisfies Record<AdminAuditCategory, string>;

export const adminAuditActorLabels = {
  user: 'Oprávněný uživatel',
  system: 'Systém BYZON',
} satisfies Record<AdminAuditActor, string>;

export const adminAuditActionLabels = {
  update_settings: 'Upravil nastavení akce',
  cancel_reservation: 'Zrušil rezervaci',
  'support.block': 'Zablokoval přístup účastníka',
  'support.reactivate': 'Obnovil přístup účastníka',
  'support.resend': 'Znovu odeslal pozvánku',
  'participant.invitation_sent': 'Odeslal pozvánku účastníkovi',
  'participant.profile_updated': 'Upravil profil účastníka',
  'ticket_import.preview_created': 'Načetl změny vstupenek',
  'ticket_import.applied': 'Použil změny vstupenek',
  'announcement.send': 'Odeslal kritické oznámení',
  'role.grant': 'Přiřadil provozní roli',
  'role.revoke': 'Odebral provozní roli',
  'role.moderator.assign': 'Přiřadil moderátora',
  'role.moderator.remove': 'Odebral moderátora',
  'team.member_added': 'Přidal člena týmu',
  'team.member_updated': 'Upravil člena týmu',
  'team.member_removed': 'Odebral člena týmu',
  'team.invitation_sent': 'Odeslal pozvánku členovi týmu',
  'reservation.admin_cancelled': 'Zrušil rezervaci',
  'session.capacity_updated': 'Změnil kapacitu aktivity',
  'waitlist.auto_cancelled': 'Automaticky zrušil čekání',
  'waitlist.auto_promoted': 'Automaticky potvrdil rezervaci',
  'settings.update': 'Upravil nastavení akce',
  'settings.engagement.update': 'Upravil interaktivní funkce',
  'settings.session-questions.update': 'Upravil otázky k aktivitě',
  'export.queued': 'Zařadil report ke zpracování',
  'export.download': 'Stáhl report',
} satisfies Record<AdminAuditAction, string>;

export const adminAuditOutcomeLabels = {
  succeeded: 'Provedeno',
  rejected: 'Odmítnuto',
  queued: 'Čeká na zpracování',
} satisfies Record<AdminAuditEntry['outcome'], string>;

export const adminReservationActionLabels = {
  capacity_override: 'Upravit kapacitu',
  cancel_reservation: 'Zrušit rezervaci',
} satisfies Record<AdminReservationAction, string>;

export const adminReservationStateLabels = {
  reserved: 'Rezervováno',
  cancelled: 'Zrušeno',
} satisfies Record<AdminReservationRecord['state'], string>;

export const adminSessionTypeLabels = {
  talk: 'Přednáška',
  panel: 'Panel',
  workshop: 'Workshop',
  mastermind: 'Mastermind',
  coaching: 'Koučink',
  networking: 'Řízený networking',
  break: 'Přestávka',
  meal: 'Občerstvení',
  gala: 'Gala',
  other: 'Aktivita',
} satisfies Record<AdminSessionCapacityRecord['sessionType'], string>;

export const adminRegistrationModeLabels = {
  open: 'Registrace je otevřená',
  invite_only: 'Pouze pro pozvané',
  closed: 'Registrace je uzavřená',
} satisfies Record<AdminEventSettings['registrationMode'], string>;

export const adminExportReportLabels = {
  participant_summary: 'Souhrn účastníků',
  checkin_summary: 'Souhrn odbavení',
  reservation_summary: 'Souhrn rezervací',
  audit_log: 'Historie změn',
} satisfies Record<AdminExportReport, string>;

export const ticketImportRowStatusLabels = {
  new: 'Nové vstupenky',
  unchanged: 'Beze změny',
  status_changed: 'Změněný stav',
  excluded: 'Nebude použito',
  conflict: 'Vyžaduje opravu',
  unknown: 'Nerozpoznáno',
} satisfies Record<TicketImportRowStatus, string>;

export const ticketStateLabels = {
  active: 'Aktivní',
  blocked: 'Zablokováno',
  cancelled: 'Zrušeno',
  refunded: 'Vráceno',
} satisfies Record<TicketImportTicketState | SupportTicketState, string>;

export const ticketImportSourceStatusLabels = {
  paid: 'Uhrazeno',
  unpaid: 'Neuhrazeno',
  cancelled: 'Zrušeno',
  refunded: 'Vráceno',
  unknown: 'Nerozpoznáno',
} satisfies Record<TicketImportSourceStatus, string>;

export const ticketImportIdentitySourceLabels = {
  named_participant: 'Účastník z prodeje na jméno',
  single_paid_ticket_buyer: 'Kupující jediné uhrazené vstupenky',
  manual_review: 'Identitu je potřeba ověřit ručně',
} satisfies Record<TicketImportIdentitySource, string>;

export const ticketImportIssueLabels = {
  duplicate_source_reference: 'Reference se ve zdroji opakuje.',
  duplicate_existing_reference: 'Reference už patří jinému záznamu.',
  missing_reference: 'Chybí reference vstupenky.',
  missing_status: 'Chybí stav vstupenky.',
  unknown_status: 'Stav vstupenky není rozpoznaný.',
  source_status_excluded: 'Tento stav není určený k použití.',
  source_status_review_required: 'Změna vyžaduje ruční kontrolu.',
  state_conflict: 'Stav se rozchází s aktuálními daty.',
  participant_identity_manual_review: 'Účastníka je potřeba ověřit ručně.',
} satisfies Record<TicketImportIssueCode, string>;

export const supportActionLabels = {
  resend: 'Znovu poslat aktivační výzvu',
  reassign: 'Přiřadit přístup jiné osobě',
  block: 'Zablokovat přístup',
  reactivate: 'Obnovit přístup',
  transfer: 'Převést vstupenku',
} satisfies Record<SupportAction, string>;

export const supportAccessStateLabels = {
  claimed: 'Aktivováno',
  not_claimed: 'Zatím neaktivováno',
  recovery_pending: 'Čeká na obnovení přístupu',
} satisfies Record<SupportAccessState, string>;

export const announcementSendOutcomeLabels = {
  sent: 'Odesláno',
  already_sent: 'Již dříve odesláno',
} satisfies Record<AdminAnnouncementSendResponse['outcome'], string>;

export const announcementSeverityLabels = {
  critical: 'Kritické',
} satisfies Record<AnnouncementSeverity, string>;

export const announcementAudienceLabels = {
  event: 'Všichni účastníci akce',
  session: 'Účastníci jedné aktivity',
} satisfies Record<AdminAnnouncementAudience['kind'], string>;

export const adminEngagementSessionStatusLabels = {
  draft: 'Rozpracováno',
  published: 'Zveřejněno',
  cancelled: 'Zrušeno',
  archived: 'Archivováno',
} satisfies Record<AdminEngagementSession['status'], string>;

export const adminEngagementFeatureLabels = {
  networkingEnabled: 'Networking',
  questionsEnabled: 'Otázky pro řečníky',
  ratingsEnabled: 'Hodnocení programu',
} satisfies Record<keyof AdminEngagementFeatures, string>;

export const adminContentResourceLabels = {
  days: 'Dny',
  venues: 'Místa',
  rooms: 'Místnosti',
  sessions: 'Program',
  speakers: 'Řečníci',
  partners: 'Partneři',
  pages: 'Stránky',
  faqs: 'FAQ',
} satisfies Record<AdminContentResource, string>;

export interface AdminPresentationLabel {
  known: boolean;
  label: string;
  mutationBlocked: boolean;
}

export const resolveAdminPresentationLabel = (
  registry: Readonly<Record<string, string>>,
  value: string,
): AdminPresentationLabel => {
  const label = registry[value];
  return label === undefined
    ? {
        known: false,
        label: 'Stav se nepodařilo bezpečně rozpoznat.',
        mutationBlocked: true,
      }
    : { known: true, label, mutationBlocked: false };
};
