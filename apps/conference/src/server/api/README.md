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

`P8-01` provides that shared provider as `rateLimitStore` backed by one atomic
Redis Lua fixed window. Route owners must still define and test their explicit
scope, limit, window, subject parts and outage policy. Protected mutations fail
closed when Redis is unavailable; read availability may degrade only when its
route contract explicitly allows and logs that behavior.

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

## Identity and account

`GET /api/v1/me/bootstrap` resolves the canonical event on the server and
derives the user exclusively from the Better Auth session. It never accepts an
event or user identifier from the browser. Bootstrap, onboarding, profile,
privacy and session-action responses are `private, no-store` and vary by Cookie
and Authorization.

All `/api/v1/me` mutations require the exact `APP_BASE_URL` origin. Onboarding
uses both a hashed idempotency key with a stored response DTO and a deterministic
request UUID for append-only consent deduplication. Profile updates use a
per-owner lock and resource version; privacy and session actions also execute
their database writes in the idempotency transaction. Current legal documents
must contain contract-safe plain text or a credential-free HTTPS URL. Missing
or stale legal configuration fails closed.

`POST /api/v1/me/session-action` asks Better Auth for its canonical cookie
clearance before atomically revoking the selected session scope. The server DTO
never claims that browser-local P2 data was cleared; the client performs and
reports that separate in-memory/offline wipe after the response is correlated.
After revocation, a bounded exact-fingerprint replay may use the unexpired
idempotency key as a bearer capability; it returns only the stored non-PII DTO
and fails closed if the key is absent, ambiguous or paired with different bytes.

## Assigned activity roster

`GET /api/v1/activity-roster` and
`GET /api/v1/activity-roster/:sessionId` derive the actor from Better Auth and
the event from the canonical server event slug. Access requires an active
membership and active `room_operator` role; the only accepted resource scope
is the bounded UUID list in that role's `sessionIds`. A missing, revoked,
cross-event or malformed assignment fails closed. The detail endpoint returns
the same `ROSTER_NOT_FOUND` response for an unknown and an unassigned session.
Roster PII also fails closed once the canonical event reaches its operational
data anonymization deadline.

The roster reads only published, reservation-capacity, non-networking sessions.
Networking remains excluded behind `BLOCKER-RES-01`. Participants come from
active confirmed reservations or waiting FIFO entries joined to active event
memberships and the event profile. The response allowlists only reservation
reference, reservation state, display name and company; it never returns user
ID, e-mail, phone, ticket data or attendance evidence. Responses
are `private, no-store`, vary by Cookie and Authorization and must not be
persisted in the browser. There is no roster mutation or export endpoint.

## Participant agenda

`GET /api/v1/me/agenda` and `POST /api/v1/me/agenda/actions` derive both the
actor and canonical event on the server. They require an active membership and
participant-owned agenda permission, reject draft/archived events and stop
serving operational data at the event anonymization deadline. Responses are
bounded, `private, no-store` and vary by Cookie and Authorization.

The current production mutation allowlist is `add`, `remove` and `reserve`.
Every mutation requires exact same-origin JSON, an idempotency key and the
canonical agenda version. Owner-scoped advisory locking serializes agenda
changes; reservation adds a second event/session lock before counting confirmed
places and inserting the final seat. A reservation also requires a saved agenda
item, an activated ticket and a published non-networking session with explicit
reservation capacity. Successful writes and their minimal audit entry share one
transaction; no-op and replay do not create another audit row. Idempotency
storage contains only action, session reference, outcome and resulting version;
the private canonical response is rebuilt through the current access and
anonymization gates on both the first response and replay.

The read model joins manual/organizer agenda items with confirmed reservations
and any pre-existing waiting rows. Cancellation and waitlist controls remain
server-disabled until `P5-04`/`P5-05`, networking remains behind
`BLOCKER-RES-01`, coaching source reconciliation belongs to `P5-06`, and the
calendar representation remains unavailable until `P5-09`. The immutable
publication is the visibility allowlist while non-archived operational rows
provide capacity and immediate cancellation state. Capacity drift degrades only
the affected confirmed reservation to a conservative closed projection and
emits an operator warning instead of failing the entire agenda.

Agenda routes use two explicit one-minute shared Redis buckets keyed by an
environment-keyed HMAC of the canonical event slug and authenticated user ID.
`participant_agenda.read` allows 120 requests and deliberately fails open with
a throttled PII-free warning when Redis is unavailable. The
`participant_agenda.mutation` bucket allows 30 requests and fails closed before
database or idempotency work when Redis is unavailable. Both return the
standard rate-limit headers; exhausted buckets return `429 RATE_LIMITED`.

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
