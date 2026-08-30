# Threat model: zdrojový ticket kód a prezentační credential

Stav: schválený směr, implementační test vectors čekají na `TKT-04` a
`P4-12`. Online ticket databáze zůstává autoritou.

## Oddělené credentialy

SimpleShop source ticket code a QR zobrazovaný v aplikaci nejsou stejná věc.

- Source kód přichází pouze serverovým SimpleShop adapterem nebo zabezpečeným
  claim/check-in vstupem. Je opaque, bez normalizace, a v databázi se porovnává
  přes environment-keyed HMAC s verzí pepperu.
- Aplikace později zobrazí vlastní krátkodobý, rotující credential. QR nesmí
  obsahovat source kód, jeho HMAC, suffix, e-mail ani stabilní osobní údaj.

## Prezentační credential

`P4-12` použije podepsaný credential s verzí a `kid`. Payload obsahuje pouze
audience check-inu, event ID, náhodné jednorázové `jti`, `iat`, `nbf` a `exp`;
neobsahuje ticket ID ani PII. `jti` má serverovou, krátce žijící vazbu na
ticket. Platnost je nejvýše pět minut, klient credential obnovuje a scanner jej
vždy posílá online autoritě. Aktivní a předchozí ověřovací klíč umožní
kontrolovanou rotaci; privátní klíč zůstává pouze v serverovém secretu.

Přesná serializace, algoritmus/knihovna, délka klíče a golden test vectors se
uzavřou před implementací, ne až během UAT.

## Hrozby a kontroly

| Hrozba                                 | Kontrola                                                                      | Selhání                                      |
| -------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| Únik SimpleShop API klíče              | server-only secret, redakce Authorization, allowlist hostu, oddělený účet     | okamžitá rotace klíče, sync fail-closed      |
| Podvržená/změněná API odpověď          | HTTPS, striktní schema, bounded pagination, preview + explicit apply          | batch se neaplikuje                          |
| Neznámý status nebo částečný refund    | výslovná status mapa, unknown = conflict                                      | žádná automatická aktivace/storno            |
| Offline hádání source kódů po úniku DB | HMAC s rotovatelným pepperem, raw kód se neukládá                             | pepper rotation a revize auditů              |
| Online enumerace claimu                | generické odpovědi, rate limit per actor/IP/fingerprint, transakční lock      | dočasný cooldown bez prozrazení existence    |
| Dvojitý claim nebo souběžné storno     | unikátní constraint, row/advisory lock, stavový automat a idempotence         | jedna kanonická transakce vyhraje            |
| Screenshot/replay app QR               | krátké `exp`, rotující `jti`, server kontroluje aktuální ticket/check-in stav | duplicate outcome, žádný druhý check-in      |
| Únik podpisového klíče                 | versioned `kid`, oddělené secrets, překryv active/previous, audit rotace      | revokace `kid`, nové credentialy fail-closed |
| Cross-event použití                    | podepsané event ID + serverová audience/event kontrola                        | generická neplatná vstupenka                 |

## Zakázané zkratky

- negenerovat QR z HMAC nebo suffixu source kódu;
- nelogovat source kód, Basic Authorization ani celý prezentační credential;
- nepoužívat trim, case folding nebo Unicode normalizaci bez nového ADR a
  reálných test vectors;
- nepovolit offline manifest před samostatnou bezpečnostní akceptací;
- nepřevést neznámý vendor status na aktivní nebo zrušený ticket.
