import type {
  AdminContextResponse,
  AdminOperationsOverviewResponse,
} from '@byzon/domain/contracts/admin';

import { adminMetricLabels } from './admin-ui-registry';

export type AdminDashboardMetricId =
  AdminOperationsOverviewResponse['metrics'][number]['id'];

export type AdminDashboardMetricIcon =
  | 'activation'
  | 'tickets'
  | 'content'
  | 'checkin'
  | 'reservations'
  | 'announcements';

export interface AdminDashboardAction {
  readonly href: string;
  readonly label: string;
}

interface AdminDashboardMetricDefinition {
  readonly fallback: (context: AdminContextResponse) => string | null;
  readonly icon: AdminDashboardMetricIcon;
  readonly label: string;
  readonly resolveAction: (
    context: AdminContextResponse,
  ) => AdminDashboardAction | null;
  readonly showInAttention: (context: AdminContextResponse) => boolean;
}

const hasPermission = (
  context: AdminContextResponse,
  permission: AdminContextResponse['actor']['permissions'][number],
): boolean => context.actor.permissions.includes(permission);

const alwaysVisible = (): boolean => true;

export const adminDashboardMetricOrder = [
  'activation',
  'import',
  'content',
  'checkin',
  'reservation',
  'notification',
] as const satisfies readonly AdminDashboardMetricId[];

export const adminDashboardMetricRegistry = {
  activation: {
    fallback: () =>
      'Správu účastníků může otevřít organizátor s příslušným oprávněním.',
    icon: 'activation',
    label: adminMetricLabels.activation,
    resolveAction: (context) =>
      hasPermission(context, 'participant:operational:read')
        ? { href: '/admin/ucastnici', label: 'Otevřít účastníky' }
        : null,
    showInAttention: alwaysVisible,
  },
  import: {
    fallback: () =>
      'Aktualizaci vstupenek může zkontrolovat organizátor s příslušným oprávněním.',
    icon: 'tickets',
    label: adminMetricLabels.import,
    resolveAction: (context) =>
      hasPermission(context, 'ticket:any:manage')
        ? { href: '/admin/vstupenky', label: 'Otevřít aktualizace vstupenek' }
        : null,
    showInAttention: alwaysVisible,
  },
  content: {
    fallback: () =>
      'Publikaci programu může zkontrolovat organizátor s příslušným oprávněním.',
    icon: 'content',
    label: adminMetricLabels.content,
    resolveAction: (context) =>
      hasPermission(context, 'program:manage')
        ? { href: '/admin/obsah', label: 'Zkontrolovat obsah' }
        : null,
    showInAttention: alwaysVisible,
  },
  checkin: {
    fallback: () => 'Odbavení vyžaduje samostatné oprávnění.',
    icon: 'checkin',
    label: adminMetricLabels.checkin,
    resolveAction: (context) =>
      context.capabilities.canEnterCheckin
        ? { href: '/check-in', label: 'Přejít do odbavení' }
        : null,
    showInAttention: alwaysVisible,
  },
  reservation: {
    fallback: () => 'Kapacity lze otevřít jen s oprávněním pro rezervace.',
    icon: 'reservations',
    label: adminMetricLabels.reservation,
    resolveAction: (context) =>
      hasPermission(context, 'reservation:any:read')
        ? { href: '/admin/rezervace', label: 'Zkontrolovat kapacitu' }
        : null,
    showInAttention: alwaysVisible,
  },
  notification: {
    fallback: (context) =>
      !context.features.announcementsEnabled
        ? 'Oznámení jsou pro tuto akci vypnutá.'
        : 'Oznámení může zkontrolovat organizátor s příslušným oprávněním.',
    icon: 'announcements',
    label: adminMetricLabels.notification,
    resolveAction: (context) =>
      context.features.announcementsEnabled &&
      hasPermission(context, 'announcement:send')
        ? { href: '/admin/oznameni', label: 'Zkontrolovat oznámení' }
        : null,
    showInAttention: (context) => context.features.announcementsEnabled,
  },
} satisfies Record<AdminDashboardMetricId, AdminDashboardMetricDefinition>;
