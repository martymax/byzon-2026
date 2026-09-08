'use client';

import {
  adminParticipantUpdateRequestSchema,
  type AdminParticipantListItem,
} from '@byzon/domain/contracts/support';
import {
  requestAdminParticipantDetail,
  requestAdminParticipantUpdate,
} from '@/lib/admin-api';
import { AdminBulkPanel, type AdminBulkAction } from './admin-bulk-panel';
import { adminBulkApiResult } from './admin-bulk-api';
import { createAdminIdempotencyKey } from './admin-workspace-runtime';
import { useAdminWorkspace } from './admin-workspace-shell';

export const AdminParticipantBulk = ({
  items,
  selectedIds,
  onSelectionChange,
  disabled,
  onBusyChange,
  onCompleted,
}: {
  readonly items: readonly AdminParticipantListItem[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
}) => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const actions: AdminBulkAction<AdminParticipantListItem>[] = [
    {
      id: 'company',
      label: 'Změnit firmu',
      description: 'Nahradí firmu ve vybraných profilech.',
      fields: [
        { name: 'value', label: 'Firma (prázdné = vymazat)', required: false },
      ],
    },
    {
      id: 'jobTitle',
      label: 'Změnit pracovní pozici',
      description: 'Nahradí pracovní pozici ve vybraných profilech.',
      fields: [
        {
          name: 'value',
          label: 'Pracovní pozice (prázdné = vymazat)',
          required: false,
        },
      ],
    },
    {
      id: 'hide',
      label: 'Skrýt v networkingu',
      description: 'Skryje vybrané profily z networkingového adresáře.',
      danger: true,
      eligible: (item: AdminParticipantListItem) =>
        item.networkingState !== 'moderated',
    },
    {
      id: 'show',
      label: 'Zrušit skrytí v networkingu',
      description:
        'Odstraní skrytí moderátorem. Profil se zobrazí jen při zachovaném souhlasu účastníka s networkingem.',
      eligible: (item: AdminParticipantListItem) =>
        item.networkingState === 'moderated',
    },
    {
      id: 'disable',
      label: 'Vypnout networking',
      description:
        'Vypne networking u vybraných účastníků. Znovu si jej mohou zapnout ve svém profilu.',
      danger: true,
      eligible: (item: AdminParticipantListItem) =>
        item.networkingState === 'enabled',
    },
  ].map((action) => ({
    ...action,
    reasonRequired: true,
    validate: (_items, values) =>
      (values.value ?? '').length > 160
        ? 'Hodnota může obsahovat nejvýše 160 znaků.'
        : null,
    execute: async (item, values, signal) => {
      const loaded = await requestAdminParticipantDetail(
        api,
        eventId,
        item.participantId,
        signal,
      );
      if (!loaded.ok || loaded.kind !== 'success')
        return adminBulkApiResult(loaded, invalidateSensitive);
      const detail = loaded.data;
      if (detail.profileVersion !== item.profileVersion)
        return {
          ok: false,
          stop: true,
          message:
            'Profil se mezitím změnil. Načtěte aktuální seznam a změnu znovu zkontrolujte.',
        };
      const {
        firstName,
        lastName,
        contactEmail,
        phone,
        company,
        jobTitle,
        introduction,
        linkedinUrl,
        todayHunting,
        networkingEnabled,
        moderationStatus,
      } = detail;
      const profile = {
        firstName,
        lastName,
        contactEmail,
        phone,
        company,
        jobTitle,
        introduction,
        linkedinUrl,
        todayHunting,
        networkingEnabled,
        moderationStatus,
      };
      if (action.id === 'company' || action.id === 'jobTitle')
        profile[action.id] = values.value?.trim() ?? '';
      else if (action.id === 'disable') profile.networkingEnabled = false;
      else
        profile.moderationStatus = action.id === 'hide' ? 'hidden' : 'visible';
      const body = adminParticipantUpdateRequestSchema.safeParse({
        participantId: item.participantId,
        expectedProfileVersion: item.profileVersion,
        reason: values.reason!.trim(),
        profile,
      });
      if (!body.success)
        return { ok: false, message: 'Zkontrolujte hodnotu a důvod změny.' };
      return adminBulkApiResult(
        await requestAdminParticipantUpdate(
          api,
          eventId,
          item.participantId,
          body.data,
          createAdminIdempotencyKey('bulk-profile'),
          signal,
        ),
        invalidateSensitive,
      );
    },
  }));
  return (
    <AdminBulkPanel
      title="Hromadné úpravy profilů"
      items={items}
      identify={(item) => ({
        id: item.participantId,
        label: item.displayName,
        detail: item.contactEmail,
      })}
      actions={actions}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onCompleted={onCompleted}
    />
  );
};
