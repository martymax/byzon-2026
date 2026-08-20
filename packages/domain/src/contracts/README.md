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
  `publishedContentSnapshotSchema` are authoritative for server extraction
  and trusted immutable admin-preview validation. Participant/public browser
  clients consume the strict `*ResponseSchema` exports through typed API
  ports.

## Activation (`CS-ACT-01`)

`activation.ts` je privátní/no-store kontrakt veřejného aktivačního průchodu:
landing podle fáze eventu, přesné opaque ticket kódy, claim, identity handoff,
one-time link a neenumerující recovery. Všechny requesty, success DTO i problem
uniony jsou striktní a odmítají unknown pole.

Claim a identity response před autoritativním serverovým handoffem výslovně
nesou `membershipCreated: false` a `sessionCreated: false`. `returnTo` je
striktní allowlist `/onboarding`, přesných participant rout a pouze
kontraktovaných UUID/slug detailů; nejde o obecný same-origin redirect.
Aktivní link nikdy nevrací onboarding. Kód, token, e-mail ani flow ID se nesmí
ukládat do URL historie, cache nebo logu. Produkční handshake zůstává za
`BLOCKER-AUTH-01`/`BLOCKER-TKT-04`, zatímco frontend používá stejný kontrakt v
jasně označeném development preview.

## Identity bootstrap and onboarding (`CS-BOOT-01`)

`identity.ts` je privátní/no-store runtime hranice pro `/me/bootstrap` a
idempotentní `/me/onboarding`, optimistický `PATCH /me/profile` a idempotentní
`POST /me/privacy-requests`. Bootstrap striktně skládá event včetně časového
rozsahu, minimální
identitu, eventový vztah bez klientem dodané role, profil, feature flags,
onboarding stav, správu profilu s resource verzí, privacy stav, kontakt na
podporu, právní acknowledgements a právě aktuální právní dokumenty. Pending
aktivace nesmí nést eventové role; live odpověď nesmí obsahovat syntetické
právní preview.

Povinné podmínky (`accepted`) a informace o soukromí (`acknowledged`) používají
přesná ID a verze. Priority A onboarding má jen profil a tyto dva právní
kroky; networking patří do oddělené Priority B capability. Chybějící nebo
zastaralá právní verze failne zavřeně. Každý právní dokument nese buď úplný
bezpečný plain text, nebo
credential-free HTTPS URL; HTML, řídicí/bidi znaky a nebezpečná URL schémata
kontrakt odmítá.

Správa profilu rozlišuje `missing`, verzované `editable`, `read_only` a
`removed`; profil obsahuje volitelný E.164 telefon. PATCH vyžaduje
`expectedVersion` a stale zápis vrací striktní `STALE_VERSION` s aktuální
verzí. Privacy mutace dovoluje jen `data_deletion`; žádost o přístup nebo kopii
vede přes zveřejněný support kontakt, nikoli participant export job. Kanonická
odpověď výmazu je korelovaná s eventem a uživatelem a idempotency
collision/in-progress mají samostatné problem kódy. Profil i privacy stav jsou
P2 data: žádná P2 data v URL, browser persistence, offline mutace ani sdílená
cache.

Development fixtures nesou explicitní `dataMode: synthetic_preview` a právní
texty jsou označené jako neschválený syntetický draft. Produkční texty,
souhlasy a UAT zůstávají za `BLOCKER-LEGAL-01`. Produkční `/api/v1/me/*`
autorizace a zápisy implementuje `P4-13`; syntetický preview transport zůstává
oddělený a v produkčním buildu se nepoužívá.

## Personal agenda (`CS-AGENDA-01`)

`agenda.ts` defines the strict event/user-scoped boundary for the personal
agenda, reservations and waitlist offers. Registration estimates are not a v6
capacity mode and the parser rejects the historical branch.
Every response carries canonical `serverNow`, the IANA `eventTimezone`, agenda
and publication versions, and the complete ordered item list. Event-local days
are validated from the instant and timezone, including UTC-midnight
boundaries. Each item contains only a bounded session snapshot, its stable
non-PII calendar `UID`/`SEQUENCE`, the current participant-owned state,
canonical capacity and the server-selected action state. No identity of
another participant is accepted.

Agenda HTTP reads are `private, no-store`. `CS-OFFLINE-01` provides
owner/event-scoped IndexedDB snapshots and add/remove replay guarded by lease
and revocation epoch; the production feature remains disabled without a real
`lease-v1` preflight. Reservation, waitlist and estimate mutations are always
online-only and require a transport idempotency key. Mutation bodies are
discriminated by action and always carry `sessionId` plus `expectedVersion`.
Offer decisions additionally require the exact `offerId`; registration
estimates carry an explicit target boolean and are never implicit toggles.
Every success returns the complete new canonical snapshot instead of a locally
predicted seat.

Reservation capacity separates confirmed seats, all active holds and genuinely
remaining seats. `actorAvailability` distinguishes a public seat from a
specific participant offer, so a held seat cannot be rendered as generally
available. `timeConflict` correlates the requested target with ordered,
actually overlapping same-event sessions inside the successful canonical
mutation response; it is a non-blocking warning, never a `409`, and the target
remains saved or reserved. `STALE_VERSION`, `OFFER_EXPIRED`,
`CAPACITY_FULL`, `RESERVATION_CLOSED` and `TICKET_INACTIVE` carry the canonical
agenda version and target state needed for safe replacement. Active offer
countdowns are derived from `serverNow`, never from an uncorrelated client
clock. The calendar metadata exposes only the same-origin
`/api/v1/me/agenda.ics` endpoint; the production representation remains owned
by `P5-09`, while the `F3-05` synthetic adapter uses the same RFC 5545
UID/sequence, UTC, cancellation, escaping and folding invariants.

