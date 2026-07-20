import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  withTransaction,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';

import { ApiProblemError } from './problem';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const keyRequired = (): ApiProblemError =>
  new ApiProblemError({
    status: 400,
    code: 'IDEMPOTENCY_KEY_REQUIRED',
    title: 'Idempotency key required',
    detail: 'This mutation requires an Idempotency-Key header.',
  });

const keyInvalid = (): ApiProblemError =>
  new ApiProblemError({
    status: 400,
    code: 'IDEMPOTENCY_KEY_INVALID',
    title: 'Invalid idempotency key',
    detail: 'The supplied Idempotency-Key is invalid.',
  });

export const readIdempotencyKey = (headers: Headers): string => {
  const key = headers.get('idempotency-key');
  if (!key) throw keyRequired();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw keyInvalid();
  return key;
};

export interface IdempotencyRequestFingerprint {
  method: string;
  path: string;
  body: string | Uint8Array;
}

export const hashIdempotencyRequest = (
  input: IdempotencyRequestFingerprint,
): string =>
  createHash('sha256')
    .update(input.method.toUpperCase())
    .update('\n')
    .update(input.path)
    .update('\n')
    .update(input.body)
    .digest('hex');

const hashKey = (key: string): string =>
  createHash('sha256').update(key).digest('hex');

export interface IdempotentMutationInput {
  eventId: string;
  actorId: string | null;
  scope: string;
  key: string;
  requestHash: string;
  ttlMs: number;
  now?: Date;
  generateId?: () => string;
}

export interface IdempotentOperationResult<
  Body extends Record<string, unknown>,
> {
  status: number;
  body: Body;
  resultReference?: string | null;
}

export interface IdempotentMutationResult<
  Body extends Record<string, unknown>,
> extends IdempotentOperationResult<Body> {
  replayed: boolean;
}

const validateInput = (input: IdempotentMutationInput): void => {
  if (
    !IDEMPOTENCY_KEY_PATTERN.test(input.key) ||
    !SCOPE_PATTERN.test(input.scope) ||
    !HASH_PATTERN.test(input.requestHash) ||
    !UUID_PATTERN.test(input.eventId) ||
    (input.actorId !== null && !UUID_PATTERN.test(input.actorId)) ||
    !Number.isInteger(input.ttlMs) ||
    input.ttlMs < 1_000 ||
    input.ttlMs > MAX_TTL_MS
  ) {
    throw keyInvalid();
  }
};

const normalizeBody = <Body extends Record<string, unknown>>(
  body: Body,
): Body => {
  try {
    const serialized = JSON.stringify(body);
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new TypeError('Idempotent response body must be a JSON object');
    }
    return parsed as Body;
  } catch {
    throw new TypeError('Idempotent response body must be JSON serializable');
  }
};

const reusedKey = (): ApiProblemError =>
  new ApiProblemError({
    status: 409,
    code: 'IDEMPOTENCY_KEY_REUSED',
    title: 'Idempotency conflict',
    detail: 'The idempotency key was already used for a different request.',
  });

const incompleteKey = (): ApiProblemError =>
  new ApiProblemError({
    status: 409,
    code: 'IDEMPOTENCY_IN_PROGRESS',
    title: 'Idempotent request in progress',
    detail: 'The original request has not completed. Try again later.',
  });

export const executeIdempotentMutation = async <
  Body extends Record<string, unknown>,
>(
  db: Database,
  input: IdempotentMutationInput,
  operation: (
    transaction: DatabaseTransaction,
  ) => Promise<IdempotentOperationResult<Body>>,
): Promise<IdempotentMutationResult<Body>> => {
  validateInput(input);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw keyInvalid();
  const storedKey = hashKey(input.key);
  const generateId = input.generateId ?? generateUuidV7;

  return withTransaction(db, async (transaction) => {
    await acquireTransactionLock(
      transaction,
      `idempotency:${input.eventId}:${input.actorId ?? 'anonymous'}:${input.scope}:${storedKey}`,
    );
    const actorCondition =
      input.actorId !== null
        ? eq(schema.idempotencyKeys.actorId, input.actorId)
        : isNull(schema.idempotencyKeys.actorId);
    const [existing] = await transaction
      .select()
      .from(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.eventId, input.eventId),
          actorCondition,
          eq(schema.idempotencyKeys.scope, input.scope),
          eq(schema.idempotencyKeys.key, storedKey),
        ),
      )
      .limit(1);

    if (existing && existing.expiresAt > now) {
      if (existing.requestHash !== input.requestHash) throw reusedKey();
      if (existing.responseStatus === null || existing.responseBody === null) {
        throw incompleteKey();
      }
      return {
        status: existing.responseStatus,
        body: existing.responseBody as Body,
        resultReference: existing.resultReference,
        replayed: true,
      };
    }
    if (existing) {
      await transaction
        .delete(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.id, existing.id));
    }

    const id = generateId();
    await transaction.insert(schema.idempotencyKeys).values({
      id,
      eventId: input.eventId,
      actorId: input.actorId,
      scope: input.scope,
      key: storedKey,
      requestHash: input.requestHash,
      expiresAt: new Date(now.getTime() + input.ttlMs),
    });

    const operationResult = await operation(transaction);
    if (
      !Number.isInteger(operationResult.status) ||
      operationResult.status < 200 ||
      operationResult.status > 299
    ) {
      throw new TypeError('Idempotent operation must return a success status');
    }
    const body = normalizeBody(operationResult.body);
    const resultReference = operationResult.resultReference ?? null;
    await transaction
      .update(schema.idempotencyKeys)
      .set({
        responseStatus: operationResult.status,
        responseBody: body,
        resultReference,
      })
      .where(eq(schema.idempotencyKeys.id, id));

    return {
      status: operationResult.status,
      body,
      resultReference,
      replayed: false,
    };
  });
};
