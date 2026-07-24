# Browser component tests

Run `corepack pnpm test:components` to render `.component.tsx` files in
real headless Chromium at the three approved target viewports.

Import `renderComponent`, `page` and `userEvent` from `./render`. Prefer
accessible role/label queries and actual browser interactions. Feature tests
must cover their relevant role/phase subset from `@byzon/test-support`, plus
loading, empty, recoverable error, permission, offline/stale, pending, success
and session-expired states required by the route UX profile.

The browser component harness complements, but does not replace, page-level axe,
keyboard, responsive overflow, safe-area, reduced-motion and assistive
technology checks. It must use synthetic fixtures and the shared MSW/API port;
never import database, server-only code or production records.
