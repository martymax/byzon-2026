import type { FeedbackRecipient } from '@byzon/domain/contracts';

export type FeedbackMailKind = 'invitation' | 'reminder';

/** Keep the recipient preview aligned with server eligibility. The server rechecks at send time. */
export const feedbackRecipientIneligibility = (
  recipient: FeedbackRecipient,
  kind: FeedbackMailKind,
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
  if (
    kind === 'reminder' &&
    recipient.remindedAt &&
    recipient.mailStatus !== 'failed'
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
