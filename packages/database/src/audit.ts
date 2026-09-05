import type { DatabaseTransaction } from './client.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

export const AUDIT_REDACTION_MARKER = '[REDACTED]';

const MAX_AUDIT_DEPTH = 12;
const METADATA_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const SENSITIVE_KEY_PARTS = [
  'address',
  'authorization',
  'birth',
  'code',
  'cookie',
  'email',
  'firstname',
  'ipaddress',
  'lastname',
  'message',
  'name',
  'password',
  'phone',
  'profile',
  'secret',
  'session',
  'token',
  'useragent',
] as const;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<![A-F0-9-])(?:\+?\d[\d .()-]{7,}\d)(?![A-F0-9-])/gi;
const IP_ADDRESS_PATTERN =
  /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[A-F0-9]{0,4}:){2,}[A-F0-9:]{0,4}\b/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Z0-9._~+/-]+=*/gi;
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:code|password|secret|token)=)[^&#\s]*/gi;

export class AuditValidationError extends Error {
  constructor() {
    super('Audit entry is invalid');
    this.name = 'AuditValidationError';
  }
}

export const validateAuditMetadata = (
  value: string,
  maxLength: number,
): string => {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    !METADATA_PATTERN.test(value)
  ) {
    throw new AuditValidationError();
  }
  return value;
};

export const redactAuditText = (value: string): string =>
  value
    .replace(EMAIL_PATTERN, AUDIT_REDACTION_MARKER)
    .replace(PHONE_PATTERN, AUDIT_REDACTION_MARKER)
    .replace(IP_ADDRESS_PATTERN, AUDIT_REDACTION_MARKER)
    .replace(BEARER_PATTERN, AUDIT_REDACTION_MARKER)
    .replace(SENSITIVE_QUERY_PATTERN, `$1${AUDIT_REDACTION_MARKER}`);

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.endsWith(part));
};

const redactValue = (
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown => {
  if (depth > MAX_AUDIT_DEPTH) return AUDIT_REDACTION_MARKER;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactAuditText(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return AUDIT_REDACTION_MARKER;
  if (seen.has(value)) return AUDIT_REDACTION_MARKER;

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => redactValue(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key)
      ? AUDIT_REDACTION_MARKER
      : redactValue(item, seen, depth + 1);
  }
  seen.delete(value);
  return result;
};

export const redactAuditValue = (
  value: Record<string, unknown>,
): Record<string, unknown> =>
  redactValue(value, new WeakSet<object>(), 0) as Record<string, unknown>;

type AuditDatabase = Pick<DatabaseTransaction, 'insert'>;

export interface AuditLogInput {
  eventId: string;
  actorId: string | null;
  actorType: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  requestId: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface WriteAuditLogOptions {
  generateId?: () => string;
  occurredAt?: Date;
}

export const writeAuditLog = async (
  db: AuditDatabase,
  input: AuditLogInput,
  options: WriteAuditLogOptions = {},
): Promise<string> => {
  const id = (options.generateId ?? generateUuidV7)();
  await db.insert(schema.auditLogs).values({
    id,
    eventId: input.eventId,
    actorId: input.actorId,
    actorType: validateAuditMetadata(input.actorType, 32),
    action: validateAuditMetadata(input.action, 128),
    targetType: validateAuditMetadata(input.targetType, 128),
    targetId:
      input.targetId === undefined || input.targetId === null
        ? input.targetId
        : redactAuditText(input.targetId),
    requestId: input.requestId,
    reason:
      input.reason === undefined || input.reason === null
        ? input.reason
        : redactAuditText(input.reason),
    before:
      input.before === undefined || input.before === null
        ? input.before
        : redactAuditValue(input.before),
    after:
      input.after === undefined || input.after === null
        ? input.after
        : redactAuditValue(input.after),
    ...(options.occurredAt ? { createdAt: options.occurredAt } : {}),
  });
  return id;
};
