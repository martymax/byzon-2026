# ADR-015: SimpleShop API synchronizace na vyžádání

- Stav: Přijato
- Datum: 30. 8. 2026
- Rozhodnutí: produkt + technické vedení
- Dotčené části: `P0-02`, `P4-02`, `P4-03`, `BLOCKER-TKT-01` až `04`

## Kontext

SimpleShop nabízí serverové API. Oficiální návod uvádí HTTP Basic
Authentication, kde uživatelské jméno tvoří přihlašovací e-mail a heslo API
klíč z nastavení integrací. Stávající administrace už má vendor-neutral staging,
validaci, diff a explicitní apply. Není proto důvod přenášet stejné údaje přes
ručně vytvářené CSV/XLSX exporty.

Read-only discovery bylo 30. 8. 2026 provedeno nad aktuálním stagingem pouze
pomocí `GET`, proti oficiálnímu OpenAPI a skutečným odpovědím pro BYZON produkt
`143958` / form key `0MnNQ`. Nebyl proveden žádný zápis ani apply.

## Rozhodnutí

1. `SimpleShopTicketSourceAdapter` bude volaný výhradně na serveru proti
   allowlistovanému HTTPS základu `https://api.simpleshop.cz/2.0/`.
2. Přístup se předá pouze přes secrets `SIMPLESHOP_API_EMAIL` a
   `SIMPLESHOP_API_KEY`. Volitelný `SIMPLESHOP_API_BASE_URL` je povolen jen v
   testu; produkce odmítne jiný host. Klíč ani Basic Authorization se nesmí
   dostat do prohlížeče, auditu, reportu nebo logu.
3. Synchronizaci spouští oprávněný organizátor na vyžádání. Verze 2026 nemá
   plánovaný polling ani webhook. Síťové čtení samo nikdy nemění produkční
   ticket.
4. `P4-02` načte jedinou dokumentovanou exportní odpověď, uloží sanitizovaný
   staging batch, validuje schéma a připraví diff `new / unchanged / conflict /
   unknown`. SimpleShop preview nemá apply cestu. Budoucí `P4-03` smí přidat
   samostatný idempotentní apply až po schválení otevřených stavových mapování.
5. Neznámý status, chybějící stabilní externí ID, nejednoznačný počet kusů,
   duplicitní kód nebo překročený limit zastaví celý batch. Neznámá hodnota
   nikdy automaticky neaktivuje ani nestornuje vstupenku.
6. Adapter používá krátký deadline pro celý request včetně streamovaného těla,
   bounded response a počet záznamů, exponenciální backoff jen pro bezpečné
   GET požadavky a audit bez PII. Částečná nebo syntakticky chybná odpověď se
   neaplikuje.
7. Zdrojový ticket kód je přesný opaque řetězec v přijatém UTF-8 JSON. Před
   HMAC se netrimuje, nemění se velikost písmen ani Unicode reprezentace.
   Raw hodnota se po staging/apply neukládá do běžné ticket tabulky ani logu.

## Ověřený API kontrakt

- Produkt se čte přes
  `GET /2.0/product/143958/`. Skutečná odpověď vrací `id` a `type` jako
  číselné řetězce, ačkoli OpenAPI je uvádí jako integer. Produkt je ticket typu
  `9`, není archivovaný ani testovací a form key `0MnNQ` je shodně přítomný v
  `code` a `script_iframe`.
- Export se čte přes
  `GET /2.0/export/who-bought/product/143958/?strict=1`. Response envelope je
  přesně JSON objekt `{ "csv": string }`; řetězec je UTF-8 CSV oddělené
  středníkem a má 35 sloupců.
- OpenAPI ani skutečná odpověď nenabízejí `page`, `limit`, cursor nebo `next`.
  Adapter proto provádí právě jednu bounded odpověď (`pageCount=1`) a případná
  dodatečná pagination metadata odmítne. `strict=1` a `strict=0` daly v
  aktuálním datasetu shodný výsledek; nejde o obecný příslib ekvivalence.
- Stabilní ID jedné vstupenky je `ID vstupenky`; `ID dokladu` je ID objednávky
  a opakuje se mezi jejími položkami. Aktuálně bylo 53 objednávek a 67
  unikátních ticket ID.
- Export měl 137 datových řádků: 67 ticket řádků s párem `ID vstupenky` /
  `Kód vstupenky` a 70 souhrnných řádků bez obou ticket polí. Všechny ticket
  řádky měly `Počet=1`; čtyři souhrnné řádky měly `Počet=2`. Více kusů je tedy
  aktuálně rozbaleno do samostatných ticket řádků a souhrnná quantity se
  nesmí násobit podruhé.
