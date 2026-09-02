# AUX-13G — produkční integrace oznámení

> Datum: 2026-09-02  
> Lokální stav: target → preview → send řez je zapojený; staging session/context
> evidence zůstává společným gate `AUX-13A`.

## Integrovaný řez

- Nový privátní `GET /api/v1/admin/events/:eventId/announcements/targets`
  vrací nejvýše 200 pojmenovaných draft/published sessions se začátkem a
  volitelnou místností. Dotaz filtruje event na serveru a řadí deterministicky
  podle času a ID.
- Endpoint před DB seznamem ověřuje session, event-scoped
  `announcement:send` a `announcementsEnabled`; odpověď je `private,
no-store`, `Vary: Authorization, Cookie` a prochází strict target schématem.
- Produkční workspace načítá options přes safe-read port. Loading, retry a
  non-security chyba nepředstírají session publikum; 401/403/offline security
  failure vymaže draft i targety a invaliduje celý admin shell scope.
- Operátor vybírá pouze event nebo právě jednu pojmenovanou session. Interní
  ID se v UI nezobrazuje ani ručně nezadává.
- Immutable preview dál počítá skutečný event/session audience snapshot.
  Odeslání používá povinný reason a idempotency key a UI zobrazuje pouze
  kanonické `sent` nebo `already_sent`, nikdy odhad doručení.

## Ověření

- Server unit test ověřuje target DTO, privátní cache hlavičky, negativní roli
  a vypnutý feature flag.
- API test ověřuje GET/safe-read/no-store policy a event correlation.
- Browser component sada načítá options produkčním portem, vybere pojmenovanou
  session bez raw ID, ověřuje event/session preview, zero audience, stale
  invalidaci, exact retry, `already_sent` bez tvrzení o doručení a bezpečný wipe
  při ztrátě session.
- Development MSW používá stejný target kontrakt a endpoint; produkční build
  dál prochází mock-boundary scanem.

## Otevřený gate

Lokální Docker daemon není dostupný, proto nebyla spuštěna skutečná
PostgreSQL/staging session cesta. `AUX-13G` zůstává `[~]` do staging E2E
společného `AUX-13A`; kód neobsahuje globální odemčení ostatních rout.
