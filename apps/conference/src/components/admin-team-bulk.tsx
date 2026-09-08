'use client';

import {
  adminTeamMemberMutationRequestSchema,
  type AdminTeamMember,
  type AdminAssignmentRole,
  type AdminAssignmentScope,
} from '@byzon/domain/contracts/admin';
import { useEffect, useState } from 'react';
import {
  requestAdminTeamInvitation,
  requestAdminTeamMemberMutation,
  requestAdminRoleScopes,
  requestAdminRoleAssignment,
} from '@/lib/admin-api';
import { createAdminBulkVersion } from './admin-bulk';
import { AdminBulkPanel, type AdminBulkAction } from './admin-bulk-panel';
import { adminBulkApiResult } from './admin-bulk-api';
import { createAdminIdempotencyKey } from './admin-workspace-runtime';
import { useAdminWorkspace } from './admin-workspace-shell';

export const AdminTeamBulk = ({
  members,
  teamVersion,
  disabled,
  onBusyChange,
  onCompleted,
}: {
  readonly members: readonly AdminTeamMember[];
  readonly teamVersion: number;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
}) => {
  const { api, context, eventId, invalidateSensitive } = useAdminWorkspace();
  const [opened, setOpened] = useState(false);
  const [roleOptions, setRoleOptions] = useState<
    readonly { role: AdminAssignmentRole; scope: AdminAssignmentScope }[]
  >([]);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const canGrant = ['draft', 'activation_open', 'live'].includes(
    context.event.phase,
  );
  useEffect(() => {
    if (!opened || !canGrant) return;
    const controller = new AbortController();
    const roles = ['checkin_operator', 'room_operator', 'moderator'] as const;
    void Promise.all(
      roles.map((role) =>
        requestAdminRoleScopes(api, eventId, { role }, controller.signal),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const choices: {
        role: AdminAssignmentRole;
        scope: AdminAssignmentScope;
      }[] = [];
      results.forEach((result, index) => {
        if (result.ok && result.kind === 'success')
          choices.push(
            ...result.data.options.map((scope) => ({
              role: roles[index]!,
              scope,
            })),
          );
        else {
          adminBulkApiResult(result, invalidateSensitive);
          setScopeError(
            'Některé provozní role se nepodařilo načíst. Dostupné rozsahy můžete obnovit novým načtením stránky.',
          );
        }
      });
      setRoleOptions(choices);
    });
    return () => controller.abort();
  }, [api, canGrant, eventId, invalidateSensitive, opened]);
  // The captured batch advances only with versions confirmed by the server.
  const version = createAdminBulkVersion(teamVersion);
  const actions: AdminBulkAction<AdminTeamMember>[] = [
    {
      id: 'invite',
      label: 'Odeslat pozvánky',
      description:
        'Odešle vybraným členům týmu e-mail s odkazem pro přihlášení. Členové s aktivním přístupem budou přeskočeni.',
      eligible: (member) => member.invitation.status !== 'accepted',
      validate: (items) =>
        items.length > 25 ? 'Najednou lze odeslat nejvýše 25 pozvánek.' : null,
      execute: async (member, _values, signal) =>
        adminBulkApiResult(
          await requestAdminTeamInvitation(
            api,
            eventId,
            { memberId: member.memberId },
            createAdminIdempotencyKey('bulk-team-invite'),
            signal,
          ),
          invalidateSensitive,
        ),
    },
  ];
  if (canGrant && roleOptions.length > 0)
    actions.push({
      id: 'grant_role',
      label: 'Přiřadit provozní roli',
      reasonRequired: true,
      description:
        'Přidá vybraným členům provozní roli pro zvolenou oblast. Ostatní oprávnění zůstanou zachovaná.',
      fields: [
        {
          name: 'roleOption',
          label: 'Role a oblast',
          options: roleOptions.map((option, index) => ({
            value: String(index),
            label: `${option.role === 'moderator' ? 'Moderátor' : option.role === 'room_operator' ? 'Vedoucí aktivity' : 'Obsluha odbavení'} · ${option.scope.label}`,
          })),
        },
      ],
      execute: async (member, values, signal) => {
        const option = roleOptions[Number(values.roleOption)];
        if (!option)
          return {
            ok: false,
            stop: true,
            message: 'Vybraná role už není dostupná.',
          };
        const result = await requestAdminRoleAssignment(
          api,
          eventId,
          {
            action: 'grant',
            operatorId: member.memberId,
            role: option.role,
            scope: option.scope,
            expectedVersion: version.read(),
            reason: values.reason!.trim(),
          },
          createAdminIdempotencyKey('bulk-team-role'),
          signal,
        );
        if (result.ok && result.kind === 'success')
          version.accept(result.data.assignmentsVersion);
        return adminBulkApiResult(result, invalidateSensitive);
      },
    });
  for (const operation of ['grant_admin', 'revoke_admin', 'remove'] as const) {
    const body = (member: AdminTeamMember, reason: string) =>
      operation === 'remove'
        ? {
            action: 'remove' as const,
            memberId: member.memberId,
            expectedVersion: version.read(),
            reason,
          }
        : {
            action: 'update' as const,
            memberId: member.memberId,
            expectedVersion: version.read(),
            reason,
            displayName: member.displayName,
            email: member.email,
            administrator: operation === 'grant_admin',
          };
    actions.push({
      id: operation,
      label:
        operation === 'grant_admin'
          ? 'Přidat administrátorský přístup'
          : operation === 'revoke_admin'
            ? 'Odebrat administrátorský přístup'
            : 'Odebrat členy týmu',
      description:
        operation === 'grant_admin'
          ? 'Udělí vybraným členům administrátorský přístup k akci.'
          : operation === 'revoke_admin'
            ? 'Odebere administrátorská oprávnění a zachová provozní role. Členy bez další role odeberte pomocí odebrání z týmu.'
            : 'Odebere členství i přístupy vybraných členů k této akci. Vlastní účet a poslední administrátor jsou chráněni.',
      danger: true,
      reasonRequired: true,
      eligible: (member) =>
        !member.isCurrentActor &&
        (operation === 'remove' ||
          (operation === 'grant_admin'
            ? !member.roles.includes('organizer_admin')
            : member.roles.includes('organizer_admin') &&
              member.roles.length > 1)),
      validate: (items, values) =>
        items.every(
          (item) =>
            adminTeamMemberMutationRequestSchema.safeParse(
              body(item, values.reason?.trim() ?? ''),
            ).success,
        )
          ? null
          : 'Zkontrolujte důvod změny.',
      execute: async (member, values, signal) => {
        const result = await requestAdminTeamMemberMutation(
          api,
          eventId,
          body(member, values.reason!.trim()),
          createAdminIdempotencyKey('bulk-team'),
          signal,
        );
        if (result.ok && result.kind === 'success')
          version.accept(result.data.teamVersion);
        return adminBulkApiResult(result, invalidateSensitive);
      },
    });
  }
  return (
    <>
      {scopeError ? <p role="alert">{scopeError}</p> : null}
      <AdminBulkPanel
        title="Hromadné úpravy týmu"
        onOpen={() => setOpened(true)}
        items={members}
        identify={(member) => ({
          id: member.memberId,
          label: member.displayName,
          detail: member.email,
        })}
        actions={actions}
        disabled={disabled}
        onBusyChange={onBusyChange}
        onCompleted={onCompleted}
      />
    </>
  );
};
