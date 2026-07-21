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

## Session revocation

`POST /api/v1/auth/logout-all` requires a valid Better Auth session and an
`Origin` header exactly matching the origin of `APP_BASE_URL`. It delegates
session lifecycle to Better Auth: first it prepares the exact cookie-expiration
headers through `sign-out` without forwarding the caller cookie, then
`revoke-sessions` removes every database session for the user. Cookie preparation
must succeed before the irreversible revocation starts. A successful response is
always `no-store` and returns the request ID. Auth failures use the same safe
problem response contract as the other v1 routes.

Session expiry, refresh age and freshness are explicitly configured in
`server/auth.ts`. Keep these values aligned with the cookie lifetime and cover
changes with the PostgreSQL-backed HTTP integration test.

## Published participant program

`GET /api/v1/events/:eventId/program` requires an active event membership with
`program:published:read`. It reads only immutable `content_publications`
snapshots, never draft entity tables. Missing access and missing publication use
the same `404` response to avoid revealing event membership or content state.

The optional `day`, `room`, `type` and positive integer `version` filters are
bounded and reject unknown or repeated parameters. `day` accepts a published
day ID or local ISO date; `room` accepts a published room ID or slug. Responses
include the publication version and a representation-specific ETag. Authorized
`If-None-Match` requests support lists, weak comparison and `304`; participant
responses are private and vary by both Cookie and Authorization.
