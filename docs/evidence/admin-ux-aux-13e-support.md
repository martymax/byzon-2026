# AUX-13E — produkční účastnický support

Stav: bezpečný lokální legacy-ticket řez hotový; finální `[x]` čeká na
invitation/recovery handshake importovaných identit `P4-06`–`P4-09`,
`BLOCKER-AUTH-01` a společný staging gate `AUX-13A`.

## Implementace a invarianty

- Vyhledávání používá pouze same-origin POST body, nikdy query string;
  odpověď je private/no-store, kontakt je pro autorizovaného administrátora
  zobrazen celý a server vrací nejvýše pět
  různých osob i tehdy, když jedna osoba vlastní více legacy vstupenek.
- Search před SQL ověří session, current-event slug a
  `participant:operational:read`; block/reactivate odděleně vyžaduje
  `ticket:any:manage`.
- Redis limity jsou oddělené na 30 search a 10 mutation požadavků za minutu.
  Bucket obsahuje jen HMAC eventu a user ID, nikoli raw identifikátor ani PII;
  vyčerpání vrací kontraktní `SUPPORT_RATE_LIMITED` a store failure failuje
  zavřeně.
- Legacy block/reactivate zachovává reason, version lock, transakční rezervace
  a waitlist dopad, audit a exact idempotency replay. Replay nyní kanonicky
  vrací `already_applied` a nevytváří druhý audit.
- Neodsouhlasené `reassign`/`transfer` server odmítá a UI je nezobrazuje.

## Ověření

- conference TypeScript a lint prošly; server/unit sada 609 PASS;
- rate-limit regrese kryje HMAC bucket, oba limity, kontraktní 429 a fail-closed
  Redis chybu;
- PostgreSQL regrese připravená pro CI kryje PII mimo URL/response, deduplikaci
  osoby, origin, current-event, permission, block, audit a exact replay;
- existující browser matice kryje no/single/ambiguous search, read-only režim,
  block/reactivate, stale, exact retry, permission/session wipe a axe ve třech
  viewports.

## Zbývající autoritativní dependency

SimpleShop apply podle scope 2026 vytváří identitu, membership, participant
roli a source reference, ale záměrně nevytváří ticket credential ani neposílá
e-mail. Proto dnešní legacy ticket lookup nesmí být vydáván za podporu všech
importovaných účastníků. Resend/revoke invitation a oprava importované identity
vyžaduje dokončit invitation batch, recovery význam a handshake v
`P4-06`–`P4-09`; ticket transfer/storno workflow se podle hlavního plánu
nevytváří.
