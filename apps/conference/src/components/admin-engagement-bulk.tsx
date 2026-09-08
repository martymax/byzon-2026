'use client';

import {
  adminEngagementMutationRequestSchema,
  type AdminEngagementMutationRequest,
  type AdminEngagementOverview,
  type AdminEngagementSession,
} from '@byzon/domain/contracts/admin-engagement';
import { requestAdminEngagementMutation } from '@/lib/admin-api';
import { createAdminBulkVersion } from './admin-bulk';
import { AdminBulkPanel, type AdminBulkAction } from './admin-bulk-panel';
import { adminBulkApiResult } from './admin-bulk-api';
import { createAdminIdempotencyKey } from './admin-workspace-runtime';
import { useAdminWorkspace } from './admin-workspace-shell';

export const AdminEngagementBulk = ({
  overview,
  disabled,
  onBusyChange,
  onCompleted,
}: {
  readonly overview: AdminEngagementOverview;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
}) => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const assignmentsVersion = createAdminBulkVersion(
    overview.assignmentsVersion,
  );
  const execute = async (
    body: AdminEngagementMutationRequest,
    signal: AbortSignal,
  ) => {
    const parsed = adminEngagementMutationRequestSchema.safeParse(body);
    if (!parsed.success)
      return { ok: false, message: 'Zkontrolujte důvod a parametry změny.' };
    const result = await requestAdminEngagementMutation(
      api,
      eventId,
      parsed.data,
      createAdminIdempotencyKey('bulk-engagement'),
      signal,
    );
    if (
      result.ok &&
      result.kind === 'success' &&
      'assignmentsVersion' in result.data
    )
      assignmentsVersion.accept(result.data.assignmentsVersion);
    return adminBulkApiResult(result, invalidateSensitive);
  };
  const actions: AdminBulkAction<AdminEngagementSession>[] = [true, false].map(
    (enabled) => ({
      id: enabled ? 'enable' : 'disable',
      label: enabled ? 'Povolit otázky' : 'Zakázat otázky',
      description: enabled
        ? 'Povolí otázky u vybraných přednášek. Pro účastníky musí být zároveň zapnuté otázky v nastavení celé akce.'
        : 'Zakáže pokládání otázek u vybraných přednášek.',
      danger: !enabled,
      reasonRequired: true,
      eligible: (session) =>
        session.status !== 'archived' &&
        session.status !== 'cancelled' &&
        session.questionsEnabled !== enabled,
      execute: (session, values, signal) =>
        execute(
          {
            action: 'set_session_questions',
            sessionId: session.sessionId,
            expectedSessionVersion: session.version,
            enabled,
            reason: values.reason!.trim(),
          },
          signal,
        ),
    }),
  );
  for (const assign of [true, false])
    actions.push({
      id: assign ? 'assign' : 'remove',
      label: assign ? 'Přiřadit moderátora' : 'Odebrat moderátora',
      description: assign
        ? 'Přidá zvoleného moderátora k vybraným přednáškám s povolenými otázkami. Ostatní moderátoři zůstanou zachováni.'
        : 'Odebere zvoleného moderátora z vybraných přednášek.',
      danger: !assign,
      reasonRequired: true,
      fields: [
        {
          name: 'userId',
          label: 'Moderátor',
          options: [
            ...new Map([
              ...overview.moderatorCandidates.map(
                (candidate) =>
                  [
                    candidate.userId,
                    {
                      value: candidate.userId,
                      label: `${candidate.displayName} · ${candidate.contactEmail}`,
                    },
                  ] as const,
              ),
              ...(!assign
                ? overview.sessions.flatMap((session) =>
                    session.moderators.map(
                      (moderator) =>
                        [
                          moderator.userId,
                          {
                            value: moderator.userId,
                            label: `${moderator.displayName} · ${moderator.contactEmail}`,
                          },
                        ] as const,
                    ),
                  )
                : []),
            ]).values(),
          ],
        },
      ],
      eligible: (session, values) =>
        assign
          ? overview.features.questionsEnabled &&
            session.questionsEnabled &&
            !['cancelled', 'archived'].includes(session.status) &&
            !session.moderators.some(
              (moderator) => moderator.userId === values.userId,
            )
          : session.moderators.some(
              (moderator) => moderator.userId === values.userId,
            ),
      execute: (session, values, signal) => {
        return execute(
          {
            action: assign ? 'assign_moderator' : 'remove_moderator',
            sessionId: session.sessionId,
            userId: values.userId!,
            expectedAssignmentsVersion: assignmentsVersion.read(),
            reason: values.reason!.trim(),
          },
          signal,
        );
      },
    });
  return (
    <AdminBulkPanel
      title="Hromadné úpravy otázek a moderátorů"
      items={overview.sessions}
      identify={(session) => ({ id: session.sessionId, label: session.title })}
      actions={actions}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onCompleted={onCompleted}
    />
  );
};
