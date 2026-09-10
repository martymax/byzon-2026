# Programoví spolupracovníci a soukromé Q&A — provoz a testování

Implementace: 7. 9. 2026, [ADR-017](../adr/017-participant-collaborators-and-private-question-follow-ups.md). Tento dokument popisuje implementovaný runtime. Nasazení, skutečné pozvánky a fyzický staging rehearsal musí mít samostatný záznam; lokální testy je nenahrazují.

## Jak to funguje

Každý spolupracovník má běžný účastnický účet: aktivní membership, participant profil a aktivní roli `participant`. V administraci lze člověka vytvořit ručně nebo importovat přes SimpleShop. Nastavení programu doplní oprávnění existujícímu člověku. Nezakládá další identitu, neodesílá pozvánku a nezapíná check-in.

V **Tým / Programoví spolupracovníci** admin vyhledá účastníka, zvolí preset, zobrazí serverový náhled, zadá důvod a potvrdí. Kouč dostane `room_operator` pro svou zónu. Vedoucí aktivity dostane roster svých rezervovatelných aktivit včetně obou částí společného mastermindu. Řečník dostane propojení svého programového profilu s účtem a roli `speaker`. Moderátor dostane explicitní seznam přednášek. Existující oprávnění se zachovají; odebrání presetu odstraňuje vybraný rozsah. Zastaralý náhled vyžaduje nový náhled. Pozvánka se posílá samostatnou existující participant operací.

V účastnickém **Více** se podle serverových oprávnění zobrazí **Vedoucí aktivity**, **Moderování** nebo **Dotazy po vystoupení**. Speaker role sama neopravňuje číst roster. Roster ukazuje jen nezbytné údaje rezervovaných lidí v přiřazených aktivitách; neumí měnit docházku ani rezervace.

Q&A podporuje explicitně 17 pátečních přednášek/panelů (11 BYZON Stage, 6 Leadership Stage). EB21 mastermind ani „Jak na networking“ nejsou zahrnuté. Páteční rezervovatelný networking 19–21 je na Leadership Stage; druhý výskyt je pouze informativní. Kapacitu musí před provozem zadat pořadatel.

Účastník otevře detail přednášky nebo naskenuje QR. Q&A QR vede na `/app/interakce/:sessionId`. Po přihlášení se vrátí na tentýž bezpečný odkaz. Server přijme dotaz pouze pro publikovanou podporovanou session, při zapnutém globálním i session přepínači a **kdykoli před začátkem i během přednášky a až do 30 minut po konci** (přesně `endsAt + 30 minut` už je sběr uzavřený). Rozhoduje čas serveru. Nová publikace programu není kvůli přepínačům nutná.

Moderátor vidí jméno autora, čas a text v chronologickém seznamu. Feed se obnovuje přibližně po 5 sekundách a dočte všechny stránky. Nové dotazy neposouvají stránku; tlačítko umožní přejít na první nový dotaz. Nemá schvalování, hlasování, skrývání ani označení jako vyřízené. Historie zůstává dostupná i po konci a vypnutí sběru.

Po skončení vlastní přednášky zpřístupní samostatný přepínač `questionFollowUpsEnabled` dotazy propojeným řečníkům. Event musí být `live` nebo `ended`. Feed neobsahuje údaje o autorovi. Řečník může zveřejnit jednu odpověď (1–4000 znaků). V panelu vyhraje první uložení; další dostane konflikt. Odpověď může upravit pouze řečník, který ji napsal, s kontrolou verze. Při konfliktu zůstává rozepsaný text pro porovnání. Vlastní historie autora je na `/app/dotazy` i u dané přednášky. Písemnou odpověď vidí autor dotazu a přiřazení řečníci; ostatní účastníci ani samotný admin ji nečtou. Q&A neposílá e-maily ani push oznámení.

Soukromá data se ukládají jen v databázi a dočasně v paměti otevřené stránky. API vrací `private, no-store`; service worker je necachuje. Skrytá záložka neprovádí polling; při návratu či obnovení sítě obnoví data. Při ztrátě oprávnění nebo změně účtu se soukromý obsah odstraní. Rozepsaný text není uložen offline a zavření stránky jej zahodí. Ztracená odpověď při zápisu se řeší opakováním stejného idempotency klíče, nikoli druhým dotazem/odpovědí.

## Automatické ověření od čisté databáze

