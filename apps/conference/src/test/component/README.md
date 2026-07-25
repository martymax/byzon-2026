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

Feature-level axe checks use `expectComponentToPassAxe`. Its failure summary
contains only rule metadata and node counts, never DOM snippets or participant
copy. `axe-core` remains a conference dev dependency and both architecture and
production source/build guards reject it outside the component harness.
Targeted visual baselines are split by approved viewport and use only validated
synthetic fixtures. Keep the set deliberately small: add one only when it
protects a capability-level shell or a layout that geometry assertions cannot
cover.

`F2-06` currently covers the implemented participant shell/program slice.
Ticket, inbox and account/privacy baselines remain owned by the same task after
`F2-04`, `F2-05` and `F2-07` create those interfaces.
