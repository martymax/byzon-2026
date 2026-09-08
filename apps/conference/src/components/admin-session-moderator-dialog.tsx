'use client';

import { useState } from 'react';
import {
  adminEngagementMutationRequestSchema,
  type AdminEngagementMutationRequest,
  type AdminEngagementOverview,
  type AdminEngagementSession,
} from '@byzon/domain/contracts/admin-engagement';
import { AdminConfirmDialog } from './admin-confirm-dialog';
import styles from './admin-workspace.module.css';

export const AdminSessionModeratorDialog = ({
  session,
  candidates,
  assignmentsVersion,
  onConfirm,
  onDismiss,
}: {
  readonly session: AdminEngagementSession;
  readonly candidates: AdminEngagementOverview['moderatorCandidates'];
  readonly assignmentsVersion: number;
  readonly onConfirm: (body: AdminEngagementMutationRequest) => void;
  readonly onDismiss: () => void;
}) => {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const available = candidates.filter(
    (candidate) =>
      !session.moderators.some((m) => m.userId === candidate.userId),
  );
  const parsed = adminEngagementMutationRequestSchema.safeParse({
    action: 'assign_moderator',
    sessionId: session.sessionId,
    userId,
    expectedAssignmentsVersion: assignmentsVersion,
    reason: reason.trim(),
  });
  const canConfirm =
    parsed.success && available.some((c) => c.userId === userId);

  return (
    <AdminConfirmDialog
      title="Přiřadit moderátora"
      description={`Přednáška: ${session.title}. Moderátora lze připravit i při vypnutém Q&A. Stávající moderátoři zůstanou přiřazení.`}
      acknowledgement="Potvrzuji vybraného moderátora a přednášku."
      confirmLabel="Přiřadit moderátora"
      confirmDisabled={!canConfirm}
      onDismiss={onDismiss}
      onConfirm={() => {
        if (canConfirm && parsed.success) onConfirm(parsed.data);
      }}
      impact={
        <div className={styles.stack}>
          {available.length === 0 ? (
            <p className={styles.callout}>
              {candidates.length === 0
                ? 'Nejsou k dispozici moderátoři s aktivním účastnickým účtem. Připravte účet v nastavení programových spolupracovníků.'
                : 'Všichni dostupní moderátoři už jsou k této přednášce přiřazeni.'}
            </p>
          ) : (
            <label className={styles.field}>
              <span>Moderátor</span>
              <select
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              >
                <option value="">Vyberte moderátora</option>
                {available.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.displayName} · {candidate.contactEmail}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={styles.field}>
            <span>Důvod přiřazení (8–500 znaků)</span>
            <input
              value={reason}
              minLength={8}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
      }
    />
  );
};
