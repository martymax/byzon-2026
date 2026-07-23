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
