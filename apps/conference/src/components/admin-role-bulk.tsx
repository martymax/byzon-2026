'use client';

import { type AdminRoleAssignmentListResponse } from '@byzon/domain/contracts/admin';
import { requestAdminRoleAssignment } from '@/lib/admin-api';
import { createAdminBulkVersion } from './admin-bulk';
import { AdminBulkPanel } from './admin-bulk-panel';
import { adminBulkApiResult } from './admin-bulk-api';
import { createAdminIdempotencyKey } from './admin-workspace-runtime';
import { useAdminWorkspace } from './admin-workspace-shell';

export const AdminRoleBulk = ({
  assignments,
  disabled,
  onBusyChange,
  onCompleted,
}: {
  readonly assignments: AdminRoleAssignmentListResponse;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
}) => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const version = createAdminBulkVersion(assignments.assignmentsVersion);
  return (
    <AdminBulkPanel
      title="Hromadné odebrání provozních rolí"
      items={assignments.items}
      identify={(item) => ({
        id: item.assignmentId,
        label: item.operatorLabel,
        detail: `${item.role === 'moderator' ? 'Moderátor' : item.role === 'room_operator' ? 'Vedoucí aktivity' : 'Obsluha odbavení'} · ${item.scope.label}`,
      })}
      actions={[
        {
          id: 'revoke',
          label: 'Odebrat oprávnění',
          description:
            'Odebere vybraná provozní oprávnění. Ostatní role i členství v týmu zůstanou zachované.',
          reasonRequired: true,
          danger: true,
          execute: async (item, values, signal) => {
            const result = await requestAdminRoleAssignment(
              api,
              eventId,
              {
                action: 'revoke',
                assignmentId: item.assignmentId,
                expectedVersion: version.read(),
                reason: values.reason!.trim(),
              },
              createAdminIdempotencyKey('bulk-role'),
              signal,
            );
            if (result.ok && result.kind === 'success')
              version.accept(result.data.assignmentsVersion);
            return adminBulkApiResult(result, invalidateSensitive);
          },
        },
      ]}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onCompleted={onCompleted}
    />
  );
};
