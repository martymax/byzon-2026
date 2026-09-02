# AUX-13B — produkční dashboard `/admin`

Stav: lokální integrační řez hotový; finální `[x]` čeká pouze na společný
staging auth/context gate `AUX-13A`.

## Implementace

- Produkční `/admin` renderuje `AdminOverviewWorkspace`; původní seznam odkazů
  a preview podmínka byly odstraněny.
- `GET /api/v1/admin/events/{eventId}/operations` ověřuje relaci,
  `operations:read`, přesný current-event slug a odmítá veškeré query parametry.
- Aktivace počítá unikátní uživatele vytvořené potvrzeným SimpleShop apply a
  jejich ověřený e-mailový přístup; nepoužívá dormant ticket credential tabulku.
- Importní stav je lokalizovaný. Publikace rozlišuje `synced`, čekání a
  `sync_failed`. Rezervace agregují každou aktivitu zvlášť a odlišují plnou od
  překročené kapacity. Oznámení uvádí skutečný počet uložených kritických
  oznámení nebo vypnutý feature stav.
- Outbox je samostatný technický souhrn `ready/processing/failed`; response
  neobsahuje payload, `lastError`, actor ani participant PII.
- Activation/import/notification bez řešitelného serverového targetu nemají
  CTA. Content, check-in a reservation CTA jsou permission/capability gated;
  archiv odstraňuje mutační odkazy.

## Ověření

- conference TypeScript a ESLint: PASS;
- conference unit/server sada: 603 prošlo, 119 databázových testů lokálně
  přeskočeno bez `TEST_DATABASE_URL`;
- browser component gate: 69 souborů, 1047/1047 scénářů v phone/tablet/desktop
  Chromium, včetně axe, responsive a negativních permission stavů;
- PostgreSQL integrační test endpointu pokrývá šest agregátů, no-store/PII a
  odmítnutí aktéra bez `operations:read`; v lokálním bezdatabázovém běhu je
  připravený pro CI.

## Zbývající externí gate

Staging Better Auth/current-event context E2E je sdílená závislost
`AUX-13A`; lokální implementace ji nepředstírá.