Použijte Node 24.18.x, pnpm 11.15.x a PostgreSQL 17. Testovací databáze musí být oddělená od databáze aplikace a produkce. Některé integrační testy vyžadují základní seed a immutable publikace zůstávají jako syntetické testovací záznamy. Do této databáze před spuštěním sady neimportujte skutečný program: starší schema testy pracují se seedovaným eventem a předpokládají prázdné programové dny.

Z kořene repozitáře, s existujícím PostgreSQL uživatelem oprávněným vytvořit testovací DB:

```bash
pnpm install --frozen-lockfile
createdb byzon_qa_test
export TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/byzon_qa_test'
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @byzon/database db:migrate
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @byzon/database db:seed
pnpm --filter @byzon/database build
pnpm --filter @byzon/domain build
pnpm --filter @byzon/redis build
pnpm --filter @byzon/test-support build
pnpm --filter @byzon/database test
pnpm --filter @byzon/domain test
pnpm --filter @byzon/conference exec vitest run --maxWorkers=2
pnpm --filter @byzon/database db:test-question-upgrade
pnpm --filter @byzon/conference exec vitest run --config vitest.browser.config.ts src/test/component/program-access.component.tsx src/test/component/participant-questions.component.tsx src/test/component/moderator-questions.component.tsx src/test/component/speaker-questions.component.tsx
pnpm lint
pnpm typecheck
pnpm build
```

`createdb` se řídí vašimi PG connection parametry; upravte host, port a uživatele shodně s URL. `db:test-question-upgrade` vytváří unikátní pomocnou databázi, aplikuje migrace do 0027, připraví starší data, aplikuje 0028 a ověří 17 podporovaných session, dva vyloučené bloky, legacy provenance a oba přepínače OFF. Pomocnou DB po testu odstraní; databázi v `TEST_DATABASE_URL` nemění. Vyžaduje právo `CREATE DATABASE`.

Rychlý cílený backend regresní běh:

```bash
pnpm --filter @byzon/conference exec vitest run --maxWorkers=2 src/server/admin-program-access.integration.test.ts src/server/host-capabilities.integration.test.ts src/server/questions.integration.test.ts src/server/speaker-questions.integration.test.ts src/server/question-admin.integration.test.ts src/server/question-qr.integration.test.ts src/server/activity-roster.integration.test.ts
```

Časové hranice se testují injektovaným časem v serverových testech. Produkční HTTP API nemá přepínač na obejití času.

## Příprava skutečné testovací aplikace

1. Nastavte vlastní lokální/staging databázi, Redis, app origin, Better Auth a lokální či staging email transport podle `.env.example` a existujícího deployment runbooku. Mock preview (`dev:mock`) neověřuje SQL autorizaci, souběhy ani skutečnou session.
2. Proveďte `db:migrate` a základní `db:seed`. Na existující DB není seed náhradou migrace. Udělejte dry-run importu:

   ```bash
   pnpm --filter @byzon/database db:import-content --event-slug byzon-2026 --dry-run
   pnpm --filter @byzon/database db:import-content --event-slug byzon-2026
   pnpm --filter @byzon/database db:readiness byzon-2026
   ```

   Import aktualizace již publikovaného obsahu vyžaduje vědomé použití `--allow-published-update`. Nejde o automatickou součást testu. Readiness má nenulový exit, dokud nejsou propojené účty a nakonfigurovaná kapacita; to je správný výsledek, nikoli chyba CLI.

3. Přihlaste se admin účtem. Pokud v izolované instalaci žádný není, použijte `db:bootstrap-admin --event-slug byzon-2026 --user-email <váš-testovací-email> --create-user`. CLI neposílá pozvánku.
4. V **Účastníci** založte syntetické účty A, B, moderátora M, dva řečníky S1/S2 a vedoucího V. Uložte a zkontrolujte membership/profil/participant roli; pozvánka musí zůstat neodeslaná. Opakované založení stejného emailu nesmí vytvořit druhou identitu. Teprve poté samostatně odešlete testovací participant pozvánku do povolené testovací schránky.
5. V **Tým / Programoví spolupracovníci** nastavte M podporovanou přednášku, S1/S2 její skutečné programové profily a V jeho aktivitu. Kouče přiřazujte podle zóny. Zkontrolujte obě části mastermindu, pozitivní kapacitu a místnost. Networking rezervujte jen na Leadership Stage. Zopakujte náhled stejného nastavení a ověřte, že nezdvojuje scope.
6. V **Obsah** publikujte správný program. V **Interakce** nechte globální sběr i písemné odpovědi OFF. Připravte per-session přepínače a přiřazené moderátory. Přehled ukazuje coverage; nepodporované aktivity v seznamu Q&A nejsou.
7. Pro test odeslání dotazu před konferencí není nutné měnit časy: stačí publikovaná podporovaná přednáška, aktivní účty, moderátor a oba přepínače sběru ON. Pro otestování celého cyklu včetně uzavření a odpovědí použijte následující časově zkrácený rehearsal. Pro živý rehearsal před konferencí použijte oddělenou staging databázi s kopií eventu `byzon-2026` (runtime vybírá právě tento slug). V této testovací kopii v Obsahu nastavte jedné z importovaných 17 podporovaných přednášek začátek za dvě minuty a konec za sedm minut, event přepněte do `live` a program znovu publikujte. Při testu v jiný kalendářní den musí správce testovací DB upravit také časové hranice kopie eventu a `local_date` příslušného programového dne; publikace správně odmítá session mimo její event/day. Q&A capability je serverová vlastnost; nepřidává se v běžném formuláři. Test fixture v `src/test/server/question-fixture.ts` ukazuje úplná nutná data včetně publikace. Tuto změnu času provádějte výhradně v oddělené testovací kopii; produkční program neměňte.

