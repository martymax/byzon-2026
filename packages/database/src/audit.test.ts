import { describe, expect, it } from 'vitest';

import {
  AUDIT_REDACTION_MARKER,
  AuditValidationError,
  redactAuditText,
  redactAuditValue,
  validateAuditMetadata,
} from './audit.js';

describe('audit redaction', () => {
  it('recursively removes secrets and PII without mutating the input', () => {
    const input = {
      state: 'complete',
      user: {
        firstName: 'Anna',
        last_name: 'Nováková',
        contactEmail: 'anna@example.com',
        credentials: {
          accessToken: 'raw-access-token',
          password: 'raw-password',
        },
      },
      nested: [
        {
          message: 'private message',
          safeId: '019f7e6f-6300-7000-8000-000000000008',
        },
      ],
    };

    expect(redactAuditValue(input)).toEqual({
      state: 'complete',
      user: {
        firstName: AUDIT_REDACTION_MARKER,
        last_name: AUDIT_REDACTION_MARKER,
        contactEmail: AUDIT_REDACTION_MARKER,
        credentials: {
          accessToken: AUDIT_REDACTION_MARKER,
          password: AUDIT_REDACTION_MARKER,
        },
      },
      nested: [
        {
          message: AUDIT_REDACTION_MARKER,
          safeId: '019f7e6f-6300-7000-8000-000000000008',
        },
      ],
    });
    expect(input.user.contactEmail).toBe('anna@example.com');
  });

  it('redacts sensitive values embedded in otherwise safe text fields', () => {
    const redacted = redactAuditText(
      'Contact anna@example.com at +420 777 123 456 from 192.0.2.8; ' +
        'Authorization: Bearer raw.magic.token and ' +
        'https://app.example.invalid/callback?token=raw-token&next=/home',
    );

    expect(redacted).not.toContain('anna@example.com');
    expect(redacted).not.toContain('+420 777 123 456');
    expect(redacted).not.toContain('192.0.2.8');
    expect(redacted).not.toContain('raw.magic.token');
    expect(redacted).not.toContain('raw-token');
  });

  it('rejects descriptive metadata that could become a PII side channel', () => {
    expect(() =>
      validateAuditMetadata('onboarding.completed', 128),
    ).not.toThrow();
    expect(() => validateAuditMetadata('anna@example.com', 128)).toThrow(
      AuditValidationError,
    );
    expect(() => validateAuditMetadata('contains spaces', 128)).toThrow(
      AuditValidationError,
    );
  });
});
