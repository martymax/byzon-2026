import type {
  AdminInvitationRecipient,
  AdminInvitationRole,
} from '@byzon/domain/contracts';
import type { AdminBulkOutcome, AdminBulkResult } from './admin-bulk';

export const invitationRoleLabels: Record<AdminInvitationRole, string> = {
  participant: 'Účastník',
  speaker: 'Řečník',
  room_operator: 'Vedoucí aktivity / kouč',
  moderator: 'Moderátor',
  organizer_admin: 'Administrátor',
  checkin_operator: 'Obsluha odbavení',
};
export const invitationStatusLabels = {
  not_sent: 'Neodeslána',
  sent: 'Odeslána',
  accepted: 'Účet aktivován',
};
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs');

export function filterInvitationRecipients(
  items: readonly AdminInvitationRecipient[],
  roles: ReadonlySet<AdminInvitationRole>,
  query: string,
  status: keyof typeof invitationStatusLabels | 'all',
) {
  const search = normalize(query.trim());
  return items.filter(
    (item) =>
      (roles.size === 0 || item.roles.some((role) => roles.has(role))) &&
      (status === 'all' || item.invitation.status === status) &&
      normalize(`${item.displayName} ${item.email}`).includes(search),
  );
}

export function selectVisibleRecipients(
  selected: ReadonlySet<string>,
  visible: readonly string[],
  checked: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  visible.forEach((id) => (checked ? next.add(id) : next.delete(id)));
  return next;
}

export const waitForInvitationWindow = (
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });

/** Ten sends per minute respect the existing participant mutation limit. */
export async function sendInvitationBatch({
  items,
  execute,
  signal,
  onProgress,
  onPause,
  wait = waitForInvitationWindow,
}: {
  items: readonly AdminInvitationRecipient[];
  execute: (
    item: AdminInvitationRecipient,
  ) => Promise<AdminBulkResult & { rateLimited?: boolean }>;
  signal: AbortSignal;
  onProgress: (completed: number) => void;
  onPause: (paused: boolean) => void;
  wait?: typeof waitForInvitationWindow;
}): Promise<readonly AdminBulkOutcome[]> {
  const outcomes: AdminBulkOutcome[] = [];
  let stopped = false;
  for (const [index, item] of items.entries()) {
    if (!stopped && !signal.aborted && index > 0 && index % 10 === 0) {
      onPause(true);
      await wait(61_000, signal);
      onPause(false);
    }
    if (stopped || signal.aborted) {
      outcomes.push({
        id: item.userId,
        label: item.displayName,
        status: 'skipped',
      });
      continue;
    }
    let result: AdminBulkResult & { rateLimited?: boolean };
    try {
      result = await execute(item);
      if (result.rateLimited && !signal.aborted) {
        onPause(true);
        await wait(61_000, signal);
        onPause(false);
        if (signal.aborted) {
          outcomes.push({
            id: item.userId,
            label: item.displayName,
            status: 'skipped',
          });
          continue;
        }
        result = await execute(item);
      }
    } catch {
      result = {
        ok: false,
        stop: true,
        message:
          'Server nepotvrdil odeslání. Opakováním výběru ověříte stejný pokus.',
      };
    }
    outcomes.push({
      id: item.userId,
      label: item.displayName,
      status: result.ok ? 'succeeded' : 'failed',
      ...(result.message ? { message: result.message } : {}),
    });
    stopped = result.stop === true;
    onProgress(index + 1);
  }
  return outcomes;
}
