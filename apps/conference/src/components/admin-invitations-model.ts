import type {
  AdminInvitationRecipient,
  AdminInvitationRole,
} from '@byzon/domain/contracts';

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
