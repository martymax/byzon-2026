# API server primitives

API handlers under `/api/v1` use these primitives in this order:

1. Read the sanitized request ID with `getRequestId` and return it on every
   response.
2. Consume every applicable rate-limit bucket before starting the protected
   operation. Store implementations must be shared across instances and perform
   an atomic increment; store failure is fail-closed for protected mutations.
3. For replay-prone mutations, require `Idempotency-Key`, hash the exact method,
   path and request bytes, then call `executeIdempotentMutation`. Perform all
   business database writes through the supplied transaction. Do not call an
   external provider inside the callback; persist an outbox event for later
   delivery so a transaction rollback cannot duplicate a side effect.
4. Map expected `ApiProblemError` values and unknown exceptions through
   `problemResponse`. Never interpolate request input, PII or provider errors
   into `title`, `detail` or `fieldErrors`.

Idempotency keys are hashed before storage. Stored response DTOs must still be
minimal because they remain in PostgreSQL until expiry. Use short per-operation
scopes and the shortest TTL that safely covers client/network retries.

Rate-limit subjects must be environment-keyed HMAC-SHA-256 digests. Raw IPs,
emails, user IDs and device values are forbidden as store keys. An in-process
store is suitable only for isolated tests; staging and production require an
atomic shared provider before a protected endpoint is enabled.
