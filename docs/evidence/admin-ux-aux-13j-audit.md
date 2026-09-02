# AUX-13J — produkční integrace historie změn

> Datum: 2026-09-02  
> Lokální stav: produkční query/cursor/redaction řez je zapojený; staging
> auth/context evidence zůstává společným gate `AUX-13A`.

## Integrovaný řez

- `GET /api/v1/admin/events/:eventId/audit` ověřuje aktivní session,
  event-scoped `audit:read` a vrací privátní `no-store` odpověď.
- Event, kategorie, přesná akce, request ID, časové rozmezí a keyset cursor se
  aplikují přímo v databázovém dotazu. Kategorie už není filtrována až nad
  prvních 500 načtenými záznamy.
- Stabilní řazení `createdAt DESC, id DESC` a načtení `limit + 1` vytvářejí
  přesné `hasMore` a další opaque cursor bez předstírání úplné historie.
- Select nečte auditní `before`, celé `after`, actor ID ani request ID; z JSON
  vybírá pouze případnou výslednou verzi. Response používá obecný actor label,
  lidský důvod z auditního redaction writeru, bezpečný cíl a vždy přiznává
  `redacted=true`.
- Klient při další stránce zachovává stejný category/action/time/request filtr,
  koreluje event a při 401/403 invaliduje celý admin shell security scope.

## Ověření

- Unit server test ověřuje `limit + 1`, minimální projekci, privátní hlavičky,
  redigované DTO, obecné actor labely a odmítnutí neplatného cursoru.
- PostgreSQL integrační test připravený pro CI ověřuje category filtr před
  stránkováním, druhou cursor stránku, cross-event izolaci a absenci
  `before`/secret dat v odpovědi.
- Browser component scénář ověřuje předání stejných filtrů do další stránky,
  lidské action labely místo raw kódu, redaction text a axe kontrolu ve třech
  viewportech.
- Produkční build prošel source i build mock-boundary kontrolou.

## Otevřený gate

Lokální Docker daemon není dostupný, proto je PostgreSQL integrační test v
lokálním běhu přeskočen. `AUX-13J` zůstává `[~]` do staging auth/context E2E
společného `AUX-13A`; actor/outcome filtry a úplný action registry zůstávají
samostatným rozšířením `GAP-AUX-AUDIT-01` a UI je nepředstírá.