## Přesná ruční testovací matice

Použijte samostatné profily prohlížeče, aby si účty nepřepisovaly cookies. Pro fyzický rehearsal potřebujete telefon A a dva tablety M/S. Vedle toho mějte prohlížeč pro admina a účet B.

| Krok | Akce                                                                                 | Očekávaný výsledek                                                                                                         |
| ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1    | Se sběrem OFF přiřaďte M přednášku. Zkuste nepodporovaný blok i crafted API request. | Podporovaný blok lze připravit; jiný server odmítne.                                                                       |
| 2    | Zapněte sběr bez připraveného M.                                                     | Odmítnutí, žádná změna přepínače; přehled ukáže chybějící přiřazení.                                                       |
| 3    | Obnovte M a zapněte sběr. Stáhněte single SVG i ZIP z Obsahu/Interakcí.              | ZIP má jen podporované publikované session a manifest s časem, stage a správným UUID.                                      |
| 4    | Telefonem načtěte QR bez přihlášení a dokončete přihlášení A.                        | Návrat na stejnou `/app/interakce/:id`, nikoli obecný program.                                                             |
| 5    | Před startem zkuste odeslat. Při startu obnovte stav.                                | Před startem i od startu přijímá. Polling se projeví nejpozději po dalším obnovení.                                        |
| 6    | A odešle dotaz, B jiný dotaz.                                                        | M uvidí oba se jmény; A ve vlastní historii pouze svůj, B pouze svůj.                                                      |
| 7    | Odpojte tablet M, přidejte dotazy, obnovte připojení.                                | Starší text zůstane označený jako neaktuální, po návratu se dočtou nové bez duplicity a samovolného scrollu.               |
| 8    | Ztráťte odpověď sítě po zápisu a opakujte.                                           | Stejný klíč a text, pouze jeden DB záznam. Změna textu vytvoří nový pokus.                                                 |
| 9    | Ve skryté záložce sledujte Network, vraťte se zpět.                                  | Skrytá záložka nepolluje, po návratu načte aktuální stav.                                                                  |
| 10   | Na konci session a 30 minut po ní zkuste nový submit.                                | V čase `endsAt` stále přijímá; od přesného `endsAt + 30 minut` odmítá. Přesný retry již přijatého dotazu zůstane úspěšný.  |
| 11   | Před koncem otevřete řečnický feed, potom po konci s follow-up ON.                   | Před koncem nepřístupný; po konci přístupný pouze linked speakerům. Žádné identity autorů v JSON.                          |
| 12   | S1 a S2 odpovědí zároveň na stejný dotaz.                                            | Jedna odpověď; druhý konflikt, zachovaný návrh. Zkopírování URL na jiný účet neopravňuje ke čtení.                         |
| 13   | S1 upraví vlastní odpověď ve dvou oknech se stejnou verzí.                           | Jedna změna úspěšná, druhá konflikt. S2 cizí odpověď neupraví.                                                             |
| 14   | A otevře Moje dotazy a odpovědi. Otevře ji B i samotný admin.                        | A vidí odpověď; B ani admin nevidí cizí obsah. Žádný email/push.                                                           |
| 15   | Vypněte sběr, pak follow-up.                                                         | OFF sběr blokuje nové dotazy, feed M i odpovědi pokračují. OFF follow-up blokuje S čtení/zápis, autorova historie zůstane. |
| 16   | Odeberte roli nebo session/profile link, obnovte otevřený feed.                      | Další request zamítnut bez nutnosti logoutu; soukromý obsah a rozepsaný text se odstraní.                                  |
| 17   | V zobrazení V zkuste cizí session a přímou roster URL bez participant baseline.      | Jen vlastní explicitní scope; cizí data nepřístupná. Speaker samotný roster neotevře.                                      |
| 18   | Zkontrolujte Cache Storage, IndexedDB, localStorage a server audit.                  | Žádné otázky/odpovědi. Audit má pouze akci, technickou referenci a verzi.                                                  |

