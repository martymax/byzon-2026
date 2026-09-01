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

const noAction = (): null => null;
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
      'Souhrnný filtr neaktivovaných účastníků zatím není dostupný.',
    icon: 'activation',
    label: adminMetricLabels.activation,
    resolveAction: noAction,
    showInAttention: alwaysVisible,
  },
  import: {
    fallback: () =>
      'Detail zdrojové dávky zatím není součástí provozního přehledu.',
    icon: 'tickets',
    label: adminMetricLabels.import,
    resolveAction: noAction,
    showInAttention: alwaysVisible,
  },
  content: {
    fallback: () => null,
    icon: 'content',
    label: adminMetricLabels.content,
    resolveAction: (context) =>
      hasPermission(context, 'program:manage')
        ? { href: '/admin/obsah', label: 'Zkontrolovat obsah' }
        : null,
    showInAttention: (context) => hasPermission(context, 'program:manage'),
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
        : 'Detail konkrétního doručení zatím není v přehledu dostupný.',
    icon: 'announcements',
    label: adminMetricLabels.notification,
    resolveAction: noAction,
    showInAttention: alwaysVisible,
  },
} satisfies Record<AdminDashboardMetricId, AdminDashboardMetricDefinition>;
