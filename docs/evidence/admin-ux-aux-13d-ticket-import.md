# AUX-13D — produkční SimpleShop participant apply

> Datum: 2026-09-02  
> Lokální stav: preview → apply → report je zapojený; staging auth/context
> evidence zůstává společným gate `AUX-13A`.

## Integrovaný řez

- Nový privátní
  `POST /api/v1/admin/events/:eventId/ticket-imports/apply` vyžaduje exact
  Origin, aktivní session, current event, `ticket:any:manage`, reason a
  idempotency key. Request váže event, preview ID/verzi a přesný očekávaný
  dopad.
- Apply pod transakčními advisory locky znovu ověří event, permission, retenci,
  stav/TTL batch a všechny sanitizované preview řádky. SimpleShop zdroj znovu
  načte bounded server-only adapterem a jeho normalizovaný apply snapshot musí
  odpovídat immutable otisku preview.
- Pouze uhrazené řádky s jednoznačným účastnickým e-mailem mohou vytvořit nebo
  znovu použít identitu, aktivní event membership a participant roli. Oddělená
  `ticket_source_participants` reference drží externí ticket/order ID bez
  ticket credentialu.
- Neuhrazený/stornovaný/refundovaný nový účastník zůstává vyloučený. Unknown,
  nejednoznačná identita, pozdější downgrade již importovaného účastníka,
  změněný či expirovaný snapshot a neaktivní existující membership failují
  před zápisem nebo rollbacknou celou transakci.
- Apply nevytváří řádek `tickets`, raw kód/HMAC/suffix, invitation ani e-mail.
  Preview persistence neobsahuje jméno, e-mail, telefon, firmu, kupón ani raw
  credential. Audit ukládá reason, agregovaný dopad a explicitní příznaky
  `emailSent=false` a `ticketCredentialCreated=false`, nikoli PII.
- Exact retry se stejným klíčem vrací původní receipt jako `already_applied`.
  UI SimpleShopu nyní zpřístupní lidské potvrzení i kanonický report; konflikt
  a unknown potvrzovací krok vůbec nevykreslí.

## Ověření

- Conference unit sada: 597 testů prošlo; 119 service-backed testů bylo bez
  lokální PostgreSQL/Redis infrastruktury přeskočeno.
- Domain kontrakty: 195/195. Database: 76 prošlo, 21 service-backed testů bylo
  přeskočeno.
- Admin browser component soubor: 64 scénářů ve třech viewports, tedy 192/192;
  SimpleShop cesta ověřuje sanitized preview, přesný request, reason,
  idempotency metadata, potvrzení a report.
- PostgreSQL integrační test připravený pro CI ověřuje atomický vznik dvou
  identit/membershipů/source referencí, nula ticket credentialů a e-mailů,
  audit bez PII, exact replay, druhý unchanged preview, permission denial,
  expiraci a změnu zdroje po preview.
- Formát, lint, workspace typecheck a produkční Next build jsou zelené;
  source i build mock-boundary scan prošel a route je v produkčním grafu.

## Otevřený gate

Lokální Docker daemon není dostupný, proto je PostgreSQL apply test v lokálním
běhu přeskočený. `AUX-13D` zůstává `[~]` do staging auth/context E2E společného
`AUX-13A`; invitation delivery zůstává samostatným `P4-06`.
