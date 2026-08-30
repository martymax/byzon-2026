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
4. První krok načte omezené stránky API, uloží sanitizovaný staging batch,
   validuje schéma a připraví diff `new / unchanged / status_changed /
   conflict`. Druhý, samostatný krok vyžaduje důvod, čerstvou verzi preview a
   idempotency key a teprve potom transakčně aplikuje změny.
5. Neznámý status, chybějící stabilní externí ID, nejednoznačný počet kusů,
   duplicitní kód nebo překročený limit zastaví celý batch. Neznámá hodnota
   nikdy automaticky neaktivuje ani nestornuje vstupenku.
6. Adapter používá krátký timeout, bounded pagination a počet záznamů,
   exponenciální backoff jen pro bezpečné GET požadavky a audit bez PII.
   Částečná nebo syntakticky chybná odpověď se neaplikuje.
7. Zdrojový ticket kód je přesný opaque řetězec v přijatém UTF-8 JSON. Před
   HMAC se netrimuje, nemění se velikost písmen ani Unicode reprezentace.
   Raw hodnota se po staging/apply neukládá do běžné ticket tabulky ani logu.

## Provozní tok

1. Organizátor zvolí „Načíst ze SimpleShopu“.
2. Server provede read-only discovery/fetch a vrátí sanitizované preview.
3. Administrace zobrazí počty, konflikty a význam každého zdrojového statusu.
4. Organizátor zadá auditní důvod a explicitně potvrdí apply.
5. Server ověří nezměněné preview, provede idempotentní transakci a zapíše
   outbox/audit.

## Chybějící integrační vstupy

- vyhrazený SimpleShop login/e-mail a API klíč vložené přímo do secrets;
- ID produktů/prodejních formulářů, které patří BYZON 2026;
- jedna reprezentativní sada objednávek/vstupenek: zaplaceno, čeká na platbu,
  storno, refund a více kusů;
- potvrzené mapování zdrojových statusů na kanonické ticket stavy;
- reálné příklady ticket kódu pro ověření formátu a entropie bez jejich
  ukládání do repozitáře nebo chatu.

Po instalaci secrets lze první discovery provést read-only a z API odpovědí
doplnit přesné endpointy, pagination a field mapping bez domýšlení.

## Důsledky

- `BLOCKER-TKT-03` je uzavřen: synchronizace je ruční, na vyžádání, ve dvou
  krocích preview/apply.
- `BLOCKER-TKT-01`, `TKT-02` a `TKT-04` zůstávají otevřené do read-only
  discovery, schválení status mapy a bezpečnostních test vectors.
- Historické CSV/XLSX fixtures mohou zůstat pro testy kanonického stagingu,
  ale SimpleShop administrace nebude nabízet file upload ani paralelní
  produkční sync kanál.

## Zdroje

- [Oficiální návod SimpleShop API](https://podpora.redbit.cz/navod/api-ve-vyfakturuj-cz-a-simpleshopu/)
- [Oficiální interaktivní dokumentace SimpleShop API](https://api.simpleshop.cz/scalar/)