## Assigned activity roster (`CS-ROSTER-01`)

`activity-roster.ts` is the read-only, private boundary for a Vedoucí aktivity.
The response contains only server-assigned reservation-capacity sessions and,
for each active confirmed reservation or waiting FIFO entry, its opaque record
ID, `reserved | waitlisted` state, display name and optional company. E-mail,
phone, user and ticket identifiers, attendance evidence, mutation controls and
exports are outside the contract. Duplicate session/record IDs and a confirmed
count above capacity fail validation.

The integrated adapter owns both the list and assigned-session detail routes.
It derives event and operator scope from the server session, returns private
`no-store` representations and gives unassigned and unknown detail IDs the same
not-found outcome. The shared reservation/waitlist tables added with `P5-08`
are only the known read-model foundation from plan section 9.6; reservation
writes, capacity locking, cancellation and the single product-approved
promotion mode remain in `P5-01` through `P5-05`. Networking is not projected
until `BLOCKER-RES-01` is resolved.

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
service-worker caching. `CS-OFFLINE-01` now defines the owner lease, revocation
epoch and queue rules required before an offline read-state adapter could be
enabled; the current participant mutation remains online-only.

The same module also defines the Priority A admin draft, audience preview and
immutable send slice. Preview binds event, draft fingerprint, audience,
recipient count and expiry; send requires that exact preview version plus an
idempotency key and returns a correlated immutable result. Delivery providers,
advanced targeting and reporting remain server work in `P8-05`/`P8-06`.

## Ticket import (`CS-IMPORT-01`)

`ticket-import.ts` defines an online-only, vendor-neutral CSV/XLSX workflow.
The browser sends only bounded multipart source metadata and a file to a
server-side quarantine; raw files, previews and operational PII are forbidden
from browser persistence and shared/service-worker caches. Rows expose masked
contacts and one of `new`, `unchanged`, `status_changed`, `conflict` or
`unknown`, with totals validated against the complete preview.

Apply binds the exact event, preview ID/version and immutable SHA-256 digest,
requires a visible reason and transport idempotency key, and is rejected while
any conflict or unknown row remains. Success returns the correlated impact and
report reference; ambiguous transport outcomes may retry only the exact frozen
request.

## Operational support (`CS-SUPPORT-01`)

`support.ts` defines bounded POST-based search with at most five masked results
and explicit `no_match`, `single_match` and `ambiguous` outcomes. Queries,
names, contacts and reasons never belong in URLs, persistence or caches.
Reading operational participant data and mutating tickets are separate
permissions.

Resend, reassign, block, reactivate and transfer requests require the exact
participant/ticket pair, expected version, valid action-specific target,
reason and idempotency metadata. Canonical success correlates action, resulting
record/version and audit reference. Permission loss, logout or event switch
must synchronously discard all P3 state.

## Check-in (`CS-CHECKIN-01`)

`check-in.ts` is deliberately online-authoritative. Bootstrap binds event,
station, trusted device, role, permissions, server time and policy. Lookup can
use camera/manual opaque demo credentials or a selected privacy-safe search
result; it never performs a hidden check-in mutation. Outcomes cover valid,
duplicate, cancelled, refunded, blocked and unknown with only minimum masked
identity.

Confirm and undo are separate idempotent operations. Undo is bounded by the
canonical server-time window, permission and mandatory reason. Browser
persistence, an offline queue and the real credential format are outside this
contract.

## Admin operations (`CS-ADMIN-01`)

`admin.ts` defines the event-scoped context and exact permission set used by
the Priority A admin shell, plus operations overview, scoped role assignments,
async exports, reservation/attendance actions, audit browsing and minimal
event settings. All reads are `private, no-store`; P3 data and mutation drafts
are online-only.

Mutations carry expected versions, reasons where required and idempotency
metadata, and return a canonical correlated state plus audit/job reference.
Self-lockout, last-administrator removal, stale version, forbidden transition
and export availability are explicit problem branches. The UI role guard is
never a substitute for server authorization.

The `/admin/obsah` editor requires exact `program:manage` permission and uses
one typed port for days, venues, rooms, sessions, speakers, partners, practical
pages and FAQs. Production reads pass explicit fetch response schemas and
publication uses an immutable canonical preview; only development may inject
the stateful synthetic preview port. Days may be permanently deleted after an
explicit acknowledgement; the other seven resources use archive status.
Archived items remain visible but read-only in the admin list and are excluded
from publication snapshots, while an archived event makes the whole workspace
read-only.

## Offline ownership and replay (`CS-OFFLINE-01`)

`offline.ts` separates anonymous published snapshots from owner-bound personal
data. Public snapshots bind event ID, slug, publication version, expiry and a
strict `CS-CONTENT-01` payload. Personal agenda storage additionally binds
event, user, owner lease, revocation epoch and canonical agenda/publication
versions; authenticated responses are never eligible for the service-worker
public cache.

Only agenda `add` and `remove` may be queued. Every attempt uses one UUID as
record ID and idempotency key, has a bounded expiry/attempt count and requires
a fresh lease preflight immediately before replay. Conflict rebase creates a
new UUID; expired, failed and superseded records cannot be replayed. Feature
defaults leave personal cache and replay disabled until a real `lease-v1`
owner endpoint is integrated.

The service worker accepts only the build-generated complete shell manifest.
Every shell asset is SHA-256 verified during install, current-cache activation,
navigation fallback and rollback, so a missing or corrupted active asset fails
closed. In non-production the registration effect unregisters only the
same-origin `/sw.js` it owns and never removes MSW or another worker.
