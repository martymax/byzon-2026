# Dev/test API mocks

MSW intercepts the same native `fetch` used by `ApiPort`; there is no second
mock client. Enable browser mocks only for a local development compile:

```bash
NEXT_PUBLIC_BYZON_API_MOCKS=enabled corepack pnpm --filter @byzon/conference dev
```

The dev command builds `@byzon/domain` and `@byzon/test-support` first, so
Turbopack consumes their emitted ESM runtime exports while TypeScript continues
to use source declarations.

The dev command generates an ignored `public/mockServiceWorker.js` from the
exact pinned MSW package. Production build removes that generated file before
compilation and scans both production source and `.next` deployment artifacts
for MSW, test-support, the environment switch and the mock runtime marker.

Mock mode is fail-closed: an unhandled same-origin `/api/**` request, including
Better Auth, is aborted instead of falling through to a real endpoint. Next
RSC/document navigation and assets are not blocked. If worker startup fails,
browser API requests are blocked and a persistent accessible failure indicator
is shown.
When active, a text indicator reading “Mock data · pouze vývoj/test” is fixed
above the bottom safe area; state is never conveyed by color alone.

Feature owners add handlers next to their `CS-*` contract. Every success and
problem response must use `mockJsonResponse` or `mockProblemResponse`, pass an
explicit synthetic fixture name, and validate the fixture against the same Zod
schema used by the production client. Do not copy production data or invent a
feature DTO in this foundation.

The first stateful journey starts at `/aktivace`: its landing handler uses the
validated anonymous `CS-ACT-01` fixture. Mutating claim, identity and recovery
handlers are added by their owning F1 steps; an unimplemented step therefore
fails closed instead of calling a real auth or ticket endpoint.

The application already has an offline service worker. Browser mock bootstrap
runs before hydration and temporarily owns the root scope. The normal
registration code does not replace an unknown active worker; disabling mock
mode unregisters the generated MSW worker and lets `/sw.js` take ownership
again.
