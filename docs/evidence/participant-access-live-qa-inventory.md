# AQ-00: inventář Q&A a programových spolupracovníků

Ověřeno 7. 9. 2026 proti lokálnímu content source a importéru. Jde o source audit, nikoli staging readiness nebo ověření účtů.

## Q&A whitelist

Potvrzený rozsah: **17 session**, pátek 18. 9. 2026; 11 BYZON Stage a 6 Leadership Stage, včetně panelových diskusí. EB21 a „Jak na networking“ uživatel výslovně vyloučil 7. 9. 2026. Sobotní program, coaching, večerní networking, společné bloky, pauzy a jídlo jsou mimo rozsah.

Strojový inventář: [`question-session-inventory-2026.json`](../../packages/database/data/question-session-inventory-2026.json). Tento soubor sám nezapíná runtime capability ani sběr.

| Stage            | Čas (Europe/Prague) | Session slug                                                                                                   | Speaker slugs                                    |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| byzon-stage      | 9:15 - 10:00        | `byzon-stage-lidskost-jako-konkurencni-vyhoda-9151000`                                                         | `margareta-krizova`                              |
| byzon-stage      | 10:45 - 11:15       | `byzon-stage-proc-vam-lide-veri-i-kdyz-jim-nic-neprodavate-10451115`                                           | `lukas-hejlik`                                   |
| byzon-stage      | 11:15 - 11:45       | `byzon-stage-lide-duveruji-lidem-konkurencni-vyhoda-kterou-nejde-koupit-reklamou-11151145`                     | `hana-slacalkova`                                |
| byzon-stage      | 11:45 - 12:15       | `byzon-stage-host-to-pozna-lidskost-jako-nejdulezitejsi-ingredience-gastro-byznysu-11451215`                   | `vladimir-macoun`, `konstancie-zelezna`          |
| byzon-stage      | 13:15 - 13:45       | `byzon-stage-co-vas-dostalo-sem-vas-dal-nedostane-13151345`                                                    | `david-kolar`                                    |
| byzon-stage      | 13:45 - 14:15       | `byzon-stage-co-mi-nikdo-nerekl-o-tom-byt-ceo-13451415`                                                        | `andrea-bohacikova`                              |
| byzon-stage      | 14:15 - 14:45       | `byzon-stage-simon-srp-14151445`                                                                               | `simon-srp`                                      |
| byzon-stage      | 15:15 - 15:45       | `byzon-stage-lidskost-pod-tlakem-kolik-lidskosti-si-muze-firma-dovolit-15151545`                               | `barbora-tumova`, `petr-dvorak`, `michal-vesely` |
| byzon-stage      | 15:45 - 16:15       | `byzon-stage-jak-vyjednavat-lidsky-a-ziskavat-zakazniky-jinak-nez-slevami-15451615`                            | `ondrej-vojacek`                                 |
| byzon-stage      | 16:15 - 16:45       | `byzon-stage-nejdrazsi-konkurencni-vyhoda-lidskost-16151645`                                                   | `jiri-jemelka`                                   |
| byzon-stage      | 17:00 - 17:45       | `byzon-stage-zradci-lidskosti-moderovana-diskuze-17001745`                                                     | `markus-krug`                                    |
| leadership-stage | 10:45 - 11:15       | `leadership-stage-human-magic-a-co-ta-lidskost-vlastne-je-10451115`                                            | `leonid-kushnir`                                 |
| leadership-stage | 11:15 - 11:45       | `leadership-stage-kdyz-lidskost-nekonci-u-bran-fabriky-jak-stavet-byznys-komunitu-a-lepsi-spolecnost-11151145` | `jan-plojhar`                                    |
| leadership-stage | 11:45 - 12:15       | `leadership-stage-prestante-lidi-motivovat-11451215`                                                           | `blanka-mrazkova`                                |
| leadership-stage | 13:15 - 13:45       | `leadership-stage-tyrkysova-firma-co-se-stane-kdyz-svemu-tymu-opravdu-verite-13151345`                         | `patrik-cada`                                    |
| leadership-stage | 13:45 - 14:15       | `leadership-stage-jak-lidsky-ziskat-genz-a-vest-s-energii-13451415`                                            | `andrea-bila`                                    |
| leadership-stage | 14:15 - 14:45       | `leadership-stage-jakub-zikmund-14151445`                                                                      | `jakub-zikmund`                                  |

Import při prvním vytvoření odvozuje slug z názvu a času, ale při reimportu zachovává existující slug podle `contentImportProvenance`. Před backfillem existující databáze je proto nutné porovnat také `sourcePath → targetId → session` v rámci eventu. UUID ani skutečné existující slugy nelze z lokálního source auditu potvrdit. Migrace nesmí rozšiřovat whitelist podle názvů ani tiše přeskočit nenalezené položky.

