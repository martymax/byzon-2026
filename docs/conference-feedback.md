# Hodnocení konference

Veřejné týmové demo: `https://app.byzon.cz/hodnoceni/demo`.
Administrace: `/admin/hodnoceni` (Výsledky a Rozesílání).

Demo ukazuje stejnou e-mailovou šablonu a dotazník jako skutečný průchod.
Odpovědi ukládá pouze do prohlížeče, nikdy nevolá API pro skutečné hodnocení.
Lze vyzkoušet účastníka, speakera, moderátora i partnera a ukázku resetovat.

## Účastník

Osobní opakovatelný odkaz `/hodnoceni/<token>` nepotřebuje přihlášení.
Token je doménově oddělené HMAC s náhodným ID odpovědi; databáze uchovává
jen SHA-256 tokenu. Token nevytváří autentizační relaci a neumožňuje přístup
k účastnickým ani administračním API. Stránka používá `no-store`, `no-referrer`
a `noindex`. Odkaz je osobní; hodnocení není prezentováno jako anonymní.

Výběr odpovědi se ukládá ihned, text po krátkém zpoždění a při opuštění pole.
PATCH slučuje jen změněná pole pod databázovým zámkem. Současné úpravy různých
otázek z více zařízení se navzájem nemažou. Stav ukládání je viditelný,
neodeslané změny mají místní zálohu a opakování po obnovení spojení.
Server ukládá také aktuální krok. Dokončené hodnocení lze znovu otevřít a upravit.
Při obnově staršího lokálního konceptu se ověřuje verze na serveru. Pokud mezitím
někdo změnil hodnocení na jiném zařízení, účastník si zvolí, zda pokračovat
se serverovými odpověďmi, nebo použít neodeslané změny z tohoto prohlížeče.

Role se potvrdí v prvním kroku. Nápověda vychází z existujících rolí a vazby
firmy na partnera; potvrzená odpověď má přednost. Role hodnocení nemění oprávnění
účtu. Společné otázky doplňuje spolupráce a konkrétní otázky pro každou roli.
Větvení skrývá nerelevantní zkušenosti. Demografické otázky jsou dobrovolně
rozbalitelné na konci. Změna role vyloučí neaktuální větev z reportu.

## Rozesílání a výsledky

Organizátor vybere pozvánku nebo připomenutí, filtr a konkrétní příjemce.
Před zařazením do fronty vidí počet a kontrolu výběru. Samotné nasazení
žádné pozvánky nerozesílá. Původní automatický rozesílač po 12 hodinách je
vyřazený, aby nevznikaly souběžné kampaně se starým přihlašovacím odkazem.

Fronta respektuje odmítnutí e-mailů k hodnocení, dokončená hodnocení,
odebrání přístupu a žádosti o smazání. Účastník nemusí mít aktivovaný účet.
Opakované požadavky administrátora chrání idempotency klíč a deduplikace.
Worker znovu kontroluje oprávněnost před odesláním a používá stávající SMTP
transport, retry a archiv. V archivu je osobní odkaz nahrazen nefunkčním
placeholderem. Odeslané zprávy jsou také v `/admin/emaily`.

Report zahrnuje i rozpracované odpovědi. U každé otázky uvádí vlastní počet
odpovědí a relevantních účastníků; „nevyužil/a jsem“ není nula a nevstupuje
do průměru. Výsledky i CSV respektují filtr role a stavu. Starší odeslané
hodnocení zůstává zachované a při otevření nového průchodu se převede.
CSV používá UTF-8 BOM, středník a ochranu proti spuštění vzorců z komentářů.

## UX podklady

Rozhraní rozvíjí existující identitu aplikace (Khand/Inter, růžová a tmavé
vínové odstíny). Malé tematické kroky mají přehled postupu, návrat zpět,
plně popsané odpovědi a oddělené dobrovolné komentáře. Po výběru se stránka
sama nepřepíná; člověk může odpověď v klidu změnit.

- [GOV.UK: Question pages](https://design-system.service.gov.uk/patterns/question-pages/):
  soustředěné otázky, návrat zpět, vysvětlení účelu a označení dobrovolných polí.
- [Pew Research Center: Writing Survey Questions](https://www.pewresearch.org/writing-survey-questions/):
  srozumitelné formulace a promyšlené pořadí i možnosti odpovědí.

## Nasazení

Migrace `0036_conference_feedback` přidává samostatnou tabulku odpovědí.
Web ji aplikuje standardním Railway pre-deploy krokem. Nevytváří účty,
nerozesílá zprávy a nemění existující program. Web a worker se nasazují
společně přes větev `main`; nové e-maily vyžadují aktualizovaný worker.
Smazání účastnického profilu odstraní i příslušné odpovědi.

## Ověření

Testy pokrývají opakované použití odkazu bez relace, obnovu po refreshi a na
druhém zařízení, souběžné ukládání, volby rolí a skrytých větví, konflikty
offline konceptu, částečné reporty, CSV, oprávnění, odmítnutí e-mailů,
opakování zásilek i správnost archivu. Browser testy běží na telefonu,
tabletu a desktopu, včetně axe. Náhled e-mailu a skutečný dotazník byly
vizuálně zkontrolované. Skutečným příjemcům se při ověřování nic neodesílá.
