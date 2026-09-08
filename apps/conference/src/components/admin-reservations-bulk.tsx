'use client';

import {
  adminReservationMutationRequestSchema,
  adminSessionCapacityMutationRequestSchema,
  type AdminReservationSessionItem,
} from '@byzon/domain/contracts/admin';
import {
  requestAdminReservationMutation,
  requestAdminSessionCapacityMutation,
} from '@/lib/admin-api';
import type { AdminBulkSelection } from './admin-bulk-selection';
import { AdminBulkPanel, type AdminBulkAction } from './admin-bulk-panel';
import { adminBulkApiResult } from './admin-bulk-api';
import { createAdminIdempotencyKey } from './admin-workspace-runtime';
import { useAdminWorkspace } from './admin-workspace-shell';

export const AdminReservationsBulk = ({
  sessions,
  disabled,
  onBusyChange,
  onCompleted,
  selectedIds,
  onSelectionChange,
}: {
  readonly sessions: readonly AdminReservationSessionItem[];
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
} & AdminBulkSelection) => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const capacityActions: AdminBulkAction<AdminReservationSessionItem>[] = [
    'set',
    'adjust',
  ].map((mode) => ({
    id: mode,
    label: mode === 'set' ? 'Nastavit kapacitu' : 'Zvýšit / snížit kapacitu',
    description:
      mode === 'set'
        ? 'Nastaví stejnou rezervační kapacitu vybraných aktivit. Kapacita nesmí klesnout pod počet potvrzených rezervací.'
        : 'Změní stávající kapacity o zadaný počet míst. Aktivity bez nastavené kapacity budou přeskočeny.',
    reasonRequired: true,
    fields: [
      {
        name: 'capacity',
        label:
          mode === 'set'
            ? 'Nová kapacita'
            : 'Změna počtu míst (záporná = snížit)',
        type: 'number',
        min: mode === 'set' ? 1 : -100_000,
        max: 100_000,
      },
    ],
    eligible: (item) => mode === 'set' || item.capacity !== null,
    validate: (items, values) => {
      if (mode === 'adjust' && Number(values.capacity) === 0)
        return 'Zadejte nenulovou změnu kapacity.';
      for (const item of items) {
        const capacity =
          mode === 'set'
            ? Number(values.capacity)
            : (item.capacity ?? 0) + Number(values.capacity);
        if (capacity < Math.max(1, item.confirmedCount))
          return `${item.sessionTitle}: kapacita musí být alespoň ${Math.max(1, item.confirmedCount)}.`;
        if (
          !adminSessionCapacityMutationRequestSchema.safeParse({
            sessionId: item.sessionId,
            expectedVersion: item.capacityVersion,
            capacity,
            reason: values.reason?.trim(),
          }).success
        )
          return 'Zkontrolujte kapacitu a důvod změny.';
      }
      return null;
    },
    execute: async (item, values, signal) =>
      adminBulkApiResult(
        await requestAdminSessionCapacityMutation(
          api,
          eventId,
          {
            sessionId: item.sessionId,
            expectedVersion: item.capacityVersion,
            capacity:
              mode === 'set'
                ? Number(values.capacity)
                : (item.capacity ?? 0) + Number(values.capacity),
            reason: values.reason!.trim(),
          },
          createAdminIdempotencyKey('bulk-capacity'),
          signal,
        ),
        invalidateSensitive,
      ),
  }));
  return (
    <AdminBulkPanel
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      title="Hromadné úpravy kapacit"
      items={sessions}
      identify={(item) => ({
        id: item.sessionId,
        label: item.sessionTitle,
        detail: `Kapacita ${item.capacity ?? 'neuvedena'}, rezervováno ${item.confirmedCount}`,
      })}
      actions={capacityActions}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onCompleted={onCompleted}
    />
  );
};

export const AdminReservationCancellationBulk = ({
  reservations,
  inlineEditor = true,
  disabled,
  onBusyChange,
  onCompleted,
  ...selection
}: {
  readonly reservations: readonly (AdminReservationSessionItem['reservations'][number] & {
    readonly sessionTitle?: string;
  })[];
  readonly inlineEditor?: boolean;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
} & AdminBulkSelection) => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  return (
    <AdminBulkPanel
      {...selection}
      inlineEditor={inlineEditor}
      title="Hromadné rušení rezervací"
      items={reservations}
      identify={(item) => ({
        id: item.reservationId,
        label: item.participantName,
        detail: [item.contactEmail, item.sessionTitle]
          .filter(Boolean)
          .join(' · '),
      })}
      actions={[
        {
          id: 'cancel',
          label: 'Zrušit rezervace',
          description:
            'Zruší vybrané aktivní rezervace a uvolní místa ostatním účastníkům.',
          danger: true,
          reasonRequired: true,
          eligible: (item) =>
            item.state === 'reserved' &&
            item.availableActions.includes('cancel_reservation'),
          validate: (items, values) =>
            items.every(
              (item) =>
                adminReservationMutationRequestSchema.safeParse({
                  action: 'cancel_reservation',
                  reservationId: item.reservationId,
                  expectedVersion: item.version,
                  reason: values.reason?.trim(),
                }).success,
            )
              ? null
              : 'Zkontrolujte důvod změny.',
          execute: async (item, values, signal) =>
            adminBulkApiResult(
              await requestAdminReservationMutation(
                api,
                eventId,
                {
                  action: 'cancel_reservation',
                  reservationId: item.reservationId,
                  expectedVersion: item.version,
                  reason: values.reason!.trim(),
                },
                createAdminIdempotencyKey('bulk-reservation'),
                signal,
              ),
              invalidateSensitive,
            ),
        },
      ]}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onCompleted={onCompleted}
    />
  );
};