Dlouhý feed se 125 otázkami, shodné timestampy, souběhy a bezpečné návratové URL jsou navíc součástí automatických testů. Pro telefon/tablet ověřte 44px ovládání, čitelnost, klávesnici, focus a reálné naskenování promítaného/tištěného SVG.

## Zapnutí, sledování a rollback

Před produkčním zapnutím pořadatel do release záznamu doplní jméno odpovědného operátora, zálohu operátora, release SHA, výsledek readiness, datum QR rehearsal a použité zařízení. Tyto údaje nelze nahradit syntetickým testem.

Nasazujte expand migraci 0028 před aplikací. `speakerPortalEnabled` zůstává vypnutý. Připravte všechny účty, vazby, publikaci a moderátory při OFF. Globální sběr lze zapnout bez přiřazených moderátorů; následně povolte sběr u vybraných přednášek. Follow-up zapněte samostatně po speaker/author UAT. Přepínače jsou v **Interakce**; každá změna vyžaduje důvod a potvrzení.

Při problému nejprve vypněte **Otázky pro řečníky**. Zastaví se nové dotazy, staré zůstanou čitelné moderátorovi i autorovi. Pokud je problém s odpověďmi, samostatně vypněte **Písemné odpovědi po vystoupení**. Tím zastavíte speaker čtení i zápis, autorovi zůstanou uložené odpovědi. Při chybném přiřazení odeberte pouze příslušný scope/propojení. Databázové tabulky ani již přijatá data nemažte; rollback aplikace musí zachovat expand schéma. Nevracejte starý server s původními benevolentními pravidly Q&A při zapnutém sběru.

Sledujte technickou chybovost, dobu odpovědí, 401/403, 409 a 429. Nelogujte request/response body. Konflikt 409 při souběhu či zastaralé verzi je očekávaná ochrana. Překročení osmi dotazových pokusů za minutu pro účet/session vrací 429; počkejte podle `Retry-After`.

## Správa dotazů během konference

Od migrace `0031_question_moderation.sql` může přiřazený moderátor v **Moderování** a administrátor v **Interakce → Spravovat dotazy**:

- označit otázku jako **Zodpovězeno na konferenci** a případně ji vrátit mezi nezodpovězené;
- smazat otázku po potvrzení; u sloučené otázky se odstraní celá skupina z moderátorského, účastnického i řečnického přehledu;
- vybrat dvě otázky ze stejné přednášky a sloučit je. Lze slučovat i již sloučené skupiny. Každé původní znění, autor a čas zůstávají zachované. Pokud některá část nebyla zodpovězená, výsledná skupina čeká na odpověď.

Původní znění se v databázi nepřepisují. Smazání používá `deleted_at`; nejde o fyzický výmaz uložených záznamů. Soukromé písemné odpovědi zůstávají navázané na původní otázky a nesdílejí se mezi tazateli. Účastník vidí své původní znění a označení zodpovězení na konferenci. Moderátorský přehled obnovuje i změny a odstranění existujících otázek.

Změny kontrolují aktivní oprávnění a verzi otázky v transakci, zapisují audit bez soukromého textu a podporují idempotentní opakování. Při konfliktu obnovte dotazy a proveďte zamýšlenou akci nad aktuální verzí. Migraci 0031 nasaďte před novou aplikací; starší aplikace neumí respektovat označení smazaných a sloučených otázek.

Sběr dotazů nevyžaduje přiřazeného moderátora. Globální přepínač **Otázky pro řečníky** slouží jako hlavní vypínač, samotný sběr se povoluje u jednotlivých podporovaných přednášek. Vypnutá přednáška nepřijímá dotazy ani při zapnutém globálním přepínači; globální vypnutí zastaví sběr všude. Přehled přiřazení moderátorů je informativní, dotazy může spravovat administrátor. Podmínky pro soukromé písemné odpovědi řečníků zůstávají zachované.