- Mezi ticket řádky bylo 63 `Uhrazeno`, 3 `Neuhrazeno` a 1 `STORNO`. Refund
  nebyl přítomen. V celém exportu včetně souhrnných řádků bylo 129 / 6 / 2.
  Mapování používá pole `Stav`; samostatný refund flag nebyl v odpovědi
  pozorován. Produktové flags `archived` a `test_mode` byly oba `false`.
- Voucher pole v exportu není. Ticket kód je přítomný pouze v poli
  `Kód vstupenky`; 67 hodnot bylo unikátních, vždy 6 UTF-8 bytů a pouze
  číslice / velká ASCII písmena. Raw hodnoty nebyly vypsány ani uloženy.
- Export obsahuje jak kontakt kupujícího (`E-mail`, `Telefon`, odběratelské
  údaje), tak samostatná pole „prodej na jméno“: jméno, příjmení, e-mail,
  firma, pozice a telefon konkrétního účastníka. Přítomnost obou sad je
  ověřená z hlavičky bez výpisu osobních hodnot; jejich priorita a fallback
  pro skupinový nákup zůstávají produktovým rozhodnutím před apply.

## Mapování pro `P4-02`

- `Uhrazeno` je jediný stav mapovaný na kandidátní `active` v preview.
- `Neuhrazeno`, `STORNO`, každý nový stav a nepozorovaný refund zůstávají
  `unknown` / `unapproved`; preview je nesmí aplikovat.
- Souhrnné řádky bez ticket ID i kódu se pouze agregují a ignorují jako
  kandidátní tickety. Neúplný pár, ticket quantity jiná než 1, duplicita,
  neplatné ID nebo neznámá struktura zastaví celé preview.
- Kód se pouze validuje v paměti kvůli páru a duplicitě a poté se zahodí.
  `P4-02` neukládá raw kód, vratný otisk ani HMAC; rozhodnutí o normalizaci,
  entropii a HMAC zůstává v `BLOCKER-TKT-04`.

## Provozní tok

1. Organizátor zvolí „Načíst ze SimpleShopu“.
2. Server provede read-only discovery/fetch a vrátí sanitizované preview.
3. Administrace zobrazí sanitizované počty, konflikty a význam každého
   zdrojového statusu. Tím tok `P4-02` končí bez apply a bez změny ticketů.
4. Případný budoucí apply je samostatný rozsah `P4-03` a nesmí být zpřístupněn,
   dokud nejsou schválena mapování pending/storno/refund a práce s kódem.

## Otevřené integrační vstupy

- potvrzené mapování zdrojových statusů na kanonické ticket stavy;
- reprezentativní refund v read-only datech a produktové rozhodnutí, zda a jak
  se pending, storno a refund smějí promítnout při `P4-03`;
- schválená identita účastníka: priorita e-mailu „prodej na jméno“ a bezpečný
  fallback na e-mail kupujícího u objednávky s jedním nebo více účastníky;
- bezpečnostní rozhodnutí o entropii, přesné normalizaci a HMAC ticket kódu bez
  uložení raw test vectors do repozitáře nebo chatu.

## Důsledky

- `BLOCKER-TKT-03` je uzavřen: synchronizace je ruční, na vyžádání, ve dvou
  krocích preview/apply.
- `BLOCKER-TKT-01` je uzavřen ověřeným endpoint/envelope/ID/quantity mappingem.
- `BLOCKER-TKT-02` a `TKT-04` zůstávají otevřené pro apply a claim; neblokují
  adminem spouštěné read-only preview.
- Historické CSV/XLSX fixtures mohou zůstat pro testy kanonického stagingu,
  ale SimpleShop administrace nebude nabízet file upload ani paralelní
  produkční sync kanál.

## Zdroje

- [Oficiální návod SimpleShop API](https://podpora.redbit.cz/navod/api-ve-vyfakturuj-cz-a-simpleshopu/)
- [Oficiální návod k exportu Kdo koupil](https://podpora.redbit.cz/navod/export-objednavek-kdo-koupil/)
- [Oficiální interaktivní dokumentace SimpleShop API](https://api.simpleshop.cz/scalar/)
- [Oficiální OpenAPI dokument](https://api.simpleshop.cz/webroot/openapi/simpleshop.json)
