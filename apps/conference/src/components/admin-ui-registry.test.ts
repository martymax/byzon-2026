import { describe, expect, it } from 'vitest';

import {
  adminActorRoleLabels,
  adminAuditActionLabels,
  adminAuditActorLabels,
  adminAuditCategoryLabels,
  adminContentResourceLabels,
  adminEngagementFeatureLabels,
  adminMetricLabels,
  adminPhaseLabels,
  adminQueueLabels,
  adminRegistrationModeLabels,
  resolveAdminPresentationLabel,
  supportActionLabels,
  ticketImportRowStatusLabels,
} from './admin-ui-registry';

describe('admin presentation registry', () => {
  it('provides human Czech labels for contract-derived values', () => {
    expect(adminPhaseLabels.archived).toContain('pouze čtení');
    expect(adminActorRoleLabels.room_operator).toBe('Vedoucí aktivity');
    expect(adminMetricLabels.import).toBe('Aktualizace vstupenek');
    expect(adminAuditCategoryLabels.support).toBe('Účastníci');
    expect(adminAuditActorLabels.system).toBe('Systém BYZON');
    expect(adminAuditActionLabels['ticket_import.applied']).toBe(
      'Použil změny vstupenek',
    );
    expect(ticketImportRowStatusLabels.conflict).toBe('Vyžaduje opravu');
    expect(supportActionLabels.resend).toContain('aktivační výzvu');
    expect(adminQueueLabels.notifications).toBe('Oznámení');
    expect(adminRegistrationModeLabels.invite_only).toBe('Pouze pro pozvané');
    expect(adminEngagementFeatureLabels.questionsEnabled).toContain('Otázky');
    expect(adminContentResourceLabels.sessions).toBe('Program');
  });

  it('blocks mutations for an unknown transport value without echoing it', () => {
    const result = resolveAdminPresentationLabel(
      ticketImportRowStatusLabels,
      'vendor_private_state',
    );

    expect(result).toEqual({
      known: false,
      label: 'Stav se nepodařilo bezpečně rozpoznat.',
      mutationBlocked: true,
    });
    expect(result.label).not.toContain('vendor_private_state');
  });
});
