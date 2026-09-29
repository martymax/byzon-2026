import type { FeedbackRecipient } from '@byzon/domain/contracts';

export type FeedbackMailKind = 'invitation' | 'reminder';

/** Keep the recipient preview aligned with server eligibility. The server rechecks at send time. */
export const feedbackRecipientIneligibility = (
  recipient: FeedbackRecipient,
  kind: FeedbackMailKind,
  reminderNumber = 1,
): string | null => {
  if (!recipient.emailEnabled) return 'E-maily jsou vypnuté';
  if (recipient.status === 'completed') return 'Hodnocení už dokončeno';
  if (
    recipient.mailStatus === 'pending' ||
    recipient.mailStatus === 'processing'
  )
    return 'E-mail čeká na odeslání';
  if (
    kind === 'invitation' &&
    recipient.invitedAt &&
    !(recipient.mailStatus === 'failed' && !recipient.remindedAt)
  )
    return 'Pozvánka už byla zařazena';
  if (kind === 'reminder' && !recipient.invitedAt)
    return 'Nejprve pošlete pozvánku';
  if (kind === 'reminder' && reminderNumber > 1) {
    const previous = recipient.reminders?.find(
      (row) => row.number === reminderNumber - 1,
    );
    if (previous?.status !== 'delivered')
      return `Nejprve musí být odeslána ${reminderNumber - 1}. připomínka`;
  }
  const current = recipient.reminders?.find(
    (row) => row.number === reminderNumber,
  );
  if (
    kind === 'reminder' &&
    ((current && current.status !== 'failed') ||
      (reminderNumber === 1 &&
        !current &&
        recipient.remindedAt &&
        recipient.mailStatus !== 'failed'))
  )
    return 'Připomenutí už bylo zařazeno';
  return null;
};

export const feedbackEmailCount = (count: number): string =>
  `${count} ${count === 1 ? 'e-mail' : count >= 2 && count <= 4 ? 'e-maily' : 'e-mailů'}`;

export const feedbackRoleLabels = {
  attendee: 'Účastník',
  speaker: 'Speaker',
  moderator: 'Moderátor',
  partner: 'Partner',
} as const;
export const feedbackStatusLabels = {
  not_started: 'Nezačal/a',
  in_progress: 'Rozpracováno',
  completed: 'Dokončeno',
} as const;
export const feedbackMailStatusLabels = {
  not_sent: 'Neodesláno',
  pending: 'Ve frontě',
  processing: 'Odesílá se',
  delivered: 'Odesláno',
  failed: 'Odeslání selhalo',
  skipped: 'Vynecháno',
} as const;
