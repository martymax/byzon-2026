import { describe, expect, it } from 'vitest';
import type { FeedbackRecipient } from '@byzon/domain/contracts';
import { feedbackRecipientIneligibility } from './admin-feedback';

const recipient: FeedbackRecipient = {
  id: '019fb200-0000-7000-8000-000000000001',
  name: 'Petra Nová',
  email: 'petra@example.test',
  suggestedRole: 'attendee',
  role: 'attendee',
  status: 'not_started',
  invitedAt: null,
  remindedAt: null,
  mailStatus: 'not_sent',
  emailEnabled: true,
};

describe('feedback recipient preview', () => {
  it('allows retrying a failed delivery in its original category only', () => {
    const invited: FeedbackRecipient = {
      ...recipient,
      invitedAt: '2026-09-21T10:00:00.000Z',
      mailStatus: 'failed',
    };
    expect(feedbackRecipientIneligibility(invited, 'invitation')).toBeNull();
    const reminded = { ...invited, remindedAt: '2026-09-22T10:00:00.000Z' };
    expect(
      feedbackRecipientIneligibility(reminded, 'invitation'),
    ).not.toBeNull();
    expect(feedbackRecipientIneligibility(reminded, 'reminder')).toBeNull();
  });
  it('allows an initial invitation only before a previous invitation', () => {
    expect(feedbackRecipientIneligibility(recipient, 'invitation')).toBeNull();
    expect(
      feedbackRecipientIneligibility(
        { ...recipient, invitedAt: '2026-09-21T10:00:00.000Z' },
        'invitation',
      ),
    ).not.toBeNull();
  });
  it('allows one reminder to previously invited, unfinished participants', () => {
    expect(
      feedbackRecipientIneligibility(recipient, 'reminder'),
    ).not.toBeNull();
    const invited = { ...recipient, invitedAt: '2026-09-21T10:00:00.000Z' };
    expect(feedbackRecipientIneligibility(invited, 'reminder')).toBeNull();
    expect(
      feedbackRecipientIneligibility(
        { ...invited, remindedAt: '2026-09-22T10:00:00.000Z' },
        'reminder',
      ),
    ).not.toBeNull();
  });
  it.each<Partial<FeedbackRecipient>>([
    { status: 'completed' },
    { emailEnabled: false },
    { mailStatus: 'pending' },
    { mailStatus: 'processing' },
  ])(
    'excludes completed, opted-out and actively queued recipients: %j',
    (patch) => {
      expect(
        feedbackRecipientIneligibility(
          { ...recipient, ...patch },
          'invitation',
        ),
      ).not.toBeNull();
      expect(
        feedbackRecipientIneligibility(
          { ...recipient, invitedAt: '2026-09-21T10:00:00.000Z', ...patch },
          'reminder',
        ),
      ).not.toBeNull();
    },
  );
});
