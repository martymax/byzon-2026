# Frontend contract conventions

`@byzon/domain/contracts` is the browser-safe runtime boundary shared by API
handlers, frontend clients and synthetic fixtures.

## Exports

- Import only from the public `@byzon/domain/contracts` subpath. Do not import
  files from `src/contracts` directly.
- Runtime validators use the `Schema` suffix. TypeScript types are inferred
  from their schema and use the same name without `Schema`.
- Every capability owns one file named by the registry in §7.10 of
  `AI_IMPLEMENTATION_PLAN.md`. The public barrel in `index.ts` is the only
  place that exposes a completed slice.
- Contracts may import Zod and other browser-safe contract files. They must not
  import database entities, Drizzle, React, Next.js, `server-only` modules,
  provider SDKs or code from `apps/*`.

## Problem responses

`apiProblemSchema` validates only the bounded common
`application/problem+json` envelope. It is not an endpoint's final error
parser. Each endpoint must enumerate its supported codes using
`defineApiProblemSchema` and combine them into an explicit union. Unknown codes,
unknown fields and mismatched `type`/`code` pairs are rejected.

UI control flow uses `code` or the stable `ApiFailure.kind`; it never branches
on localized `title` or `detail`. Raw exceptions and response bodies are not
part of `ApiFailure` and must not reach rendering, analytics or support output.
Only the validated `requestId` may be shown as a correlation reference.

`AUTH_SESSION_EXPIRED` is distinct from a first-time anonymous
`AUTHENTICATION_REQUIRED` response. A client maps only the exact
`sessionExpiredProblemSchema` to `session_expired`; it must not infer expiry
from every `401`.

## Pagination and metadata

Cursors are opaque, bounded, transport-safe strings. Clients must return them
unchanged and must not decode identity or ordering from them. Capability
slices may lower `MAX_PAGE_SIZE`, but may not accept an unbounded limit.

`transportMetadataSchema` carries only validated correlation and cache
metadata. Payloads, credentials, PII, raw headers and exception messages never
belong in transport metadata.

## Published content (`CS-CONTENT-01`)

`content.ts` is the runtime boundary for the existing P3 published-program,
participant-directory and anonymous public-content endpoints. The strict HTTP
schemas reject unknown response fields; the separate publication-snapshot
schemas may strip server-only keys before the result is validated again as an
HTTP response.

- Participant program and content require the server-side
  `program:published:read` permission. A missing publication and denied event
  access intentionally share the safe `*_NOT_FOUND` UI state.
- Participant responses are private, revalidated by ETag and forbidden from
  shared/service-worker offline caches.
- Anonymous public content may use its existing short public cache. Offline
  persistence remains gated by `CS-OFFLINE-01`; this slice does not cache it.
- Speaker names and explicitly published profile copy are person-associated
  public content. E-mail, user identity, ticket state, private notes and admin
  metadata are absent from every response schema and synthetic fixture.
- `publishedProgramSnapshotSchema` and
  `publishedContentSnapshotSchema` exist only for server-side extraction.
  Browser code consumes the strict `*ResponseSchema` exports through the typed
  API port.

## Activation (`CS-ACT-01`)

`activation.ts` je privátní/no-store kontrakt veřejného aktivačního průchodu:
landing podle fáze eventu, přesné opaque ticket kódy, claim, identity handoff,
one-time link a neenumerující recovery. Všechny requesty, success DTO i problem
uniony jsou striktní a odmítají unknown pole.

Claim a identity response před autoritativním serverovým handoffem výslovně
nesou `membershipCreated: false` a `sessionCreated: false`. `returnTo` je
allowlist pouze `/app` a `/onboarding`; kód, token, e-mail ani flow ID se nesmí
ukládat do URL historie, cache nebo logu. Produkční handshake zůstává za
`BLOCKER-AUTH-01`/`BLOCKER-TKT-04`, zatímco frontend používá stejný kontrakt v
jasně označeném development preview.

## Identity bootstrap and onboarding (`CS-BOOT-01`)

`identity.ts` je privátní/no-store runtime hranice pro `/me/bootstrap` a
idempotentní `/me/onboarding`. Bootstrap striktně skládá event, minimální
identitu, eventový vztah bez klientem dodané role, profil, feature flags,
onboarding stav, privacy minimum a právě aktuální právní dokumenty. Pending
aktivace nesmí nést eventové role; live odpověď nesmí obsahovat syntetické
právní preview.

Povinné podmínky (`accepted`) a informace o soukromí (`acknowledged`) používají
přesná ID a verze. Dobrovolný networking je samostatná nepředvolená
discriminated volba; při opt-out se networking document ID vůbec neposílá.
Chybějící nebo zastaralá právní verze failne zavřeně a staré volby se nesmí
znovu použít. Profil i volby jsou P2 data: žádná URL, browser persistence,
offline mutace ani sdílená cache.

Development fixtures nesou explicitní `dataMode: synthetic_preview` a právní
texty jsou označené jako neschválený syntetický draft. Produkční texty,
souhlasy a UAT zůstávají za `BLOCKER-LEGAL-01`; skutečná autorizace a zápis
`P4-13` nejsou mockovaným dokončením předstírané.

## Participant ticket (`CS-TICKET-01`, status-only slice)

`ticket.ts` defines the private, no-store participant status DTO used by the
first `F2-04` UI slice. It allowlists only `valid`, `cancelled`, `refunded` and
`blocked`, a single bounded holder display name, and at most four
alphanumeric characters of an already-safe reference suffix.

The presentation union intentionally accepts only `state: unavailable`.
`BLOCKER-TKT-05` and `P4-12` must define the format, expiry, rotation and
verifier before any available/value branch can be added. Unknown fields,
presentation values, unsafe control/bidi characters and inconsistent
status/reason combinations are rejected. The full `CS-TICKET-01` lifecycle
therefore remains `not started` until that server/client contract is complete.

## Participant announcements (`CS-ANN-01`, inbox slice)

`announcements.ts` defines the Priority A participant list, detail and
idempotent read-result boundary. All DTOs are strict, audience-scoped and
`private, no-store`; they carry only bounded operational title, summary, plain
body text, severity, publication/read timestamps and an optional published
session context. Sender identity, recipient lists, audience definitions,
delivery/provider state and admin metadata are excluded.

Inbox entries are unique and ordered newest-first. The detail and read
endpoints must return the same `ANNOUNCEMENT_NOT_FOUND` response for a missing
announcement and for an authenticated user outside its immutable recipient
snapshot. The `announcement:own:read` permission additionally requires
`announcementRecipient: true`; role membership alone is insufficient.
`unreadCount` uses the same display-safe `999` ceiling as the identity
bootstrap; servers clamp larger counts instead of emitting a different shape.

Participant read state is P2 data. It is not eligible for shared or
service-worker caching, and the mutation remains online-only until
`CS-OFFLINE-01` defines an owner-safe queue and revocation behavior. Advanced
audience authoring, immutable preview/send and delivery channels remain owned
by `P8-05`, `P8-06` and `F4-06`.
