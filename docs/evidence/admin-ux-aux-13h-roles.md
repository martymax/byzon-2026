# AUX-13H — produkční tým a oprávnění

Stav: lokální integrační řez hotový; finální `[x]` čeká na společný staging
auth/context gate `AUX-13A`. Konkrétní ostré personální přiřazení není technický
default a dál jej vlastní `BLOCKER-OPS-01`.

## Implementace

- `GET .../role-assignments` vrací nejvýše 100 aktivních provozních rolí,
  opaque keyset cursor, globální assignments version a pojmenovaný serverově
  ověřený station/session scope.
- `POST .../role-assignments/search` drží jméno či e-mail mimo URL, přijímá jen
  same-origin no-store body a vrací nejvýše 20 aktivních ověřených členů s
  maskovaným kontaktem.
- `POST .../role-assignments/scope-options` nabízí stanice pouze check-in roli,
  otázkové session moderátorovi a kapacitní session Vedoucímu aktivity.
  Moderator ani `room_operator` nedostanou globální scope.
- Produkční workspace používá typed porty pro všechny tři reads, při 401/403
  invaliduje celý admin scope a už nezobrazuje „nepřipojeno“ fallback.
- Grant/revoke navíc ověřuje current-event slug. Grant je povolen v D/A/L,
  revoke také v E a archiv je read-only; existující exact retry, version lock a
  audit zůstaly zachované.

## Ověření

- domain kontrakty: 195/195 PASS;
- conference server/unit: 603 PASS, 124 databázových testů bez
  `TEST_DATABASE_URL` očekávaně přeskočeno;
- browser component gate: 69 souborů, 1050/1050 scénářů v phone/tablet/desktop
  Chromium, včetně produkčního read portu, axe, guard chyb, stale reloadu,
  exact retry a security wipe;
- PostgreSQL integrační test připravený pro CI pokrývá named list, maskovaný
  POST search, všechny tři role-compatible options, chybějící permission a
  nepovolený session scope.
