# AUX-13K — produkční core nastavení

Stav: lokální integrační řez hotový; finální `[x]` čeká na společný staging
auth/context gate `AUX-13A`. Umístění a label `supportMessage` zůstávají
produktovým gapem a nejsou tímto řezem předstírané.

## Implementace a invarianty

- Produkční workspace používá typed private/no-store GET a idempotentní PUT;
  při 401/403 invaliduje celý admin scope, stale refresh zachová jen lokální
  schválený core draft a security failure jej smaže.
- Server před permission kontrolou sváže event ID s current-event slugem.
- Archivovaný event dovolí read, ale update odmítne uvnitř idempotentní operace,
  takže přesný již uložený retry stále vrací původní receipt.
- Aktualizovat lze jen `registrationMode` a `reservationChangesAllowed`.
  `supportMessage` musí přesně odpovídat uložené hodnotě, jinak request failne;
  pole se nezobrazuje v UI ani nekopíruje do auditního before/after diffu.
- Version lock, transakční event lock, reason, audit a exact retry zůstávají
  zachované.

## Ověření

- conference TypeScript, server/unit sada 604 PASS; 127 DB testů je bez
  `TEST_DATABASE_URL` očekávaně přeskočeno;
- existující browser regrese kryjí read→edit focus, dirty guard, immutable
  exact retry, stale refresh + session wipe a archiv bez edit controls;
- nová PostgreSQL regrese připravená pro CI kryje default read/no-store,
  update + jediný audit, exact replay, support tampering, stale version,
  archived write/read a chybějící permission.