## Spolupracovníci a datové mezery

| Aktivita                 | Očekávané vazby a scope                                                           | Zjištění ze source/importu                                                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Koučink                  | Radim Roček → `koucovaci-zona-radim`; Stanislava Maunová → `koucovaci-zona-stana` | Import už přiděluje coach-specific rooms; 26 slotů ze `coaching-schedule-2026.json`. Speaker profil není potřebný. Skutečné rooms a scoped role ověřit v DB.                                                                                                                                                                      |
| Páteční EB21             | `lucie-libovicka`, `pavel-janousek`; jedna session, kapacita 12                   | Obě vazby dnes import odvodí z `meta`. Převést na explicitní slugs. Q&A vyloučeno.                                                                                                                                                                                                                                                |
| Řízený networking        | `tomas-reznicek`; pátek 19:00–21:00                                               | Leadership `events[14]` nemá speaker meta, Networking a afterparty `events[1]` jej má. Obě projekce se importují jako `other`, bez kapacity. Uživatel potvrdil Leadership jako jedinou rezervovatelnou projekci; druhá je informativní. DATA-02 doplní typ a speaker link Leadership projekce; kladnou kapacitu musí dodat admin. |
| Sobotní workshop Leonida | `leonid-kushnir`; IN LOCO `events[2]`, kapacita 20                                | Vazba se dnes odvodí z `meta`; převést na explicitní slug.                                                                                                                                                                                                                                                                        |
| Sobotní workshop Blanky  | `blanka-mrazkova`; IN LOCO `events[4]`, kapacita 20                               | **Vazba při importu chybí:** title není přesné jméno a meta je „1,5 hod.“. DATA-02 doplní explicitní source link.                                                                                                                                                                                                                 |
| Sobotní mastermind       | `tomas-ryza`; Předsálí `events[1]` a `events[3]`, kapacita 6                      | Import má společný `tomas-ryza-saturday-mastermind`; obě session musí pokrýt jediný atomický role scope.                                                                                                                                                                                                                          |

## Provisioning preflight před apply

- U všech lidí je stav účtu **neověřený**. Ve veřejném content source nejsou event membershipy, participant role ani `speakerProfiles.userId`; veřejný speaker profil není důkaz přístupu. E-maily se do tohoto artefaktu nepřidávají.
- Existující člověk musí mít jeden účet, aktivní membership, participant profil a aktivní participant roli; chybějící baseline řeší existující ruční participant flow nebo SimpleShop import.
- Role setup neodesílá pozvánky ani nevytváří baseline. Odeslání zůstává samostatnou participant operací.
- Roster dnes přijímá i pouhou speaker vazbu (`activity-roster.ts`); ACCESS-03 musí odstranit tuto větev a vyžadovat explicitní `room_operator`.
- Speaker vazby importér nyní odvozuje z přesného title/meta a nečte `sessions.list[].speakers`. DATA-02 musí vztahy zapsat explicitně a ověřit jejich zachování reimportem.

## Ověřený výchozí stav Q&A

- `questions.ts`: submit a chronologický moderator feed existují; sdílený gate závisí na global/session toggle, nekontroluje časové okno ani explicitní capability.
- `live-interactions.tsx`: existuje participant formulář a moderator polling. Nová UI a integrační akceptace zůstává otevřená.
- `session-qr.ts` a jeho testy: obecný programový QR existuje; Q&A target a filtrování nejsou dokončené.
- `admin-engagement.ts`: assignment vyžaduje zapnutý sběr; nový setup s globálním OFF zatím chybí.
- `admin-support.ts`: ruční participant creation zakládá baseline a interní kompatibilní ticket; nesmí se implementovat podruhé.
- `question_answers`, speaker follow-up a owner history zatím nejsou implementované.

## Předání

AQ-00 má zpracovaný scope, whitelist a lokální source audit. Kanonický networking je potvrzen na Leadership Stage; kontrola skutečných účtů/DB zůstává otevřená. AQ-01 může navázat bezpečnou expand migrací a kontrakty; DATA-02 použije potvrzenou Leadership projekci a zachová kapacitu jako provozní precondition.

## Lokální validace

7. 9. 2026 prošly `pnpm --filter @byzon/database lint`, `typecheck` a `test`: 11 testových souborů, 99 testů úspěšných. 7 integračních souborů / 22 testů bylo přeskočeno bez testovací DB. Nový inventář kryje 19 testů: přesný počet a seznam, každou source/session/speaker vazbu a obě explicitní výjimky. Databázový upgrade ani staging tímto nejsou ověřené.
