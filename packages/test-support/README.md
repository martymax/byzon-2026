# BYZON test support

`@byzon/test-support` is a dev/test-only package for deterministic synthetic
fixtures. Production applications must never declare it as a runtime
dependency.

Fixture/harness runtime exports point to `dist` so Next development mocks
consume valid ESM; the conference `dev`, unit and component scripts build this
package first. TypeScript types and the standalone viewport registry continue
to resolve from `src`, so Playwright can load its config on a clean checkout.

## Fixture workflow

1. Import the completed runtime schema from `@byzon/domain/contracts`.
2. Define a stable synthetic base with `defineFixtureFactory`, or a small named
   scenario collection with `defineFixtureSet`.
3. Export only values that have passed the runtime schema. Do not cast a raw
   object to a response type.
4. Keep each feature fixture in the file owned by its `CS-*` slice. `F0-03`
   supplies only the harness, common problem fixtures and role/event-phase test
   axes.

Factories validate defaults immediately and every variant when it is created.
Validated values are cloned and deeply frozen so tests cannot leak mutations
into one another. Validation errors contain only the fixture name, issue code
and schema path; raw payloads are deliberately omitted.

Fixtures must contain only JSON-safe synthetic values. Never copy production
records, real e-mail addresses, ticket codes, provider exports or secrets.
Avoid `Date.now()`, randomness and environment-dependent defaults. Loading,
offline and timeout are transport/UI scenarios and must not be represented by
invented success DTO fields.

`fixtureEventRoles`, `fixtureEventPhases` and `fixtureContextMatrix` provide
explicit test axes. The phase list mirrors the approved plan but is not a
replacement for a capability's server response contract.

`selectFixtureContexts` creates a frozen deterministic subset for a component
test matrix and `fixtureContextName` supplies a stable test label. Shared
`targetViewports` from `@byzon/test-support/viewports` are the only approved
visual/component/E2E smoke sizes: phone `375 × 667`, tablet `768 × 1024` and
desktop `1280 × 800`.

`fixtures/content.ts` contains the synthetic `CS-CONTENT-01` program,
directory, long-Czech-content, empty and supported problem scenarios. Every
HTTP fixture is parsed and deeply frozen by the same production response or
problem schema before export. Loading and offline are transport/UI states and
are exercised with the typed API port rather than represented as invented JSON
payloads.

`fixtures/ticket.ts` contains only synthetic participant status, a synthetic
holder name and a four-character masked-reference suffix. Its presentation is
always unavailable; fixtures contain no QR payload, barcode, source ticket
code or presentation value before `BLOCKER-TKT-05`.
