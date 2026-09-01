# BYZON 2026 — návrh UX/UI administrace a implementační plán

> Stav dokumentu: `specification ready`; zahájení změn kódu podmiňuje
> governance úkol `AUX-00B`
>
> Verze: 1.4
>
> Datum: 1. září 2026
>
> Ověřený baseline návrhu: commit `d09a59d`; SimpleShop API tok ověřen na
> commitu `bfead32` větve `main`
>
> Cílová aplikace: `https://app.byzon.cz/admin`
>
> Autorita pro UX/UI administrace: tento dokument
>
> Autorita pro produktový scope, role, data a bezpečnost:
> [`AI_IMPLEMENTATION_PLAN.md`](../AI_IMPLEMENTATION_PLAN.md),
> [`frontend-route-map.md`](./frontend-route-map.md) a příslušné ADR

Tento dokument je návrh pracovního rozhraní pro pořadatele akce, nikoli pro
vývojáře aplikace. Určuje cílovou informační architekturu, vizuální systém,
mikrocopy, chování obrazovek a pořadí realizace. Je zároveň jediným živým
trackerem redesignu. Další agent nesmí založit paralelní status dokument.

---

## 0. Jak s dokumentem pracovat

### 0.1 Povinný postup pro každého AI agenta

1. Přečti [`AI_IMPLEMENTATION_PLAN.md`](../AI_IMPLEMENTATION_PLAN.md),
   [`README.md`](../README.md), [`handover.md`](../handover.md), případný
   `AGENTS.md`, §0, §2, §4, §5, specifikaci své obrazovky v §10 a kartu úkolu v
   §15. Hlavní plán je autorita pro větev, worktree, review, schválení, commit a
   push.
2. Ověř čistotu pracovního stromu, HEAD, aktuální kód, kontrakt, fixtures a
   testy. Starší textový report není důkaz aktuálního stavu a cizí změny se
   nemažou ani nepřepisují.
3. Vyber pouze úkol se splněnými `depends_on`. Zkontroluj `blocked_by`,
   `integration_gate` i vlastnictví všech hotspotů uvedených v §14.1.
   `integration_gate` musí být splněný před `[x]` v cílovém lifecycle, ne nutně
   před zahájením práce, která jej sama vytváří. `[!]` task smí začít pouze
   bezpečnou přípravou nebo řešením svého pojmenovaného blockeru/gapu; cílový
   stav nesmí uzavřít, dokud blocker nezmizí. Změň značku v §14 na `[~]`,
   doplň vlastníka, větev/worktree a datum ještě před prací.
4. Neměň serverovou autorizaci, PII pravidla, idempotenci, audit ani preview
   boundary jen kvůli zjednodušení UI. Technickou složitost lze skrýt, ne
   odstranit.
5. Implementuj nejmenší úplný vertikální řez do cílového lifecycle stavu. Pro
   UI jsou povinné všechny relevantní stavy z §11, nikoli falešná produkční
   data.
6. Spusť kontroly uvedené v kartě úkolu, proveď self-review a u integrační
   jednotky povinně security review → code review → opravy a nové ověření dle
   hlavního plánu §1.6.
7. Přidej do `Evidence` soubory, přesné příkazy/výsledky testů, screenshoty či
   UAT záznam a synchronizuj dotčený hlavní plán, route mapu, report a handoff.
8. Teprve po splnění task-specific akceptace a odpovídajícího DoD v §16 změň
   stav na `[x]`. Mockované UI se nesmí označit jako `integrated`.
9. Předlož změnu uživateli. Bez explicitního schválení neprováděj commit, push,
   PR update, merge, rebase ani mazání větve.
10. Přidej stručnou položku do changelogu v §18. Nikdy nemaž historii
    dřívějších rozhodnutí.

### 0.2 Stavové značky a lifecycle

- `[ ]` nezačato
- `[~]` rozpracováno
- `[x]` dokončeno a ověřeno
- `[!]` blokováno konkrétním vstupem nebo rozhodnutím
- `[–]` vědomě mimo rozsah s odkazem na rozhodnutí

Capability používají stejný lifecycle jako hlavní plán:

`not started → contract ready → UI ready (mocked) → integrated → UAT`

`[x]` u frontendového úkolu znamená pouze stav uvedený ve sloupci `Cíl`.
Například `UI ready (mocked)` není produkční integrace.

Tracker odděluje **stav úkolu**, **typ úkolu** a **cílový stav capability**.
Pomocné úkoly typu `governance`, `research`, `QA` nebo `protocol` používají v
capability sloupci `N/A`; nesmí vytvářet nový lifecycle. Priority používají
prefix `U`, aby se nepletly s datovou třídou P3:

- `U0` — bezpečnostní nebo strukturální gate, bez něj nelze bezpečně pokračovat;
- `U1` — hlavní organizátorský průchod pro release;
- `U2` — důležitá provozní úplnost;
- `U3` — příprava s delším předstihem nebo vědomě pozdější rozšíření.

### 0.3 Konflikt autorit

1. Produktový scope, role, oprávnění, PII a offline pravidla určuje hlavní plán
   a route mapa.
2. Databázové a integrační hranice určují ADR a sdílené kontrakty.
3. Tento dokument určuje admin IA, layout, komponenty, mikrocopy a interakce.
4. Pokud se kód a starší report rozcházejí, rozhoduje ověřený kód na uvedeném
   baseline; rozpor se zapíše do §17.

Tento návrh **refaktoruje a nahrazuje prezentační/IA vrstvu dokončeného F4**,
ale neruší jeho kontrakty, fixtures, bezpečnostní invarianty ani stav
`UI ready (mocked)`. Před první změnou kódu musí `AUX-00B` zapsat toto mapování
do hlavního prováděcího plánu; do té doby je tento soubor implementační
specifikace, nikoli paralelní oprávnění obejít F4/P9.

Aktuálně známý dokumentační drift: hlavička hlavního plánu uvádí v6.16, jeho
changelog končí v6.19; některé dokumenty z 16. srpna stále uvádějí `P5-08`
jako otevřený, zatímco novější plán a kód jej mají integrovaný. Tento redesign
proto nekopíruje staré statusy bez ověření.

### 0.4 Povinný zdrojový registr

| Zdroj                                                                      | Autorita pro tento redesign                                                 |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`AI_IMPLEMENTATION_PLAN.md`](../AI_IMPLEMENTATION_PLAN.md)                | lifecycle, rozsah, bezpečnost, větve, review a integrační vlastníci         |
| [`frontend-route-map.md`](./frontend-route-map.md)                         | route, role, fáze, deep link, Back, PII/offline a povinné stavy             |
| [`frontend-implementation-report.md`](./frontend-implementation-report.md) | ověřený frontend baseline a testovací evidence; po každém řezu aktualizovat |
| [`v6-scope-inventory.md`](./v6-scope-inventory.md)                         | vyřazené attendance/networking/široké announcement funkce                   |
| [`handover.md`](../handover.md)                                            | živé předání stavu, hotspotů a navazujícího kroku podle hlavního plánu      |
| [`ADR-007`](./adr/007-private-object-storage.md)                           | private storage, krátkodobé URL/proxy a hranice schválených obrázků         |
| [`ADR-008`](./adr/008-database-published-content-source.md)                | databáze a publication snapshot jako zdroj publikovaného obsahu             |
| [`ADR-009`](./adr/009-service-worker-indexeddb.md)                         | offline hranice a zákaz ukládat admin P3 data                               |
| [`ADR-011`](./adr/011-event-feature-flags.md)                              | feature/event gate chování                                                  |
| [`ADR-012`](./adr/012-multi-event-data-model.md)                           | event scope a budoucí bezpečné přepínání akce                               |
| [`ADR-013`](./adr/013-incremental-frontend-architecture.md)                | incremental slice, preview a produkční boundary                             |
| [`ADR-015`](./adr/015-simpleshop-api-sync.md)                              | server-only SimpleShop API preview, bezpečnost zdroje a oddělený apply      |

Handoff se aktualizuje v root [`handover.md`](../handover.md) a task evidence;
agent nesmí zakládat duplicitní `docs/handover.md` ani druhý AUX tracker pod
jiným názvem.

### 0.5 Mapování AUX na existující workstreamy

| AUX oblast           | Routy                                                | Refaktoruje F4                 | Kontrakt / produkční vlastníci                                                                   |
| -------------------- | ---------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `AUX-01` až `AUX-03` | celý `/admin/*` shell a `/admin`                     | `F4-01`, `F4-07`, `F4-09`      | `CS-ADMIN-01`, `P9-01`, `P9-08`; check-in agregace `P6-06`                                       |
| `AUX-04`             | `/admin/obsah`                                       | obsahový řez F4 po `F4-10`     | core `P3-05` až `P3-08`, asset schema `P3-01`; nový asset read/mutation slice založí `AUX-00B`   |
| `AUX-05`             | `/admin/vstupenky`                                   | refaktoruje `F4-02` až `F4-04` | `ADR-015`, `CS-IMPORT-01`, integrovaný `P4-02` preview a budoucí `P4-03` apply; bez file uploadu |
| `AUX-06`             | `/admin/ucastnici`                                   | `F4-05`                        | `CS-SUPPORT-01`, `P4-09`, `P9-03`                                                                |
| `AUX-07`             | `/admin/rezervace`                                   | scope-aligned `F4-08`, `F4-10` | `CS-ADMIN-01`, `P5-05`, `P9-01`                                                                  |
| `AUX-08`             | `/admin/oznameni`                                    | `F4-06`, `F4-10`               | `CS-ANN-01`, `P8-05`, provozní stav `P8-10`                                                      |
| `AUX-09`             | `/admin/role`                                        | `F4-07`, `F4-10`               | `CS-ADMIN-01`, `P9-02`                                                                           |
| `AUX-10`             | `/admin/reporty`, `/admin/audit`, `/admin/nastaveni` | `F4-07`, `F4-08`, `F4-10`      | `CS-ADMIN-01`, `P9-04` až `P9-09`                                                                |

`AUX-13*` níže jsou jediná místa, kde se jednotlivé routy posouvají z
`UI ready (mocked)` do `integrated`; každá má vlastní serverový gate a vlastní
evidence.

---

## 1. Cíl a měřítka úspěchu

### 1.1 Produktový cíl

Pořadatel musí bez znalosti interních ID a vývojářských výrazů bezpečně:

- zjistit, co právě vyžaduje pozornost;
- připravit a zveřejnit program a praktický obsah;
- načíst ze serverového zdroje a zkontrolovat změny vstupenek;
- najít účastníka a vyřešit jeho konkrétní problém;
- řešit rezervace a kapacity;
- poslat kritické oznámení správným lidem;
- spravovat tým, reporty, historii změn a nastavení akce.

Rozhraní má působit klidně, předvídatelně a profesionálně. Nesmí vypadat jako
technická konzole ani jako marketingová landing page.

### 1.2 Měřitelné release cíle

- Uživatel najde cílovou sekci do 15 sekund bez pomoci vývojáře.
- Pět reprezentativních pořadatelů dokončí alespoň 23 z 25 UAT pokusů bez
  nápovědy vývojáře.
- Při UAT nevznikne žádné odeslání nesprávnému publiku, nechtěná destruktivní
  akce ani záměna testovacích a produkčních dat.
- V hlavním toku se nezobrazuje UUID, checksum, idempotency key, raw enum ani
  pojmy ze zakázaného slovníku v §6.2.
- Každá routa má právě jeden popisný `h1`, vlastní metadata title, samostatného
  UI vlastníka a v každém stavu/viewportu **nejvýše jednu** viditelnou primary
  akci. Read-only, loading, error nebo permission stav může mít primary akcí
  nula.
- Celý admin má právě jeden `<main>` a jeden skip link.
- Automatický axe audit má 0 `serious` a 0 `critical` nálezů.
- Všech pět UAT scénářů lze dokončit pouze klávesnicí.
- Není horizontální scroll celé stránky při šířce 320 px a layout zůstává
  funkční při 200% zoomu.
- Ověřené viewporty: 320, 375, 414, 768, 1024 a 1440 px; navíc 1280 × 800 kvůli
  existujícímu testovacímu baseline.

### 1.3 Reprezentativní UAT scénáře

1. Načíst změny vstupenek z připojeného zdroje, najít chybný záznam a zjistit,
   co opravit, aniž by se neplatná dávka použila.
2. Najít konkrétního účastníka a znovu mu poslat aktivační výzvu.
3. Z přehledu zjistit téměř plnou aktivitu a bezpečně upravit její kapacitu.
4. Poslat kritické oznámení konkrétní aktivitě výběrem podle názvu, ne podle ID.
5. Upravit bod programu, zkontrolovat změny a zveřejnit je.

### 1.4 Reprodukovatelný UAT protokol

`AUX-00C` připraví pět pořadatelů, kteří cílové UI neimplementovali: nejméně
dva editoři obsahu, dva lidé z provozu akce a jeden správce týmu. Každý provede
všech pět scénářů, tedy 25 nezávislých pokusů. První pokus je bez nápovědy;
moderátor smí vysvětlit zadání, ale nesmí pojmenovat route, ovládací prvek ani
postup. Opakovaný pokus po nápovědě se zapisuje zvlášť a nepočítá se mezi 23
úspěchů.

**Pevný syntetický výchozí stav**

- serverový zdroj vstupenek vrátí dávku 12 záznamů — 8 nových, 2 beze změny, 1
  konflikt a 1 nerozpoznaný; uživatel nemá žádný soubor a první pokus nesmí nic
  zapsat;
- účastník: dva podobné výsledky, jen jeden odpovídá maskovanému kontaktu a má
  dostupnou akci znovu poslat aktivaci;
- kapacita: jedna aktivita „Růst bez zkratek“ má 78 z 80 míst a server povolí
  bezpečnou změnu na 90;
- oznámení: stejná aktivita existuje jako jediný povolený session target;
- obsah: jeden uložený bod programu má nezveřejněnou změnu místnosti a času.

**Úspěch jednotlivých scénářů**

1. Uživatel spustí načtení ze zdroje, najde oba chybné záznamy, vysvětlí jejich
   problém a změny nepoužije.
2. Vybere správného člověka a dostane kanonické potvrzení znovu odeslané
   aktivace.
3. Najde téměř plnou aktivitu, změní kapacitu na 90 a ověří nový stav.
4. Vybere jednu aktivitu podle názvu, zkontroluje přesné publikum a odešle
   jedinou kritickou zprávu.
5. Upraví bod, uloží jej, zkontroluje lidský dopad a publikuje kanonický
   výsledek.

Každý pokus má řádek `UAT-{scénář}-{uživatel}` s poli: datum, anonymní profil,
fáze akce, zařízení, viewport, browser, čas do nalezení sekce, celkový čas,
výsledek, počet moderátorských zásahů, chyba uživatele, severity nálezu, odkaz
na video/poznámky a navazující AUX task. Release gate je ≥23/25 bez pomoci,
žádná kritická chyba a žádná otevřená severity 1/2 vada.

Accessibility evidence kombinuje axe s manuální kontrolou: 0
`serious`/`critical`, všechny relevantní WCAG 2.2 A/AA nálezy jsou opravené
nebo písemně triagované a smoke test proběhne nejméně ve VoiceOver + Safari na
macOS a NVDA + Chrome na Windows. Nedostupná platforma je zaznamenaný blocker,
nikoli tiché přeskočení.

**Release smoke mimo 25 UAT pokusů**

`AUX-14F` navíc na produkčně podobném stagingu provede tuto pevnou matici:

1. plně oprávněný organizer projde všechny viditelné `/admin/*` položky na
   1440 px a 375 px; každá má správný active stav, unikátní `h1`, jeden `main`,
   jeden skip link a žádný public chrome;
2. omezený actor na 375 px nevidí zakázané položky a přímá návštěva každé
   zakázané routy vrátí bezpečný permission stav bez P3 dat;
3. dashboard ve `live` a `archived` fixture otevře správný první řešitelný
   target, nevyrábí CTA bez targetu a archiv nenabízí mutaci;
4. správa doloží: otevřít assignment a zavřít bez zápisu, požádat o syntetický
   report a vidět kanonický job stav, použít serverový audit filtr a v
   nastavení vstoupit do editace a změny zahodit; žádný krok nesmí vyžadovat
   raw ID;
5. ke každému řádku `SMOKE-{actor}-{viewport}-{route}` se uloží výsledek,
   screenshot/trace, request evidence, accessibility nález a opravný AUX task.

Tato matice není náhradou pěti pořadatelských scénářů ani performance evidence
`AUX-12C`; finální `[x]` zároveň vyžaduje globální skutečný-endpoint smoke
`P9-08`.

---

## 2. Nepřekročitelné hranice

- Jazyk rozhraní je čeština; pracovní timezone je `Europe/Prague`.
- Cíl je WCAG 2.2 AA. Inputy na mobilu mají nejméně 16 px a všechny hlavní
  interakční cíle nejméně 44 × 44 CSS px.
- P3 data administrace jsou online-only, `private, no-store`; po ztrátě
  oprávnění, změně scope nebo relace se okamžitě odstraní z UI.
- Jméno, e-mail, důvod změny ani jiná PII se neukládají do URL, historie,
  analytiky nebo obecné browser cache.
- Server zůstává autoritou pro event scope, permission, dostupnou akci, verzi,
  audit a idempotenci. Skryté tlačítko nenahrazuje autorizaci.
- Akce s nejistým výsledkem se nesmí slepě opakovat s novým payloadem.
  Uživatelské UI nejdřív ověří aktuální stav; implementace může pod povrchem
  zopakovat přesně stejný idempotentní požadavek.
- Oznámení jsou v Priority A pouze kritická; jeden send cílí na celou akci nebo
  právě jednu dotčenou aktivitu podle současného `CS-ANN-01`.
- `/check-in` a `/host/aktivity` zůstávají samostatné operátorské shelly.
- Žádný attendance write, participant self-export, speaker/partner portál ani
  Priority B networking, otázky a hodnocení se tímto redesignem nepřidávají.
- Stack zůstává Next.js 16, React 19, strict TypeScript, CSS Modules a
  `@byzon/ui`. Redesign není oprávnění k plošnému framework rewritu.
- Produkční route se neodemkne jen proto, že existuje hotový vzhled. Mimo
  `/admin/obsah` jsou současné admin cesty správně fail-closed do dokončení
  příslušné integrace.

---

## 3. Ověřený audit současného stavu

### 3.1 Kritické strukturální problémy

| Nález                                          | Důkaz v baseline                                                                                                                                                                                                                                                                                                                                                          | Dopad                                                                                | Cílové řešení                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Admin je uvnitř participantního root chrome    | [`app/layout.tsx`](../apps/conference/src/app/layout.tsx), [`app-main.tsx`](../apps/conference/src/components/app-main.tsx), [`admin-workspace-shell.tsx`](../apps/conference/src/components/admin-workspace-shell.tsx)                                                                                                                                                   | Dvojitá hlavička, dva skip linky a vnořený `<main>`                                  | Route-aware chrome, který pro `/admin` nevykreslí veřejnou hlavičku ani vnější `<main>` |
| Produkční a preview admin nemají stejný shell  | [`admin/layout.tsx`](../apps/conference/src/app/admin/layout.tsx), [`admin/obsah/page.tsx`](../apps/conference/src/app/admin/obsah/page.tsx)                                                                                                                                                                                                                              | Jediná produkční obrazovka obsahu vypadá jinak a používá marketingové globální styly | Jeden prezentační shell pro mock i produkci, rozdílný pouze datovým/auth adapterem      |
| Pět rout nemá vlastního UI vlastníka           | [`role/page.tsx`](../apps/conference/src/app/admin/role/page.tsx), [`reporty/page.tsx`](../apps/conference/src/app/admin/reporty/page.tsx), [`rezervace/page.tsx`](../apps/conference/src/app/admin/rezervace/page.tsx), [`audit/page.tsx`](../apps/conference/src/app/admin/audit/page.tsx), [`nastaveni/page.tsx`](../apps/conference/src/app/admin/nastaveni/page.tsx) | Aktivní navigace neodpovídá nadpisu ani úkolu                                        | Samostatný route workspace a `h1` pro každou routu                                      |
| Produkční routy kromě obsahu jsou preview-only | [`admin-frontend-preview.ts`](../apps/conference/src/lib/admin-frontend-preview.ts), [`preview-routes.test.tsx`](../apps/conference/src/app/admin/preview-routes.test.tsx)                                                                                                                                                                                                | Screenshot nebo mock není důkaz produkční administrace                               | Zachovat fail-closed boundary a integrovat až s pojmenovaným serverovým vlastníkem      |

### 3.2 Závažné UX problémy

- Plochá navigace má deset rovnocenných položek bez skupin a nerespektuje
  permissions. Uživatel zjistí zákaz až po kliknutí na technickou 403 stránku.
- Sidebar zobrazuje plné event UUID jako „Rozsah“ a topbar roli s timezone,
  ale nevyužívá dostupný `actor.displayLabel`, fázi akce ani srozumitelný stav.
- Dashboard ukazuje `F4`, snapshoty, queue, payloady, override a pevně napsané
  technické kroky místo priorit podle fáze a závažnosti.
- Role a oznámení vyžadují ruční ID operátora nebo aktivity. Transfer vstupenky
  vyžaduje ID cílové vstupenky.
- Backendové hodnoty `active`, `claimed`, `update_settings`, `succeeded`,
  `default`, `notifications` a další se vypisují bez lokalizace.
- Publikace začíná checksumem, verzemi a immutable snapshotem ještě před
  samotným editorem obsahu.
- Obsahový editor ukazuje permanentně prázdný formulář před seznamem, technický
  `slug`, obecné pole „Text“ a obtížně použitelný nativní multi-select.
- Červené danger tlačítko se používá i pro běžné změny kapacity, nastavení a
  přiřazení role. Export sice používá secondary styl, ale stejně jako běžné
  akce vyžaduje univerzální potvrzovací checkbox. Riziko a administrativní
  tření proto nejsou odstupňované podle skutečného dopadu.
- Dirty guard má jen obsah; rozepsané oznámení, role, aktualizace vstupenek a
  nastavení se mohou při navigaci ztratit bez upozornění.
- Produkční `AdminImportWorkspace` už podle `ADR-015` spouští serverové
  read-only načtení ze SimpleShop API a nenabízí CSV/XLSX upload. Zbývá nahradit
  technické texty jako „Staging diff preview“, zpřehlednit kontrolu záznamů a
  po dokončení `P4-03` doplnit oddělené potvrzení a výsledek apply.
- Tablet používá horizontálně posouvaný pás navigace. Cílem je jeden drawer se
  stejnou hierarchií jako desktop.
- Admin má hard-coded modrou paletu mimo sdílené BYZON tokeny. Globální
  marketingový `h1` může v admin stavu narůst až k 6–8 rem.

### 3.3 Co se musí zachovat

- Viditelné labely, 44px cíle, focus ring a `aria-current`.
- Focus management dialogu a návrat fokusu.
- Focusovatelný error summary; v redesignu se doplní odkazy na konkrétní pole.
- Mobilní alternativa datových tabulek.
- Bezpečný náhled před hromadnou nebo nevratnou změnou.
- Expected version, auditní důvod, idempotence, request fencing a okamžité
  skrytí citlivých dat při 401/403/offline.
- Dirty guard obsahu včetně bezpečného chování při změně scope.

Poznámka: screenshot poskytnutý k zadání a aktuální kód se obsahově rozcházejí.
Screenshot obsahuje „Interakce“ a networking/Q&A rozcestník, který v baseline
není a je mimo Priority A. Autoritativní cílovou IA určuje §7 tohoto dokumentu;
statický vývojářský rozcestník se nesmí obnovit.

---

## 4. Uživatelé a jejich mentální model

### 4.1 Primární persona: pořadatel akce

- Není vývojář a nezná UUID, API, queue, idempotenci ani verzování.
- Pracuje hlavně na notebooku, na místě někdy na tabletu nebo telefonu.
- Často řeší úkol pod časovým tlakem a potřebuje vidět dopad před potvrzením.
- Přemýšlí v lidech, aktivitách, čase, kapacitě a výsledku, ne v technických
  zdrojích.

### 4.2 Sekundární pracovní režimy

- **Editor obsahu:** připravuje program, řečníky, místa a praktické informace.
- **Vedoucí provozu:** během akce sleduje kapacity, odbavení a kritická
  oznámení.
- **Správce týmu:** přiděluje omezené role a kontroluje historii změn.

Nejde o nové doménové role. Jsou to pracovní režimy stejného oprávněného
organizátora. Skutečné permissions se dál načítají ze serveru.

### 4.3 Úkoly podle fáze akce

| Fáze              | Co chce pořadatel vidět jako první                                                           |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `draft`           | Co ještě chybí připravit: program, obsah, vstupenky, tým a nastavení                         |
| `activation_open` | Kolik lidí je aktivovaných, chyby aktualizace vstupenek, stav publikace a otevřené rezervace |
| `live`            | Co právě vyžaduje zásah: odbavení, téměř plné aktivity, neúspěšné oznámení                   |
| `ended`           | Výsledky, exporty, poslední neuzavřené provozní úkoly                                        |
| `archived`        | Jasný read-only režim, historie a retenčně povolené reporty                                  |

---

## 5. Závazné UX principy

1. **Úkol před technologií.** Nadpis říká, čeho uživatel dosáhne, ne který
   backendový modul otevřel.
2. **Jedna routa, jeden hlavní úkol.** Route nesmí znovu spojit role, reporty,
   audit a nastavení do jedné konzole.
3. **Nejdřív výsledek a dopad.** Verze, checksum, request ID a bezpečnostní
   implementace patří do sbalitelného detailu.
4. **Jedna dominantní akce.** Sekundární a destruktivní akce musí být vizuálně
   podřízené a oddělené.
5. **Červená znamená riziko.** Pouze zrušení, blokace, odebrání, archivace nebo
   nevratné kritické odeslání používá danger styl.
6. **Výběr podle názvu, ne podle ID.** Lidé, aktivity, stanice a vstupenky se
   vyhledají nebo vyberou z pojmenovaného seznamu.
7. **Progressive disclosure.** Pokročilá pole, archivované záznamy a technické
   údaje jsou dostupné, ale neruší hlavní rozhodovací tok.
8. **Systém vysvětluje další krok.** Empty, error, stale i disabled stav vždy
   říká proč a co může uživatel udělat.
9. **Žádná falešná aktuálnost.** Použít „Aktuální k 12:04“, ne „živě“, pokud
   kontrakt poskytuje pouze časovaný snapshot.
10. **Bezpečí nesmí působit technicky.** Preview, reason, potvrzení a audit
    zůstávají, ale mluví jazykem dopadu a historie změn.

---

## 6. Obsahový styl a slovník

### 6.1 Pravidla mikrocopy

- Používat krátké věty v aktivním rodě: „Zkontrolujte 3 chybné řádky.“
- Tlačítko popisuje výsledek: „Načíst změny“, „Použít změny“, „Zveřejnit
  změny“, „Odeslat oznámení“, ne obecné „Pokračovat“, pokud je akce známá.
- Nadpis chyby říká problém; text říká příčinu známou uživateli a nápravu.
- Označení required pole je viditelné. Placeholder není label.
- „Důvod změny“ doplnit helperem „Uloží se do historie změn.“
- Technickou referenci zobrazit pouze v `<details><summary>Technické údaje`.
- Mock text nesmí předstírat produkci. Doporučený banner:
  „Ukázková data — změny neovlivní skutečnou akci.“

### 6.2 Zakázané a cílové výrazy

| Nepoužívat v hlavním UI  | Použít                                                           | Poznámka                                                         |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| event                    | akce / ročník                                                    | „Event ID“ jen v technických údajích                             |
| session                  | bod programu / aktivita                                          | „Aktivita“ pro rezervace a tým, „bod programu“ v editoru         |
| support                  | účastníci / vyřešit problém                                      | Název routy je „Účastníci“                                       |
| scope                    | oblast oprávnění / přiřazené aktivity                            | Raw scope kind zůstává interní                                   |
| snapshot v3              | aktuální k 12:04                                                 | Verze jen v technických údajích                                  |
| immutable preview        | náhled změn                                                      | Immutabilita zůstává implementační invariant                     |
| staging diff             | kontrola změn vstupenek                                          | —                                                                |
| apply                    | použít zkontrolované změny                                       | —                                                                |
| audit / auditní stopa    | historie změn                                                    | V doméně a kódu může `audit` zůstat                              |
| auditní důvod            | důvod změny                                                      | Helper vysvětlí uložení do historie                              |
| queue / DLQ              | čekající / neúspěšné úlohy                                       | Raw názvy front se nezobrazí                                     |
| payload / raw            | data požadavku                                                   | V běžném UI ideálně vůbec                                        |
| stale                    | data se mezitím změnila                                          | Nabídnout načtení aktuálního stavu                               |
| canonical / frozen state | aktuální stav uložený v systému                                  | Technický detail skrýt                                           |
| idempotency key          | nezobrazovat                                                     | V chybě vysvětlit, že nevznikne duplicita                        |
| checksum / SHA-256       | kontrolní údaj                                                   | Pouze technické údaje                                            |
| slug                     | adresa stránky                                                   | Automaticky; ruční editace v Pokročilé                           |
| Markdown                 | formátování textu                                                | Uživatel pracuje s toolbar/preview, ne se syntaxí jako konceptem |
| publikační gate          | zveřejnění obsahu                                                | —                                                                |
| asynchronous export      | připravit report ke stažení                                      | —                                                                |
| online-only / P3 wipe    | tato část vyžaduje připojení; při odpojení citlivá data skryjeme | —                                                                |
| F4, P9, CS-ADMIN-01      | nezobrazovat                                                     | Patří jen do dokumentace a testů                                 |

### 6.3 Lokalizace stavů

Tabulka je ověřené minimum pro dnešní obrazovky, ne úplný globální seznam.
Každá route musí před implementací vytvořit exhaustive registry ze svých
importovaných kontraktních enumů; neznámá hodnota se nikdy nesmí vypsat raw.

| Interní hodnota    | Text v UI                     |
| ------------------ | ----------------------------- |
| `draft`            | Rozpracováno                  |
| `published`        | Zveřejněno                    |
| `archived`         | Archivováno                   |
| `active`           | Aktivní                       |
| `claimed`          | Aktivováno                    |
| `not_claimed`      | Zatím neaktivováno            |
| `recovery_pending` | Čeká na obnovení přístupu     |
| `blocked`          | Zablokováno                   |
| `refunded`         | Vráceno                       |
| `reserved`         | Rezervováno                   |
| `cancelled`        | Zrušeno                       |
| `succeeded`        | Provedeno                     |
| `rejected`         | Odmítnuto                     |
| `queued`           | Čeká na zpracování            |
| `already_applied`  | Změna už byla dříve provedena |
| `healthy`          | V pořádku                     |
| `attention`        | Vyžaduje pozornost            |
| `degraded`         | Omezený provoz                |

Mapování je prezentační registry s exhaustivním TypeScript typem na hranici
konkrétního kontraktu. Bezpečný obecný stav je pouze obrana proti nevalidnímu
transportu; zároveň se zapíše technická diagnostika bez PII a obrazovka nesmí
pokračovat v mutaci.

### 6.4 Přesné společné chybové texty

- **Offline:** „Tato část administrace vyžaduje připojení. Citlivá data jsme
  skryli. Zkontrolujte internet a zkuste to znovu.“
- **Vypršelá relace:** „Přihlášení vypršelo. Citlivá rozpracovaná data jsme
  skryli. Přihlaste se znovu a změnu znovu připravte a zkontrolujte.“
- **Bez oprávnění:** „K této části nemáte přístup. Pokud ji potřebujete pro svou
  práci, obraťte se na správce týmu.“
- **Stale verze:** „Data se mezitím změnila. Načtěte aktuální stav a změnu
  zkontrolujte znovu.“
- **Nejistý výsledek:** „Nepodařilo se ověřit, zda byla změna dokončena. Ověřte
  aktuální stav; další kontrola nevytvoří duplicitu.“
- **Obecná chyba:** „Tuto část se nepodařilo načíst. Zkuste to znovu. Pokud
  problém trvá, otevřete Technické údaje a předejte referenci podpoře.“

---

## 7. Cílová informační architektura

### 7.1 Desktop sidebar

Celý admin nejdřív vyžaduje aktivní event membership a serverem potvrzenou
roli `organizer_admin`. Řádková permission je další minimum, ne náhrada tohoto
gate; server ji vždy ověřuje znovu.

| Skupina               | Položka               | Route              | Ikona             | Oprávnění / chování                                                                              |
| --------------------- | --------------------- | ------------------ | ----------------- | ------------------------------------------------------------------------------------------------ |
| —                     | Přehled               | `/admin`           | `LayoutDashboard` | `operations:read`                                                                                |
| OBSAH AKCE            | Program a obsah       | `/admin/obsah`     | `CalendarDays`    | `program:manage`                                                                                 |
| ÚČASTNÍCI A VSTUPENKY | Účastníci             | `/admin/ucastnici` | `Users`           | read s `participant:operational:read`; akce jen s `ticket:any:manage`                            |
| ÚČASTNÍCI A VSTUPENKY | Aktualizace vstupenek | `/admin/vstupenky` | `RefreshCw`       | `ticket:any:manage`; načítá jen přes serverem připojený zdroj, bez file inputu                   |
| PROVOZ AKCE           | Rezervace a kapacity  | `/admin/rezervace` | `Armchair`        | read `reservation:any:read`; změny `agenda:any:override` + `auditedException`                    |
| PROVOZ AKCE           | Oznámení              | `/admin/oznameni`  | `Megaphone`       | `announcement:send`; respektovat feature flag                                                    |
| PROVOZ AKCE           | Odbavení              | `/check-in`        | `ScanLine`        | jen pokud nový serverový context výslovně vrátí `canEnterCheckin`; přepne do samostatného shellu |
| SPRÁVA                | Tým a oprávnění       | `/admin/role`      | `UserCog`         | `role:manage`                                                                                    |
| SPRÁVA                | Reporty               | `/admin/reporty`   | `FileBarChart`    | read `operations:read`; export `personal-data:operational:export` + `auditedException`           |
| SPRÁVA                | Historie změn         | `/admin/audit`     | `History`         | `audit:read`                                                                                     |
| SPRÁVA                | Nastavení akce        | `/admin/nastaveni` | `Settings`        | `event:settings:manage`                                                                          |

Použije se jedna konzistentní sada outline SVG ikon, doporučeně
`lucide-react`: 20 px v navigaci, 16 px v inline akcích, `stroke-width: 1.75`.
Ikona vedle viditelného labelu je `aria-hidden="true"`.

### 7.2 Pravidla navigace

- Chybějící permission znamená, že položka není v navigaci. Vypnutá feature,
  nepovolená fáze nebo read-only archiv je jiný stav: oprávněnému uživateli se
  položka ponechá a cílová obrazovka srozumitelně vysvětlí nedostupnost.
- Skupina se skryje, pokud nemá žádnou dostupnou položku. Přímý deep link bez
  oprávnění stále skončí bezpečným permission stavem bez částečných dat.
- Dnešní `AdminContextResponse` neobsahuje feature flags ani check-in vstupní
  capability; samostatný check-in bootstrap navíc vyjadřuje akce přes
  `actor.permissions.confirm/undo`, ne string `checkin:perform`. Oznámení a
  odkaz do odbavení proto nelze bezpečně odvodit jen z dnešního admin contextu.
  Produkční navigaci těchto položek blokuje `GAP-AUX-CONTEXT-01`.
- `room_operator` se neposílá do admin konzole; jeho kanonická cesta je
  `/host/aktivity`.
- Breadcrumb se ukazuje až od třetí úrovně, například
  `Program a obsah / Upravit bod programu`. Plochá route nemá redundantní
  breadcrumb „Administrace / Reporty“.
- Browser Back obnoví filtr a scroll. PII hledaný výraz, důvod změny a
  potvrzovací dialog se do URL neukládají.
- Povolené ne-PII query parametry: obsahová oblast, den, stav, řazení a opaque
  interní ID. Příklad: `/admin/obsah?oblast=program&edit=<opaque-id>`.
- Legacy `/admin/import`, `/admin/support` a `/admin/provoz` zůstanou jen jako
  redirecty na kanonické routy do doby bezpečného odstranění.

### 7.3 Fáze a kontext akce

Topbar vždy zobrazuje název akce a lokalizovanou fázi:

| Interní fáze      | Label                     |
| ----------------- | ------------------------- |
| `draft`           | Příprava                  |
| `activation_open` | Aktivace otevřena         |
| `live`            | Akce právě probíhá        |
| `ended`           | Akce skončila             |
| `archived`        | Archivováno · pouze čtení |

Baseline pracuje s jednou serverem zvolenou aktuální akcí. Nezobrazovat falešný
event switcher. Pokud vznikne multi-event přepínání, musí mít vlastní schválený
kontrakt, bezpečné vymazání P3 dat a samostatný úkol.

---

## 8. Shell a rozvržení

### 8.1 Desktop wireframe, ≥1024 px

```text
┌──────────────────┬───────────────────────────────────────────────────────────┐
│ BYZON            │ BYZON 2026   [Akce právě probíhá]       Jana Nováková ▾ │ 64
├──────────────────┼───────────────────────────────────────────────────────────┤
│ Přehled          │                                                           │
│                  │ Přehled akce                         [Obnovit přehled]    │
│ OBSAH AKCE       │ Aktuální k 12:04                                         │
│ Program a obsah  │                                                           │
│ ÚČASTNÍCI A      │ ┌──────────────── Co potřebuje pozornost ──────────────┐ │
│ VSTUPENKY        │ │ 1 téměř plná aktivita                 [Zkontrolovat] │ │
│ Účastníci        │ └───────────────────────────────────────────────────────┘ │
│ Aktualizace      │                                                           │
│ vstupenek        │                                                           │
│ PROVOZ AKCE      │                                                           │
│ Rezervace        │ ┌─────────┐ ┌─────────┐ ┌─────────┐                      │
│ Oznámení         │ │Aktivace │ │Program  │ │Odbavení │  stavové karty       │
│ Odbavení         │ └─────────┘ └─────────┘ └─────────┘                      │
│                  │                                                           │
│ SPRÁVA           │ Další úkoly / poslední změny                              │
│ Tým, Reporty…    │                                                           │
└──────────────────┴───────────────────────────────────────────────────────────┘
       256 px                    content max 1280 px, gutter 32 px
```

### 8.2 Mobilní wireframe, <768 px

```text
┌────────────────────────────────┐
│ ☰  BYZON 2026       Jana ▾     │ 56
├────────────────────────────────┤
│ Akce právě probíhá              │
│                                │
│ Přehled akce                   │
│ Aktuální k 12:04    [Obnovit]  │
│                                │
│ CO POTŘEBUJE POZORNOST         │
│ ┌────────────────────────────┐ │
│ │ Téměř plná aktivita       │ │
│ │ Růst bez zkratek          │ │
│ │ [Zkontrolovat kapacitu]   │ │
│ └────────────────────────────┘ │
│                                │
│ Stav přípravy / další karty    │
└────────────────────────────────┘
```

Menu je modal drawer/sheet s inertním pozadím, lockem body scrollu, Escape,
focus trapem a návratem fokusu na trigger. Nesmí být implementováno jako
horizontální pruh ani jako neřízený `<details>`.

### 8.3 Shell pravidla

- Route-aware root chrome nevykreslí na `/admin` veřejný marketingový header ani
  vnější main. Nestačí ho skrýt CSS; nesmí zůstat v accessibility tree.
- Admin shell má přesně jeden skip link na přesně jeden `main`.
- Desktop sidebar je sticky, široký 256 px, se světlým povrchem a pravým
  borderem. Nesmí překrývat obsah ani fokus.
- Topbar je 64 px, mobilní topbar 56 px. Obsah vždy rezervuje jeho prostor.
- Hlavní obsah má max-width 1280 px; běžný text max 72 znaků na řádek.
- Page header obsahuje `h1`, jednověté vysvětlení a nejvýše jednu primární akci.
- Identita používá `actor.displayLabel`; role je dostupná v account menu, ne jako
  technický badge s timezone.
- UUID a timezone jsou v `Nastavení akce / Technické údaje`.
- Demo persona a scénáře jsou development toolbar mimo produkční navigaci.

---

## 9. Vizuální a komponentový systém

### 9.1 Vizuální směr

Světlý, minimální a funkční styl inspirovaný Swiss/enterprise UI: čistá mřížka,
silná typografická hierarchie, minimum stínů a žádné dekorativní glassmorphism,
parallax nebo dashboardové animace. BYZON charakter drží wordmark, švestková
primární barva a střídmé růžové akcenty.

### 9.2 Barevné tokeny

Admin znovu používá sdílené BYZON tokeny; nevytváří druhou modro-navy paletu.

| Token                    | Hodnota               | Použití                                                  |
| ------------------------ | --------------------- | -------------------------------------------------------- |
| `--admin-brand`          | `#F5218E`             | Dekorativní brand akcent; ne běžný text na bílé          |
| `--admin-primary`        | `#B01365`             | Primární CTA; kontrast s bílou přibližně 6.72:1          |
| `--admin-primary-hover`  | `#A80E5E`             | Hover/pressed a focus; kontrast s bílou přibližně 7.27:1 |
| `--admin-ink`            | `#140610`             | Hlavní nadpisy a text s vysokým důrazem                  |
| `--admin-text`           | `#343A46`             | Běžný text                                               |
| `--admin-text-muted`     | `#606A78`             | Sekundární text; na bílé přibližně 5.48:1                |
| `--admin-canvas`         | `#FAF7F9`             | Pozadí pracovní plochy                                   |
| `--admin-surface`        | `#FFFFFF`             | Panely, sidebar, topbar                                  |
| `--admin-surface-brand`  | `#FCEEF5`             | Aktivní navigace, jemný brand panel                      |
| `--admin-border`         | `#DEDEE5`             | Border a divider                                         |
| `--admin-border-strong`  | `#AEB4BD`             | Ovládací prvky                                           |
| `--admin-focus`          | `#A80E5E`             | 3px focus ring s 3px offsetem                            |
| `--admin-success` / soft | `#16784C` / `#E4F5EC` | Úspěch                                                   |
| `--admin-warning` / soft | `#8A4D00` / `#FFF2D8` | Pozornost                                                |
| `--admin-danger` / soft  | `#B42318` / `#FFEBE9` | Destruktivní akce a chyba                                |
| `--admin-info` / soft    | `#315B8A` / `#EAF2FB` | Neutrální informace                                      |

`#F5218E` má na bílé kontrast jen přibližně 3.82:1, proto se nepoužívá pro
normální text ani obrys důležitého ovládacího prvku.

### 9.3 Typografie

- Celé pracovní UI používá Inter. Khand zůstává pouze ve wordmarku nebo velmi
  střídmém brand prvku; ne v tabulkách, formulářích ani velkém page title.
- `h1`: 32/38 px desktop, 28/34 px mobil, 700.
- `h2`: 24/30 px, 700.
- `h3`: 18/24 px, 650–700.
- Body: 16/24 px, 400.
- Label: 14/20 px, 600.
- Small/meta: 14/20 px, 400–600; nic důležitého pod 14 px.
- Čísla v metrikách a datových sloupcích používají tabular figures.
- Globální marketingové `h1` selektory nesmí ovlivnit `[data-admin-root]`.

### 9.4 Prostor, povrchy a motion

- Spacing scale: 4, 8, 12, 16, 24, 32, 40 a 48 px.
- Radius: 10 px input/button, 14 px panel, 16 px dialog; pill pouze pro status.
- Shadow: malý jen pro overlay/sticky bar; běžné karty odděluje border a prostor.
- Motion tokeny: 150 ms mikrofeedback, 220 ms drawer/dialog. Pouze opacity a
  transform. `prefers-reduced-motion` odstraní nepodstatný pohyb.
- Žádná animace nesmí blokovat vstup nebo měnit správnost stavu.

### 9.5 Závazné komponenty

| Komponenta              | Kontrakt                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `AdminPageHeader`       | Jeden `h1`, lead, phase/context meta, slot pro jednu primární akci                           |
| `AdminNavGroup`         | Label skupiny, permission-filtered items, ikona + text, `aria-current`                       |
| `AdminStatusBadge`      | Ikona + text; význam nikdy jen barvou                                                        |
| `AdminAttentionList`    | Řazení danger → warning → info, první položka má dominantní CTA                              |
| `AdminMetricCard`       | Label, hodnota, lidský detail, aktualizováno; celá karta není klikací bez jasného affordance |
| `AdminDataTable`        | Caption, sticky header, locale formát, sort s `aria-sort`, row action menu                   |
| `AdminMobileCardList`   | Stejná data a akce jako tabulka, bez duplicitní accessibility tree                           |
| `AdminFilterBar`        | Aktivní filtry jako wrapující chips, „Vymazat filtry“, PII mimo URL                          |
| `AdminFormSection`      | `fieldset/legend` pro související pole, helper a inline chyby                                |
| `AdminErrorSummary`     | Focus po submitu, seznam odkazů na invalidní pole, zároveň inline chyby                      |
| `AdminTechnicalDetails` | Sbalitelné request ID, verze, checksum; zavřené defaultně                                    |
| `AdminUnsavedBar`       | Sticky pouze při změnách: „Máte neuložené změny“, Uložit/Zahodit                             |
| `AdminConfirmDialog`    | Dopad v lidské řeči, focus trap/restore; checkbox jen u nevratné/high-impact akce            |
| `AdminEmptyState`       | Co chybí, proč na tom záleží, jeden další krok                                               |
| `AdminSkeleton`         | Rezervuje finální layout a nezobrazuje falešné hodnoty                                       |

### 9.6 Hierarchie tlačítek

- **Primary / brand:** běžný hlavní krok, například „Uložit změny“.
- **Secondary:** alternativní krok, například „Zkontrolovat náhled“.
- **Quiet:** drobné řádkové akce, filtry a „Technické údaje“.
- **Danger:** blokovat vstupenku, zrušit rezervaci, odebrat roli, archivovat a
  finálně odeslat kritické oznámení.
- Zveřejnění obsahu a použití zkontrolované dávky vstupenek jsou high-impact,
  ale ne automaticky danger; používají primary + jasné potvrzení dopadu.

---

## 10. Specifikace obrazovek

### 10.0 Společná skladba routy

Každá routa používá v tomto pořadí:

1. `AdminPageHeader` — název úkolu, stručný popis, aktuálnost a jedna primární
   akce.
2. Stav vyžadující pozornost nebo lokální success/error feedback.
3. Filtry či kroky flow.
4. Hlavní seznam, formulář nebo detail.
5. Sbalitelné technické údaje, pouze pokud existují.

| Route              | `h1`                  | Metadata title                              | Primární výsledek                         |
| ------------------ | --------------------- | ------------------------------------------- | ----------------------------------------- |
| `/admin`           | Přehled akce          | Přehled akce \| Administrace BYZON          | Najít nejdůležitější další krok           |
| `/admin/obsah`     | Program a obsah       | Program a obsah \| Administrace BYZON       | Upravit a zveřejnit obsah                 |
| `/admin/ucastnici` | Účastníci             | Účastníci \| Administrace BYZON             | Najít člověka a vyřešit problém           |
| `/admin/vstupenky` | Aktualizace vstupenek | Aktualizace vstupenek \| Administrace BYZON | Načíst, zkontrolovat a použít změny       |
| `/admin/rezervace` | Rezervace a kapacity  | Rezervace a kapacity \| Administrace BYZON  | Vyřešit kapacitní výjimku                 |
| `/admin/oznameni`  | Oznámení              | Oznámení \| Administrace BYZON              | Poslat kritickou informaci správným lidem |
| `/admin/role`      | Tým a oprávnění       | Tým a oprávnění \| Administrace BYZON       | Přidělit nebo odebrat omezenou roli       |
| `/admin/reporty`   | Reporty               | Reporty \| Administrace BYZON               | Připravit a stáhnout report               |
| `/admin/audit`     | Historie změn         | Historie změn \| Administrace BYZON         | Dohledat kdo, kdy a co změnil             |
| `/admin/nastaveni` | Nastavení akce        | Nastavení akce \| Administrace BYZON        | Bezpečně změnit provozní pravidla         |

### 10.1 Přehled akce — `/admin`

**Uživatelský výsledek:** do pěti sekund poznat stav akce a otevřít
nejdůležitější problém.

**Header**

- `h1`: „Přehled akce“
- Lead: název akce, lokalizovaná fáze a „Aktuální k {HH:MM}“.
- Sekundární akce: „Obnovit přehled“. Není primární, pokud existuje problém.

**Pořadí sekcí**

1. **Co potřebuje pozornost** — jen metriky ve stavu `degraded` nebo
   `attention`, seřazené v tomto pořadí. První má jedinou dominantní CTA.
2. **Stav akce** — šest konzistentních karet Aktivace, Vstupenky, Program,
   Odbavení, Rezervace a Oznámení.
3. **Další úkoly** — phase-aware kroky, ne tři pevné technické karty.
4. **Technický provoz** — sbalený a zobrazený pouze při čekající nebo neúspěšné
   úloze; raw queue tabulka se neukazuje.

**Mapování metrik na permission-safe CTA**

| `metric.id`    | CTA pouze pokud                                                                                       | Cílová route / CTA                                    | Bez splněné podmínky                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `activation`   | server dodá řešitelný, ne-PII agregovaný filtr/deep link                                              | `/admin/ucastnici` · „Zkontrolovat neaktivované“      | stavová karta bez odkazu; obyčejné hledání konkrétní osoby problém agregace neřeší |
| `import`       | actor má `ticket:any:manage` a server dodá řešitelný stav zdrojové dávky                              | `/admin/vstupenky` · „Zkontrolovat změny vstupenek“   | karta bez CTA                                                                      |
| `content`      | actor má `program:manage`                                                                             | `/admin/obsah` · „Zkontrolovat obsah“                 | karta se v attention seznamu nezobrazí                                             |
| `checkin`      | admin context vrátí explicitní `canEnterCheckin` a check-in režim si následně ověří vlastní bootstrap | `/check-in` · „Přejít do odbavení“                    | „Odbavení vyžaduje samostatné oprávnění“ bez odkazu                                |
| `reservation`  | actor má `reservation:any:read`; mutation CTA navíc `agenda:any:override` + `auditedException`        | `/admin/rezervace` · „Zkontrolovat kapacitu“          | read-only detail nebo karta bez CTA                                                |
| `notification` | actor má `announcement:send`, feature je zapnutá a server dodá řešitelný status/deep-link target      | `/admin/oznameni` · CTA odpovídá konkrétnímu problému | feature-off stav nebo karta bez CTA; compose flow není delivery detail             |

Mapování je exhaustivní podle `adminOperationsMetricIdSchema`; text nebo URL se
neskládá z dat poslaných serverem. Chybějící akční kontext pro activation,
check-in a notification vlastní `GAP-AUX-DASH-ACTION-01` a
`GAP-AUX-CONTEXT-01`; do jejich uzavření se z metriky nesmí vyrobit nefunkční
CTA.

**Technický provoz v lidské řeči**

- `default` → „Zpracování na pozadí“
- `notifications` → „Odesílání oznámení“
- `exports` → „Příprava reportů“
- `ready` → „čeká“; `processing` → „právě se zpracovává“; `failed` →
  „nepodařilo se“

**Speciální stavy**

- Empty: „Přehled zatím nemá data. Začněte načtením změn vstupenek nebo
  přípravou programu.“ Akce se volí podle permission.
- Všechno v pořádku: klidný success panel „Teď není potřeba žádný zásah.“
- Archived: všechny karty read-only; žádné CTA k mutaci.
- Nesmí vzniknout graf bez časové řady. Současný kontrakt poskytuje stavové
  karty, ne analytiku.

### 10.2 Program a obsah — `/admin/obsah`

**Uživatelský výsledek:** nejdřív vidět existující obsah, pak upravit jednu
pojmenovanou věc a nakonec zveřejnit srozumitelný seznam změn.

**Lokální navigace**

| Pohled pro uživatele | Interní zdroje     |
| -------------------- | ------------------ |
| Program              | `sessions`, `days` |
| Řečníci              | `speakers`         |
| Místa a místnosti    | `venues`, `rooms`  |
| Partneři             | `partners`         |
| Praktické informace  | `pages`, `faqs`    |

Na desktopu jsou pohledy sekundární tabs pod page headerem. Na mobilu se
zobrazí `<select>` nebo horizontálně ne-scrollující disclosure menu se stejnými
labely. Aktivní pohled lze uložit do ne-PII query parametru `oblast`.

Sloučené pohledy mají druhou, explicitní volbu typu; CTA nikdy není neurčité
„Přidat…“:

| Pohled              | Aktivní typ   | Primary CTA         |
| ------------------- | ------------- | ------------------- |
| Program             | Body programu | Přidat bod programu |
| Program             | Dny akce      | Přidat den          |
| Místa a místnosti   | Místa         | Přidat místo        |
| Místa a místnosti   | Místnosti     | Přidat místnost     |
| Praktické informace | Stránky       | Přidat stránku      |
| Praktické informace | Časté dotazy  | Přidat otázku       |

Volba typu je segmented control/list na desktopu a nativní select na mobilu;
má vlastní label a zachovává se v allowlisted `typ` parametru.

**List-first rozvržení**

```text
┌──────────────────── seznam / filtry ────────────────────┐
│ Program                    [Přidat bod programu]        │
│ Pátek 12. 9.   Místnost A   10:00  Růst bez zkratek     │
│ ...                                                    │
└─────────────────────────────────────────────────────────┘
                              klik → detail/drawer nebo detail view
```

- Prázdný formulář není otevřený nad seznamem.
- Desktop může použít master-detail 40/60; mobil přejde do samostatného detailu
  a Browser Back vrátí filtr i scroll.
- Primární akce používá přesný label z tabulky výše.
- Archivované položky jsou ve filtru „Archiv“, read-only a vizuálně odlišené.

**Pole a jejich lidské labely**

- `slug` se vytvoří automaticky z názvu; ruční „Adresa stránky“ je v
  „Pokročilé“.
- `sortOrder` se ovládá přes „Posunout nahoru/dolů“ nebo přístupné pořadí;
  případný drag má povinnou keyboard/button alternativu.
- `mapQuery` → „Místo pro mapu“.
- Speaker `jobTitle` → „Pozice nebo role“; nikdy obecné „Text“.
- `bodyMarkdown` → „Obsah stránky“; `answerMarkdown` → „Odpověď“;
  `descriptionMarkdown` → „Popis partnera“.
- Řečníci u bodu programu používají hledaný multi-select s checkboxy a chips,
  ne nativní multi-select vyžadující modifikační klávesu.
- Stav: „Rozpracováno“, „Zveřejněno“, případně „Zrušeno“.
- Foto řečníka a logo partnera se zobrazí jen přes autorizovaný event-scoped
  asset read/resolver. Dnešní admin content port asset ID odstraňuje a resolver
  nemá; do uzavření `GAP-AUX-ASSET-01` se proto zobrazí neutrální placeholder,
  ne domnělý náhled ani raw ID. Nahrání nebo výměna vyžaduje stejný schválený
  kontrakt, náhled, formát/velikost, odstranění a práva.

**Zveřejnění**

1. Klidový stav lze označit „Všechny uložené změny jsou zveřejněné“ a přidat
   „Naposledy {datum a čas}“ **jen**, pokud autoritativní admin DTO dodá
   published revision/time a porovnání s draftem.
2. Po změně lze použít stavový pruh „{n} změn není zveřejněných“ jen z
   autoritativního change summary. Dnešní port poskytuje candidate item count,
   ne počet změn; bezpečný mezistav je „Obsah má změny ke kontrole“.
3. Náhled ukáže lidské názvy přidaných, upravených, zrušených a archivovaných
   položek, zejména významné změny času/místnosti programu.
4. Potvrzení: „Zveřejnit {n} změn?“ + dopad na aplikaci/web.
5. Success: „Změny byly zveřejněné {čas}.“ + odkaz „Zobrazit publikovaný
   obsah“, pokud existuje bezpečná cílová route.

Verze, checksum a interní ID jsou pouze v `Technické údaje`. Pokud kontrakt
vrací jen ID významně změněných bodů, musí klient názvy bezpečně spojit z
aktuálního event-scoped obsahu nebo se kontrakt rozšíří; raw ID není přijatelný
fallback. `GAP-AUX-CONTENT-01` proto pokrývá zároveň human-readable diff,
published timestamp/revision i autoritativní počet změn; žádná z hodnot se
nesmí dopočítat z neúplného klientského seznamu.

**Dirty a conflict**

- Při neuloženém formuláři se publikace vypne a vysvětlí: „Nejdřív uložte nebo
  zahoďte rozpracované změny.“
- Odchod, změna pohledu, osoby nebo event scope používá stejný dirty guard.
- Stale: lokální formulář lze zkopírovat, ale další zápis je blokovaný do načtení
  aktuální verze. Primární recovery je „Načíst aktuální stav“.

### 10.3 Účastníci — `/admin/ucastnici`

**Uživatelský výsledek:** najít konkrétního člověka a provést jen akci, která je
pro jeho aktuální stav dostupná.

**Výchozí stav**

- Search label: „Jméno, e-mail nebo reference vstupenky“.
- Helper: „Zadejte alespoň 2 znaky. Vyhledávání se neukládá do historie.“
- Primární CTA: „Vyhledat účastníka“.
- Query ani výsledek se nedostane do URL.

**Výsledky**

- Desktop: kompaktní seznam jméno, maskovaný kontakt, poslední znaky reference,
  stav vstupenky a stav aktivace.
- Mobil: jedna karta na výsledek.
- Backendové enumy se vždy lokalizují přes registry z §6.3.
- 0 výsledků: „Nikoho jsme nenašli. Zkontrolujte zápis nebo zkuste jiný údaj.“
- Více výsledků: vysvětlit „Našli jsme více lidí. Vyberte správný záznam podle
  maskovaného kontaktu nebo reference.“

**Detail a akce**

- `h2`: jméno; souhrn stavu vstupenky a přístupu.
- CTA: „Vyřešit problém“ otevře pouze serverem povolené akce.
- Contract actions jsou `resend`, `reassign`, `block`, `reactivate` a
  `transfer`; UI ukáže jen serverem vrácené a produktově vysvětlené akce.
- Reassign/transfer vyhledá cílovou vstupenku podle pojmenované reference a
  zobrazí bezpečný výsledek; nikdy nevyžaduje vložení UUID.
- Produkční transfer nebo storno vstupenky, které zasáhne existující rezervace,
  zůstává fail-closed do rozhodnutí `BLOCKER-RES-03`; klient nesmí sám
  rezervace zachovat ani zrušit.
- `reassign` a `transfer` dnes nemají autoritativně popsaný rozdíl dopadu. Do
  uzavření `GAP-AUX-SUPPORT-ACTIONS-01` se v produkčním UI nesmí zobrazit jako
  dvě téměř synonymní volby. Rozhodnutí musí pro každou akci určit „Kdy
  použít“, stav původní/cílové vstupenky a držitele, dopad na přístup a
  rezervace, přesný confirm, success a recovery text.
- „Důvod změny“ je required tam, kde jej vyžaduje kontrakt, s helperem o
  historii.
- Po úspěchu: konkrétní věta, například „Aktivační výzva byla znovu odeslána.“
  - „Zobrazit v historii změn“; audit UUID jen v technických údajích.

Read-only permission zobrazí bezpečný detail bez mutačního formuláře a bez
neaktivních tlačítek, která by slibovala nedostupnou akci.

### 10.4 Aktualizace vstupenek — `/admin/vstupenky`

**Uživatelský výsledek:** načíst ze serverem připojeného zdroje aktuální změny
vstupenek, pochopit chyby a použít pouze přesně zkontrolovanou dávku.

**Zdroj a výchozí stav**

- Obrazovka nemá file input, drag-and-drop, šablonu ani pole s cestou k
  souboru. Browser neposílá CSV/XLSX ani jiný uživatelsky vybraný soubor.
- Panel „Zdroj vstupenek“ ukáže lidský název připojeného zdroje, čas poslední
  kontroly a poslední výsledek pouze tehdy, pokud je autoritativně vrací server.
- Primární CTA je podle současné implementace „Načíst ze SimpleShopu“. Spustí
  serverové read-only získání a kanonickou validaci; samo o sobě nezmění
  produkční účastníky ani vstupenky.
- Přístupové údaje, vendorové sloupce, raw ticket kódy ani nastavení integrace
  se v této obrazovce nezobrazují a nezadávají.

**Čtyřkrokový stepper**

1. **Načíst ze SimpleShopu** — server použije nakonfigurovaný
   `SimpleShopTicketSourceAdapter` a vrátí kanonický stav nebo srozumitelnou
   chybu zdroje.
2. **Zkontrolovat změny** — souhrn a záznamy se změnami/chybami.
3. **Potvrdit změny** — lidský dopad, důvod změny a finální potvrzení.
4. **Výsledek** — počty provedených změn, chyby a další krok.

Stepper používá text i stav, dovolí návrat před provedením a načtení náhledu
nezapisuje nic do produkčních ticketů. Způsob dopravy dat mezi zdrojem a
serverem je implementační detail; admin UI pracuje jen s kanonickým preview.

**Souhrn kontroly**

| Interní stav     | Label           | Chování               |
| ---------------- | --------------- | --------------------- |
| `new`            | Nové vstupenky  | Budou přidány         |
| `unchanged`      | Beze změny      | Zobrazeno sekundárně  |
| `status_changed` | Změněný stav    | Ukázat původní → nový |
| `conflict`       | Vyžaduje opravu | Blokuje použití dávky |
| `unknown`        | Nerozpoznáno    | Blokuje použití dávky |

- Pokud existují chyby, filtr „Vyžaduje opravu“ je první. Text vysvětlí, že
  problematický záznam je potřeba opravit ve zdroji prodeje; CTA je „Načíst
  změny znovu“, ne nevysvětlené disabled „Použít změny“.
- Tabulka: Záznam, Účastník, Co se změní, Výsledek kontroly, Poznámka. Interní
  pořadí zdroje se může ukázat jen jako pomocná reference, ne jako „řádek
  souboru“.
- Mobil používá karty; žádný page-level horizontální scroll.
- „Stáhnout seznam chyb“ lze nabídnout jako explicitní P3 download, pokud je
  implementovaný bezpečný export; není to náhradní vstupní soubor.

**Potvrzení**

- Nadpis: „Použít tyto změny vstupenek?“
- Dopad: „Přidá {n} vstupenek, změní stav {n}, {n} zůstane beze změny.“
- Pole: „Důvod aktualizace“; helper „Uloží se do historie změn.“
- CTA je „Použít změny“, ne `apply`. Danger styl jen pokud preview skutečně
  obsahuje destruktivní nebo stavově rizikovou změnu.
- Success: „Změny vstupenek byly použity.“ + souhrn a „Zobrazit účastníky“.

**Speciální stavy**

- Zdroj není připojený nebo přístup vypršel: unavailable stav bez falešného
  načítání, s bezpečným dalším krokem určeným serverem.
- Zdroj je dočasně nedostupný: zachovat poslední bezpečný čas kontroly, nabídnout
  „Zkusit načíst znovu“ a nepředstírat aktuálnost.
- Beze změn: „Od poslední kontroly nejsou žádné nové změny.“
- Stale preview: zneplatnit potvrzení a načíst aktuální změny znovu.
- Nejasný výsledek apply: ověřit kanonický stav se stejnou request identitou;
  nikdy slepě nezaložit novou dávku.

Source run ID, preview ID/verze a audit reference jsou pouze technické údaje.
Název souboru, MIME, velikost a hash do cílového kontraktu ani UI nepatří.
Produkční `P4-02` na baseline `bfead32` již implementuje server-only,
autorizovaný a rate-limitovaný SimpleShop preview bez file uploadu. Kroky
potvrzení a výsledku se v produkci nesmějí zpřístupnit před dokončením `P4-03`;
historická file/apply větev smí zůstat pouze jako nezaměnitelná testovací
fixture, ne jako paralelní produkční cesta.

### 10.5 Rezervace a kapacity — `/admin/rezervace`

**Uživatelský výsledek:** nejdřív najít aktivitu s problémem, potom odděleně
řešit její kapacitu nebo rezervaci konkrétního účastníka.

**Výchozí přehled aktivit**

- Summary: počet plných, téměř plných a bezproblémových aktivit.
- Filtry: den, aktivita, kapacitní stav. Hledání reference účastníka zůstává
  lokální a mimo URL.
- Řádek: název aktivity, čas/místnost pokud data existují, „65 z 80 míst“,
  textový stav a progress bar s přístupným labelem.
- Řazení: plné → téměř plné → ostatní.

**Detail aktivity**

- Hlavní karta kapacity: obsazeno/celkem, čekající pokud kontrakt poskytne,
  „Upravit kapacitu“.
- Seznam rezervací: bezpečná maskovaná reference, stav, kontextová akce.
  Produkční DTO musí maskování smluvně validovat; dnešní obecný
  `participantReference` tuto garanci nemá a je součástí `GAP-AUX-RES-01`.
- „Změnit kapacitu“ a „Zrušit rezervaci účastníka“ jsou dva oddělené formuláře.
- Snížení kapacity pod potvrzený počet je podle dnešního kontraktu vždy
  odmítnuté. UI zobrazí minimum rovné počtu rezervací a server je stále
  autorita; žádnou displacement/high-impact větev nevymýšlí bez samostatného
  atomického kontraktu.
- Zrušení rezervace používá danger potvrzení s člověkem, aktivitou, dopadem a
  důvodem změny.

Současný DTO je reservation-level a připojuje kapacitu k jednotlivému záznamu.
Plný target potřebuje session-level agregaci a stránkování; do její integrace
nesmí UI předstírat kompletní globální kapacitní přehled. Mock lze připravit až
nad schváleným kontraktem v §13.

Edge case rezervací při transferu nebo stornu vstupenky zůstává fail-closed do
`BLOCKER-RES-03`; výchozí chování z hlavního plánu není produktové rozhodnutí a
nesmí se nasadit bez potvrzení.

### 10.6 Oznámení — `/admin/oznameni`

**Uživatelský výsledek:** poslat jednu kritickou informaci jasně vymezenému
publiku a vidět stav odeslání.

**Výchozí obrazovka**

- Priority A začíná přímo prázdným compose flow. Současný kontrakt nemá seznam
  historie ani delivery report, takže je UI neslibuje.
- Pokud je feature vypnutá, oprávněný uživatel uvidí vysvětlený unavailable
  stav bez formuláře; chybějící permission položku skryje.

**Flow**

1. **Text** — Nadpis a zpráva; viditelné počítadlo, náhled na participant kartu.
2. **Komu** — „Všem účastníkům“ nebo „Účastníkům jedné aktivity“. Kontrakt
   dovoluje event **nebo právě jednu session**. Aktivita se vyhledá podle názvu,
   času a místnosti, ne podle ID.
3. **Kontrola** — přesný text, lidský název publika, počet příjemců a počet
   vyloučených. Preview dnes neposkytuje důvody vyloučení, proto UI zobrazí
   obecnou větu a nevymýšlí rozpad podle příčin.
4. **Odeslání** — danger potvrzení, protože kritické oznámení nelze upravit.

Závažnost je v Priority A vždy kritická; nenabízí se zbytečný dropdown.
`Důvod odeslání` se uloží do historie. Dirty guard chrání text, publikum i
důvod. Editace po vytvoření náhledu náhled zneplatní a vyžádá novou kontrolu.

`CS-ANN-01` přijímá u session audience pouze `sessionId`; neposkytuje options
ani lidský label. `AdminContext.assignedSessions` není náhrada, protože je
assignment-scoped a omezený na 30 položek. Picker proto musí použít zvláštní
autorizovaný event-scoped zdroj povolených announcement targetů, nebo výslovně
schválený reuse publikovaného programu s `program:published:read`. Server při
preview i send znovu ověří povolenou session. Rozhodnutí a kontrakt vlastní
`GAP-AUX-ANN-TARGET-01`; do jeho uzavření se session picker nesmí integrovat s
neúplnými či ručně zadanými daty.

**Po odeslání**

- Pro `sent`: „Oznámení bylo odesláno {n} příjemcům.“
- Pro `already_sent`: „Toto oznámení už bylo odesláno {n} příjemcům. Další
  kopie nevznikla.“
- Delivery počty ani historie se v Priority A 2026 nezobrazují; pokročilý
  reporting je vyřazen rozhodnutím `DEC-AUX-011`. Preview recipient count není
  delivery report.
- Audit ID a preview version jsou jen technické údaje.

### 10.7 Tým a oprávnění — `/admin/role`

**Uživatelský výsledek:** vybrat člověka, srozumitelnou roli a konkrétní oblast,
potom oprávnění později bezpečně odebrat.

**Seznam**

- Sloupce: Člen týmu, Role, Oblast, Stav, Platnost/začátek pokud existuje, Akce.
- Filtry: role, stav, aktivita/stanice.
- Primární CTA: „Přiřadit roli“; flow vybírá existující osobu, nevytváří ani
  nezve nového člena.
- Empty: „Nikdo zatím nemá přidělenou provozní roli.“

**Přiřazení role**

1. Vyhledat existující osobu podle jména nebo ověřeného kontaktu.
2. Vybrat roli s popisem dopadu:
   - „Obsluha odbavení“ — odbavuje účastníky na přiděleném stanovišti;
   - „Moderátor“ — má pouze serverem schválená oprávnění k přiděleným bodům
     programu; konkrétní akce popisuje autoritativní role policy;
   - „Vedoucí aktivity“ — vidí read-only seznam rezervovaných u svých aktivit.
3. Vybrat pojmenovaný rozsah: celá akce, stanoviště nebo konkrétní aktivita
   podle povoleného typu role.
4. Zkontrolovat shrnutí a přidat důvod změny.

`organizer_admin` není součástí současného grant kontraktu a nesmí se tiše
přidat do formuláře. Odebírání používá row action „Odebrat oprávnění“ a danger
potvrzení. Pokud server vrátí explicitní self-lockout nebo last-administrator
problem branch, UI jej přeloží do lidské chyby; klient tuto podmínku neodhaduje.

Současné API nemá list/search/scope-options průchod; plná obrazovka je blokovaná
gapem `GAP-AUX-ROLE-01` v §13. Ruční UUID pole není povolený interim UX.

### 10.8 Reporty — `/admin/reporty`

**Uživatelský výsledek:** zvolit srozumitelný report, období a stáhnout hotový
soubor.

**Typy reportů**

- Souhrn účastníků
- Souhrn odbavení
- Souhrn rezervací
- Historie změn

Každý typ je karta s jednou větou o obsahu a citlivosti. Po výběru se zobrazí
období, výchozí CSV a „Pokročilé / JSON“ jen pokud to uživatel skutečně
potřebuje. Required „Důvod vytvoření reportu“ vysvětlí, že report může obsahovat
provozní osobní data.

Primární CTA: „Vytvořit report“. Pending: „Report připravujeme. Na této stránce
můžete pokračovat v práci.“

**Historie exportů**

- Název, období, kdo vytvořil, stav, vytvořeno, expiruje, „Stáhnout“.
- Stavy: Připravuje se, Připraven ke stažení, Nepodařilo se, Odkaz vypršel.
- Export ID jen v technických údajích.

Současný kontrakt končí stavem `queued`; job list, ready/download a expiry jsou
blokované `GAP-AUX-EXPORT-01`.

### 10.9 Historie změn — `/admin/audit`

**Uživatelský výsledek:** odpovědět na „kdo, kdy, co a proč změnil“ bez čtení
raw action kódu.

**Filtry**

- Období (`from/to`), oblast/kategorie a lokalizovaná akce. Request ID je v
  „Pokročilé“.
- Uživatel a výsledek až po rozšíření serverového query v
  `GAP-AUX-AUDIT-01`; filtrovat jen aktuální klientskou stránku je zakázané.
- Filtry bez PII mohou být v URL. Důvod ani actor label se do URL nedává.

**Tabulka / mobilní karty**

- Datum a čas, Kdo, Oblast, Změna, Cíl, Výsledek.
- Kliknutí otevře detail: lidský důvod, resulting version a informace
  „Citlivé údaje byly skryty“, pokud `redacted=true`.
- Kategorie: Účastníci, Aktualizace vstupenek, Oznámení, Tým, Rezervace,
  Nastavení, Reporty.
- Action registry překládá například `update_settings` → „Upravil nastavení
  akce“, `cancel_reservation` → „Zrušil rezervaci“.
- Stránkování musí využít `pageInfo`; current UI nesmí načíst jen první stránku
  a tvářit se jako úplná historie.

Empty: „Zadaným filtrům neodpovídá žádná změna.“ + „Vymazat filtry“.

### 10.10 Nastavení akce — `/admin/nastaveni`

**Uživatelský výsledek:** pochopit dopad provozních pravidel před uložením.

**Sekce**

1. **Registrace** — radio cards:
   - „Registrace je otevřená“ (`open`)
   - „Pouze pro pozvané“ (`invite_only`)
   - „Registrace je uzavřená“ (`closed`)
2. **Rezervace** — switch „Účastníci mohou měnit své rezervace“ s vysvětlením
   dopadu.
3. **Zpráva při problému** — textarea a vedle ní náhled. Finální label a místo,
   kde se text účastníkovi zobrazí, musí potvrdit `GAP-AUX-SETTINGS-01`; dnešní
   kód nemá dohledaného konzumenta `supportMessage`.
4. **Technické údaje** — event UUID, timezone a current version; sbalené.

Obrazovka začíná v read režimu a má nejvýše jednu primary akci „Upravit
nastavení“. Ta přepne hodnoty do formuláře a fokus přesune na první sekci. Po
změně se objeví `AdminUnsavedBar` s primary „Uložit změny“ a quiet „Zahodit“.
Důvod změny je u save kroku, ne jako trvale dominantní technické pole. Běžné
uložení není danger.

Archived event: jasný banner „Archivovaná akce je pouze ke čtení“; hodnoty jsou
read-only, ne jen šedivě disabled.

---

## 11. Sdílené stavy a feedback

| Stav            | Povinné chování                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading         | Skeleton rezervuje finální layout; nav a kontext zůstávají stabilní; žádná falešná čísla                                                                 |
| Empty           | Vysvětlí, proč nic není, a nabídne právě jeden permission-safe další krok                                                                                |
| Validation      | Konkrétní inline chyba + focusovatelný summary s odkazy; `aria-invalid` jen na skutečně chybném poli                                                     |
| Read error      | Lidská chyba, „Zkusit znovu“ a sbalené technické údaje s request ID                                                                                      |
| Permission      | Žádná částečná P3 data; cesta „Zpět na přehled“ a text z §6.4                                                                                            |
| Offline         | Citlivá data se skryjí; žádné admin mutace ani příslib fronty; text z §6.4                                                                               |
| Stale           | Zneplatnit potvrzení, zachovat bezpečný draft pro kontrolu a nabídnout načtení aktuálního stavu                                                          |
| Pending         | Zamknout dvojitý submit; zobrazit konkrétní probíhající úkol a neblokovat nesouvisející navigaci, pokud je bezpečná                                      |
| Success         | Persistentní lokální shrnutí výsledku + polite live region + cesta do historie, pokud existuje                                                           |
| Ambiguous       | Ověřit stav nebo zopakovat přesně stejný idempotentní request pod lidským CTA; nikdy nový slepý pokus                                                    |
| Session expired | Vymazat P3 data, reason, preview i confirmation; přihlásit se se safe `returnTo` a znovu načíst jen bezpečný canonical read, potom změnu znovu připravit |
| Archived        | Semantický read-only stav s vysvětlením, ne disabled formulář vydávající se za editaci                                                                   |

### 11.1 Fokus a oznámení

- Po klientské navigaci přesunout fokus na `main`/page heading právě jednou.
- Po validačním submitu přesunout fokus na error summary, ne při každém blur.
- Toast nesmí krást fokus; používá `aria-live="polite"`. Kritická chyba je
  persistentní inline alert.
- Drawer, dialog a side sheet musí mít focus trap, Escape, viditelné zavření a
  focus restore.
- Sticky topbar/save bar nesmí zakrýt focusovaný prvek při 200% zoomu.

### 11.2 Potvrzení a dirty guard

- Confirm bez checkboxu: publikace, použití validní dávky vstupenek, změna
  nastavení nebo kapacity s jasně zobrazeným dopadem.
- Confirm s checkboxem: nevratné kritické odeslání, blokace/transfer, zrušení
  rezervace, odebrání role a archivace.
- Dirty guard: obsah, oznámení, rozepsaný důvod/potvrzení aktualizace vstupenek,
  role a nastavení. Browser Back, link v aplikaci i změna scope musí projít
  stejným pravidlem.
- Tlačítko `disabled` musí mít vedle sebe viditelný důvod; kde je to vhodné,
  validovat až po submitu místo nevysvětleného disabled stavu.

---

## 12. Responzivita, přístupnost a výkon

### 12.1 Breakpointy

| Rozsah        | Layout                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| `<768 px`     | Mobilní topbar + modal drawer, 16px gutter, jeden sloupec, detail na samostatné vrstvě/route |
| `768–1023 px` | Tablet topbar + drawer, 24px gutter, dvousloupec jen pro krátké karty/form části             |
| `≥1024 px`    | 256px sticky sidebar, 64px topbar, 32px gutter, max content 1280px                           |

- Na mobilu se tabulka změní na karty s totožnými daty a akcemi; nesmí jen
  skrýt důležité sloupce.
- Action bar na mobilu může být sticky bottom pouze se safe-area paddingem a
  dostatečným spodním insetem obsahu.
- Nevytvářet nested vertical scroll regiony. Horizontální scroll je povolený
  pouze uvnitř explicitní datové tabulky na desktopu; mobil má karty.
- Filtrační chips se zalamují; nic se neořízne bez přístupného disclosure.

### 12.2 Povinná accessibility matice

- 0 serious/critical axe na shellu i každé hotové routě, ne jen izolované
  komponentě.
- Právě jeden `main`, jeden skip link a logická h1→h2→h3 hierarchie.
- Keyboard-only: nav, filtry, tabulka/karty, formulář, dialog, drawer, detail a
  zveřejnění.
- Focus ring min. 3:1 proti sousedním barvám; body text min. 4.5:1.
- Stav obsahuje text a případně ikonu, nikdy jen červenou/zelenou.
- 200% zoom bez ztráty obsahu či překrytí fokusu.
- Reduced motion; bez animace je konečný stav ihned použitelný.
- Drag/reorder má tlačítka a klávesnicovou alternativu.
- Ověřit screen-reader smoke alespoň pro navigaci, error summary, dialog,
  status update a tabulku.

### 12.3 Výkon

- Route-level `loading.tsx` a `error.tsx` pro stabilní shell a obnovu chyb.
- Admin funkce se dělí po routách; po splitu se nesmí znovu vytvořit jeden
  několikatisícový client bundle.
- Neomezené/browsable P3 seznamy používají serverové cursor/page stránkování a
  P3 data se nenačítají předem do skrytých tabů. Contract-bounded payloady se
  svévolně nemění: kanonický preview aktualizace vstupenek vrací celý ověřený
  batch nejvýše 500 záznamů a support search nejvýše 5 výsledků bez cursoru.
  Oba se měří na kontraktním maximu. Virtualizace je povolená jen po měření a
  samostatném keyboard/screen-reader ověření.
- Skeleton a async badge rezervují prostor; CLS musí být <0.1 na 320, 768 a
  1280 px.
- Search se debounce pouze po explicitním kontraktu; submit search zůstává
  dostupný a předvídatelný.
- `AUX-12C` uloží před změnou Next bundle baseline. Každý route slice změří
  `next build` route output a gzip diff; přírůstek >20 kB gzip pro danou route
  nebo >10 % shared admin chunku vyžaduje zapsané rozhodnutí a lazy-load plán.
- Playwright trace se syntetickou maximální stránkou kontraktu (100 auditních
  nebo rezervačních záznamů, 50 obsahových položek) nesmí při filtru, otevření
  detailu ani potvrzení vytvořit user-triggered long task >50 ms. Měří se na
  stejném CI runneru a browser verzi; změna prostředí obnoví baseline.

---

## 13. Kontraktní a backendové mezery

Tyto mezery nesmí agent obejít raw UUID polem, falešnými daty nebo odemknutím
produkční route. Contract-first UI a validované fixtures mohou pokračovat,
pokud nefixují neznámé produkční chování.

| Gap ID                       | Stav | Chybějící capability                                                                                                  | Owner / poslední změna                                                    | Blokuje                             | Co lze udělat / exit evidence                                                      |
| ---------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `GAP-AUX-SHELL-01`           | [ ]  | Produkční admin context/shell pro všechny routy; dnes je shell jen preview                                            | `AUX-13A`, `P9` / 2026-09-01                                              | shell `integrated`                  | Čistý view + mock adapter; zavře produkční context, boundary a E2E evidence        |
| `GAP-AUX-CONTEXT-01`         | [ ]  | Admin context nemá feature flags ani explicitní `canEnterCheckin`; check-in bootstrap má vlastní `confirm/undo` model | `AUX-02C`, `AUX-13A`, `P6` / 2026-09-01                                   | produkční nav Oznámení/Odbavení     | Mock explicitního feature/capability DTO; zavře contract test + role/flag matice   |
| `GAP-AUX-DASH-01`            | [ ]  | Produkční metrics a bezpečný degraded worker/sync stav                                                                | `AUX-13B`, `P9-01`, `P8-10`, `P6-06` / 2026-09-01                         | dashboard `integrated`              | Mapovat schválených 6 metric IDs; zavře API + E2E bez falešného live stavu         |
| `GAP-AUX-DASH-ACTION-01`     | [ ]  | Activation/check-in/notification metriky nemají vždy permission-safe řešitelný target                                 | `AUX-03B`, `AUX-13B`, `P9-01`, `P6-06`, `P8-10` / 2026-09-01              | akční CTA těchto metrik             | Zobrazit kartu bez CTA; zavře typed action target + negativní permission test      |
| `GAP-AUX-IMPORT-01`          | [ ]  | SimpleShop preview je integrovaný; chybí produkční participant apply a report                                         | `AUX-13D`, `P4-03` / 2026-09-01                                           | aktualizace vstupenek `integrated`  | Zachovat `P4-02`; zavře transakční apply/report E2E bez browserového souboru       |
| `GAP-AUX-TICKET-01`          | [ ]  | Lidský vyhledávač cílové vstupenky pro reassign/transfer                                                              | `AUX-06B`, `P9-03`, `P4-09` / 2026-09-01                                  | picker `contract ready`             | Bez UUID interim; zavře request/response/problem schema + validované fixtures      |
| `GAP-AUX-SUPPORT-ACTIONS-01` | [!]  | Autoritativní význam a UX dopad `reassign` versus `transfer` včetně rezervací                                         | `AUX-06C`, `P4-09`, product owner / 2026-09-01                            | tyto mutace `UI ready`/`integrated` | Dočasně obě skrýt; zavře decision matrix + confirm/success/problem fixtures        |
| `GAP-AUX-ANN-TARGET-01`      | [ ]  | Event-scoped pojmenované session options povolené pro announcement preview/send                                       | `AUX-08D`, `P8-05` / 2026-09-01                                           | session picker `contract ready`     | Schválený published-program reuse nebo nový options DTO + auth/forbidden test      |
| `GAP-AUX-CONTENT-01`         | [ ]  | Human diff, published revision/time a autoritativní počet nezveřejněných změn                                         | `AUX-04C`, `P3-05` až `P3-08` / 2026-09-01                                | úplný publish review UI             | Bezpečný obecný change stav; zavře event-scoped DTO + title-level diff testy       |
| `GAP-AUX-ASSET-01`           | [!]  | Autorizovaný asset read/resolver i picker/upload/výměna fotek řečníků a log partnerů                                  | `AUX-00B`, `AUX-04F`, `AUX-13L`, `P3-01`, `BLOCKER-INFRA-01` / 2026-09-01 | asset read/mutation `integrated`    | Placeholder bez raw ID; zavře nový backend slice, storage gate, auth a E2E         |
| `GAP-AUX-RES-01`             | [ ]  | Session agregace, cursor pagination a smluvně maskovaná participant reference                                         | `AUX-07A`, `P5-05`, `P9-01` / 2026-09-01                                  | kapacity `contract ready`           | Omezený seznam bez tvrzení úplnosti; zavře DTO/fixtures/PII negativní test         |
| `GAP-AUX-ROLE-01`            | [ ]  | Assignment list, person directory, scope options a revoke flow                                                        | `AUX-09A`, `P9-02` / 2026-09-01                                           | tým `contract ready`                | Žádné ruční UUID; zavře list/search/options/mutation kontrakt + guards             |
| `GAP-AUX-EXPORT-01`          | [ ]  | Export job list, ready/download/expired/failed                                                                        | `AUX-10B`, `P9-05`, `P9-06`, `P9-07` / 2026-09-01                         | historie exportů `contract ready`   | Request může skončit queued; zavře job/download DTO + expiry/CSV injection test    |
| `GAP-AUX-AUDIT-01`           | [ ]  | Actor/outcome server filtry a úplný action label registry                                                             | `AUX-10D`, `P9-04` / 2026-09-01                                           | tyto filtry `contract ready`        | Použít category/action/time/request/cursor; zavře query schema + exhaustive labels |
| `GAP-AUX-SETTINGS-01`        | [!]  | Potvrdit konzumenta, label a umístění `supportMessage`                                                                | `AUX-10F`, `P9-09`, product owner / 2026-09-01                            | support-message copy/UAT            | Ostatní settings lze navrhnout; zavře zapsané rozhodnutí, route evidence a test    |
| `GAP-AUX-EVENT-01`           | [–]  | Případný multi-event switch                                                                                           | samostatné rozhodnutí, ADR-012 / 2026-09-01                               | nic v baseline 2026                 | Zobrazit jedinou serverem zvolenou akci; nový switch jen samostatným ADR/úkolem    |

`GAP-AUX-ASSET-01` má dva přípravné milníky: `AUX-04F` vytvoří kontrakt a
`AUX-04G` mockované UI. Gap zůstává otevřený a uzavírá jej až `AUX-13L`
backendem, storage/auth integrací a E2E; proto není gate přípravných tasků.

---

## 14. Živý implementační tracker

Toto je jediná tabulka stavu redesignu. `Owner` je agent/větev, která úkol
právě vlastní. `Evidence` musí po dokončení obsahovat soubory, testy a případně
PR/commit; samotný popis práce nestačí.

| ID        | U   | Stav | Typ           | Výsledek                                                                           | `depends_on`                                                                                                                                | `blocked_by`                                                                           | `parallel_with`                                                             | `integration_gate`                                       | Cíl capability    | Owner / evidence                                                                                          |
| --------- | --- | ---- | ------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `AUX-00A` | U0  | [x]  | research      | Ověřený audit, IA, screen specs, gap registr a tracker                             | —                                                                                                                                           | —                                                                                      | —                                                                           | N/A                                                      | N/A               | Codex / 2026-09-01; tento dokument, baseline `d09a59d`                                                    |
| `AUX-00B` | U0  | [x]  | governance    | Zapsat AUX→F4/P/CS mapování do hlavního plánu a založit branch/handoff pravidlo    | `AUX-00A`                                                                                                                                   | —                                                                                      | `AUX-00C`                                                                   | N/A                                                      | N/A               | Codex / `track/admin-ux/aux-00b-governance`; `AI_IMPLEMENTATION_PLAN.md` v6.32, `handover.md`; 2026-09-01 |
| `AUX-00C` | U0  | [ ]  | protocol      | Zajistit 5 pořadatelů, syntetická data, zařízení a 25řádkový UAT formulář          | `AUX-00A`                                                                                                                                   | —                                                                                      | `AUX-00B`, `AUX-01A`                                                        | N/A                                                      | N/A               | — / protokol §1.4                                                                                         |
| `AUX-01A` | U0  | [x]  | UI-foundation | Zavést semantické admin tokeny, Inter scale, spacing, radius a motion              | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-00C`, `AUX-01C`                                                        | N/A                                                      | N/A               | Codex / `track/admin-ux/aux-01-foundation`; `tokens.ts`, `styles.css`; 2026-09-01                         |
| `AUX-01B` | U0  | [x]  | UI-foundation | Dodat a otestovat společné primitives z §9.5                                       | `AUX-01A`                                                                                                                                   | —                                                                                      | —                                                                           | N/A                                                      | N/A               | `packages/ui/src/admin.tsx`; UI 18/18, admin browser/axe 873/873                                          |
| `AUX-01C` | U1  | [x]  | content       | Dodat contract-derived registry labelů, stavů, akcí a technical disclosure         | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-01A`                                                                   | N/A                                                      | N/A               | `admin-ui-registry.ts`; unit 547/547, typecheck/lint; unknown blokuje mutaci                              |
| `AUX-02A` | U0  | [ ]  | UI            | Route-aware chrome bez veřejného headeru a vnořeného main na `/admin`              | `AUX-00B`, `AUX-01A`                                                                                                                        | —                                                                                      | `AUX-01B`, `AUX-02C`                                                        | `ADR-013`                                                | N/A               | — / acceptance `02A`                                                                                      |
| `AUX-02B` | U0  | [ ]  | architecture  | Oddělit shell view od preview/production adapteru a zachovat per-route fail-closed | `AUX-02A`                                                                                                                                   | —                                                                                      | `AUX-02C`                                                                   | `CS-ADMIN-01`                                            | N/A               | — / acceptance `02B`                                                                                      |
| `AUX-02C` | U0  | [ ]  | contract      | Rozšířit context/fixtures o explicitní feature a check-in capability               | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-02A`, `AUX-02B`                                                        | `GAP-AUX-CONTEXT-01`, `ADR-011`                          | contract ready    | — / contract + role/flag fixtures                                                                         |
| `AUX-02D` | U0  | [ ]  | UI            | Seskupená permission/feature-aware navigace z §7                                   | `AUX-01B`, `AUX-02B`, `AUX-02C`                                                                                                             | —                                                                                      | `AUX-02E`                                                                   | `CS-ADMIN-01`                                            | N/A               | — / acceptance `02D`                                                                                      |
| `AUX-02E` | U1  | [ ]  | UI            | Topbar s názvem/fází, actor label a bezpečným account menu                         | `AUX-02B`, `AUX-02C`                                                                                                                        | —                                                                                      | `AUX-02D`                                                                   | `CS-ADMIN-01`                                            | N/A               | — / acceptance `02E`                                                                                      |
| `AUX-02F` | U0  | [ ]  | UI            | Tablet/mobile drawer se stejnou IA, focus trapem a safe area                       | `AUX-02D`                                                                                                                                   | —                                                                                      | —                                                                           | `CS-ADMIN-01`                                            | N/A               | — / acceptance `02F`                                                                                      |
| `AUX-02G` | U0  | [ ]  | QA            | Metadata, loading/error, route focus a úplná shell test matice                     | `AUX-02E`, `AUX-02F`                                                                                                                        | —                                                                                      | `AUX-03A`                                                                   | `CS-ADMIN-01`                                            | UI ready (mocked) | — / acceptance `02G`                                                                                      |
| `AUX-03A` | U0  | [ ]  | architecture  | Rozdělit sdílené monolity na samostatné route workspaces                           | `AUX-02B`                                                                                                                                   | —                                                                                      | `AUX-02G`                                                                   | N/A                                                      | N/A               | — / role≠reporty; rezervace≠audit≠settings                                                                |
| `AUX-03B` | U0  | [ ]  | UI            | Phase-aware přehled a permission-safe attention/CTA mapování                       | `AUX-01B`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-04A`, `AUX-05A`, `AUX-06A`                                             | `CS-ADMIN-01`                                            | N/A               | — / §10.1 bez nefunkčních CTA                                                                             |
| `AUX-03C` | U1  | [ ]  | QA            | Dashboard happy/empty/degraded/offline/permission/archived matice                  | `AUX-03B`                                                                                                                                   | —                                                                                      | `AUX-04E`, `AUX-05C`, `AUX-06D`, `AUX-07C`, `AUX-08C`, `AUX-09C`, `AUX-10G` | `CS-ADMIN-01`                                            | UI ready (mocked) | — / axe, keyboard, role/phase fixtures                                                                    |
| `AUX-04A` | U1  | [ ]  | UI            | List-first obsahová IA, typ selector a lidské seskupení 8 zdrojů                   | `AUX-01B`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-03B`, `AUX-05A`, `AUX-06A`                                             | `P3-05`                                                  | N/A               | — / acceptance `04A`                                                                                      |
| `AUX-04B` | U1  | [ ]  | UI            | Přesné labely, auto adresa, speaker picker a přístupné řazení                      | `AUX-01C`, `AUX-04A`                                                                                                                        | —                                                                                      | `AUX-04C`                                                                   | `P3-05`                                                  | N/A               | — / acceptance `04B`                                                                                      |
| `AUX-04C` | U0  | [ ]  | contract      | Human publication summary: názvy/dopad/revision/time/change count                  | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-04B`                                                                   | `GAP-AUX-CONTENT-01`, `P3-05`, `P3-06`, `P3-07`, `P3-08` | contract ready    | — / DTO + fixtures bez raw ID fallbacku                                                                   |
| `AUX-04D` | U1  | [ ]  | UI            | Lidský review/publish flow nad schváleným summary                                  | `AUX-04A`, `AUX-04C`                                                                                                                        | —                                                                                      | —                                                                           | `P3-07`                                                  | N/A               | — / checksum jen technical details                                                                        |
| `AUX-04E` | U1  | [ ]  | QA            | Core obsah dirty/stale/conflict/archive/publish test matice                        | `AUX-04B`, `AUX-04D`                                                                                                                        | —                                                                                      | `AUX-05C`, `AUX-06D`                                                        | `P3-07`                                                  | UI ready (mocked) | — / timezone, version, title-level diff                                                                   |
| `AUX-04F` | U2  | [ ]  | contract      | Bezpečný asset read/resolver a picker/upload contract pro foto/logo                | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-04A`                                                                   | `ADR-007`, `P3-01`                                       | contract ready    | — / nový backend slice + storage-independent schema/fixtures                                              |
| `AUX-04G` | U2  | [ ]  | UI            | Asset placeholder/preview/replace/remove UI a testy bez raw asset ID               | `AUX-01B`, `AUX-04F`                                                                                                                        | —                                                                                      | `AUX-04D`                                                                   | `AUX-04F`, `ADR-007`                                     | UI ready (mocked) | — / plný asset gap uzavírá až `AUX-13L`                                                                   |
| `AUX-05A` | U1  | [ ]  | UI            | Čtyřkroková aktualizace vstupenek: zdroj→kontrola→potvrzení→výsledek               | `AUX-01B`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-04A`, `AUX-06A`                                                        | `ADR-015`, `CS-IMPORT-01`, `P4-02`                       | N/A               | — / zachovat live SimpleShop preview; žádný file input                                                    |
| `AUX-05B` | U1  | [ ]  | UI            | Chyby první, záznamový souhrn a lidské potvrzení přesného dopadu                   | `AUX-01C`, `AUX-05A`                                                                                                                        | —                                                                                      | —                                                                           | `CS-IMPORT-01`                                           | N/A               | — / žádné immutable/apply ani upload copy                                                                 |
| `AUX-05C` | U1  | [ ]  | QA            | Zdroj/bez změn/konflikt/neznámý/stale/ambiguous/offline matice                     | `AUX-05B`                                                                                                                                   | —                                                                                      | `AUX-04E`, `AUX-06D`                                                        | `CS-IMPORT-01`                                           | UI ready (mocked) | — / exact preview/version/idempotency; file boundary test                                                 |
| `AUX-06A` | U1  | [ ]  | UI            | Účastnické hledání, výsledky, detail a permission split                            | `AUX-01B`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-04A`, `AUX-05A`                                                        | `CS-SUPPORT-01`                                          | N/A               | — / search PII mimo URL/cache                                                                             |
| `AUX-06B` | U1  | [ ]  | contract      | Target-ticket search/picker kontrakt bez UUID vstupu                               | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-06A`                                                                   | `GAP-AUX-TICKET-01`, `CS-SUPPORT-01`                     | contract ready    | — / schema + fixtures + PII review                                                                        |
| `AUX-06C` | U1  | [!]  | UI            | Lidské support akce a target picker nad `AUX-06B`                                  | `AUX-01C`, `AUX-06A`, `AUX-06B`                                                                                                             | `GAP-AUX-SUPPORT-ACTIONS-01`                                                           | —                                                                           | `GAP-AUX-SUPPORT-ACTIONS-01`, `CS-SUPPORT-01`            | N/A               | — / žádný raw ID; decision matrix pro reassign/transfer                                                   |
| `AUX-06D` | U1  | [ ]  | QA            | Read/mutate/stale/ambiguous/session wipe test matice                               | `AUX-06C`                                                                                                                                   | —                                                                                      | `AUX-04E`, `AUX-05C`                                                        | `CS-SUPPORT-01`                                          | UI ready (mocked) | — / oddělená read/write permissions                                                                       |
| `AUX-07A` | U1  | [ ]  | contract      | Session agregace, cursor a maskovaná participant reference                         | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-08A`, `AUX-09A`                                                        | `GAP-AUX-RES-01`, `CS-ADMIN-01`                          | contract ready    | — / DTO, fixtures, PII negativní test                                                                     |
| `AUX-07B` | U1  | [ ]  | UI            | Session-first kapacity, změna kapacity a storno jako oddělené flow                 | `AUX-01B`, `AUX-07A`                                                                                                                        | —                                                                                      | `AUX-08A`, `AUX-09B`                                                        | `CS-ADMIN-01`                                            | N/A               | — / minimum capacity=`reservedCount`                                                                      |
| `AUX-07C` | U1  | [ ]  | QA            | Full/stale/cancel/permission/offline/no-attendance matice                          | `AUX-07B`                                                                                                                                   | —                                                                                      | `AUX-08C`, `AUX-09C`                                                        | `CS-ADMIN-01`                                            | UI ready (mocked) | — / §10.5, §11                                                                                            |
| `AUX-08A` | U1  | [ ]  | UI            | Text→Komu(event/jedna session)→Kontrola→Odeslání + dirty guard                     | `AUX-01B`, `AUX-03A`, `AUX-08D`                                                                                                             | —                                                                                      | `AUX-07A`, `AUX-09A`                                                        | `GAP-AUX-ANN-TARGET-01`, `CS-ANN-01`                     | N/A               | — / critical only, named session picker                                                                   |
| `AUX-08B` | U1  | [ ]  | UI            | Kanonický `sent`/`already_sent` receipt bez falešného delivery reportu             | `AUX-01C`, `AUX-08A`                                                                                                                        | —                                                                                      | `AUX-07B`, `AUX-09B`                                                        | `CS-ANN-01`                                              | N/A               | — / exact recipient count                                                                                 |
| `AUX-08C` | U1  | [ ]  | QA            | Preview invalidation, zero audience, duplicate, feature-off a send matice          | `AUX-08B`                                                                                                                                   | —                                                                                      | `AUX-07C`, `AUX-09C`                                                        | `CS-ANN-01`                                              | UI ready (mocked) | — / event vs právě jedna session                                                                          |
| `AUX-08D` | U1  | [ ]  | contract      | Pojmenované, event-scoped a povolené session options pro announcement picker       | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-07A`, `AUX-09A`                                                        | `GAP-AUX-ANN-TARGET-01`, `CS-ANN-01`                     | contract ready    | — / options DTO nebo schválený published-program reuse                                                    |
| `AUX-09A` | U2  | [ ]  | contract      | Assignment list, person directory a pojmenované scope options                      | `AUX-00B`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-07A`, `AUX-08A`                                                        | `GAP-AUX-ROLE-01`, `CS-ADMIN-01`                         | contract ready    | — / list/search/options/revoke schemas                                                                    |
| `AUX-09B` | U2  | [ ]  | UI            | Přidání a odebrání role s lidským impact review                                    | `AUX-01B`, `AUX-09A`                                                                                                                        | —                                                                                      | `AUX-07B`, `AUX-08B`                                                        | `CS-ADMIN-01`                                            | N/A               | — / server guard problems přeložené                                                                       |
| `AUX-09C` | U2  | [ ]  | QA            | Team list/grant/revoke/stale/permission test matice                                | `AUX-09B`                                                                                                                                   | —                                                                                      | `AUX-07C`, `AUX-08C`                                                        | `CS-ADMIN-01`                                            | UI ready (mocked) | — / event/station/session scope                                                                           |
| `AUX-10A` | U1  | [ ]  | UI            | Report cards, období/formát a bezpečný request flow                                | `AUX-01B`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-10D`, `AUX-10E`                                                        | `CS-ADMIN-01`                                            | N/A               | — / CSV default, reason, P3 vysvětlení                                                                    |
| `AUX-10B` | U2  | [ ]  | contract      | Export jobs: queued/ready/download/expired/failed                                  | `AUX-00B`                                                                                                                                   | —                                                                                      | `AUX-10A`, `AUX-10D`                                                        | `GAP-AUX-EXPORT-01`, `CS-ADMIN-01`                       | contract ready    | — / job/download/expiry schemas                                                                           |
| `AUX-10C` | U2  | [ ]  | UI            | Historie exportů a download nad `AUX-10B`                                          | `AUX-01C`, `AUX-10A`, `AUX-10B`                                                                                                             | —                                                                                      | `AUX-10D`, `AUX-10E`                                                        | `CS-ADMIN-01`                                            | N/A               | — / queued nikdy nepředstírá hotový soubor                                                                |
| `AUX-10D` | U1  | [ ]  | UI            | Samostatná historie změn, bezpečné filtry, registry a cursor                       | `AUX-01C`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-10A`, `AUX-10E`                                                        | `CS-ADMIN-01`                                            | N/A               | — / jen kontraktem podporované filtry                                                                     |
| `AUX-10E` | U1  | [ ]  | UI            | Core nastavení: read→Upravit, dopad, dirty/save, archiv                            | `AUX-01B`, `AUX-03A`                                                                                                                        | —                                                                                      | `AUX-10A`, `AUX-10D`                                                        | `CS-ADMIN-01`                                            | N/A               | — / bez neověřené support-message copy                                                                    |
| `AUX-10F` | U2  | [!]  | product/UI    | Finální `supportMessage` label, preview a místo dopadu                             | `AUX-10E`                                                                                                                                   | `GAP-AUX-SETTINGS-01`                                                                  | —                                                                           | `GAP-AUX-SETTINGS-01`, `P9-09`                           | UI ready (mocked) | — / otevřený blocker §17.2                                                                                |
| `AUX-10G` | U1  | [ ]  | QA            | Reports/audit/core-settings stavová a accessibility matice                         | `AUX-10C`, `AUX-10D`, `AUX-10E`                                                                                                             | —                                                                                      | `AUX-11A`                                                                   | `CS-ADMIN-01`                                            | UI ready (mocked) | — / route h1, permission, P3 tests                                                                        |
| `AUX-11A` | U0  | [ ]  | content-QA    | Plain-language pass produkční user-facing copy                                     | `AUX-01C`, `AUX-02G`, `AUX-03C`, `AUX-04E`, `AUX-05C`, `AUX-06D`, `AUX-07C`, `AUX-08C`, `AUX-09C`, `AUX-10G`                                | —                                                                                      | —                                                                           | N/A                                                      | N/A               | — / scan jen rendered production copy; allowlist technical/dev                                            |
| `AUX-11B` | U1  | [ ]  | QA            | Sjednotit dirty/error/stale/pending/success/technical patterns                     | `AUX-01B`, `AUX-11A`                                                                                                                        | —                                                                                      | `AUX-12C`                                                                   | N/A                                                      | N/A               | — / texty §6.4 a matice §11                                                                               |
| `AUX-12A` | U0  | [ ]  | QA            | Cross-route axe, keyboard a screen-reader smoke                                    | `AUX-11B`                                                                                                                                   | —                                                                                      | `AUX-12C`                                                                   | N/A                                                      | N/A               | — / §1.4, §12.2 evidence                                                                                  |
| `AUX-12B` | U0  | [ ]  | QA            | Visual/responsive 320–1440, 200% zoom a reduced motion                             | `AUX-12A`                                                                                                                                   | —                                                                                      | `AUX-12C`                                                                   | N/A                                                      | N/A               | — / screenshot matrix všech rout                                                                          |
| `AUX-12C` | U2  | [ ]  | QA            | Bundle, max-page list performance a CLS audit                                      | `AUX-02G`, `AUX-03C`, `AUX-04E`, `AUX-05C`, `AUX-06D`, `AUX-07C`, `AUX-08C`, `AUX-09C`, `AUX-10G`                                           | —                                                                                      | `AUX-11B`, `AUX-12A`                                                        | N/A                                                      | N/A               | — / numeric budgets §12.3                                                                                 |
| `AUX-12D` | U0  | [ ]  | security-QA   | Cross-route privacy/security review mockované vrstvy                               | `AUX-12A`, `AUX-12B`                                                                                                                        | —                                                                                      | `AUX-12C`                                                                   | N/A                                                      | N/A               | — / P3 wipe, no-store, URL/telemetry, permissions                                                         |
| `AUX-13A` | U0  | [!]  | integration   | Produkční shell/context a bezpečný per-route gate                                  | `AUX-02G`                                                                                                                                   | `GAP-AUX-SHELL-01`, `GAP-AUX-CONTEXT-01`                                               | `AUX-13C`                                                                   | `CS-ADMIN-01`, `GAP-AUX-SHELL-01`, `GAP-AUX-CONTEXT-01`  | integrated        | — / security→code review→fix; sync všech autorit                                                          |
| `AUX-13B` | U1  | [!]  | integration   | `/admin` dashboard                                                                 | `AUX-03C`, `AUX-13A`                                                                                                                        | `GAP-AUX-DASH-01`, `GAP-AUX-DASH-ACTION-01`                                            | `AUX-13D`, `AUX-13E`                                                        | `P9-01`, `P6-06`, `P8-10`                                | integrated        | — / endpoint + E2E + docs sync                                                                            |
| `AUX-13C` | U1  | [ ]  | integration   | `/admin/obsah` s jednotným shell a produkčním content portem                       | `AUX-04E`, `AUX-13A`                                                                                                                        | —                                                                                      | `AUX-13B`                                                                   | `P3-05`, `P3-06`, `P3-07`, `P3-08`                       | integrated        | — / preview port mimo prod graph; docs sync                                                               |
| `AUX-13D` | U1  | [!]  | integration   | `/admin/vstupenky` SimpleShop preview→apply→report bez browserového souboru        | `AUX-05C`, `AUX-13A`, `P4-02`, `P4-03`                                                                                                      | `GAP-AUX-IMPORT-01`                                                                    | `AUX-13B`, `AUX-13E`                                                        | `ADR-015`, `GAP-AUX-IMPORT-01`, `CS-IMPORT-01`           | integrated        | — / zachovat live preview; apply E2E, exact retry + docs sync                                             |
| `AUX-13E` | U1  | [!]  | integration   | `/admin/ucastnici` search a support actions                                        | `AUX-06D`, `AUX-13A`, `P4-09`, `P9-03`                                                                                                      | `BLOCKER-AUTH-01`, `BLOCKER-RES-03`, `GAP-AUX-TICKET-01`, `GAP-AUX-SUPPORT-ACTIONS-01` | `AUX-13B`, `AUX-13D`                                                        | `CS-SUPPORT-01`                                          | integrated        | — / PII/security E2E + docs sync                                                                          |
| `AUX-13F` | U1  | [!]  | integration   | `/admin/rezervace` session kapacity a storno                                       | `AUX-07C`, `AUX-13A`, `P5-05`, `P9-01`                                                                                                      | `BLOCKER-RES-03`, `GAP-AUX-RES-01`                                                     | `AUX-13G`, `AUX-13H`                                                        | `CS-ADMIN-01`                                            | integrated        | — / canonical capacity E2E + docs sync                                                                    |
| `AUX-13G` | U1  | [!]  | integration   | `/admin/oznameni` preview/send                                                     | `AUX-08C`, `AUX-08D`, `AUX-13A`, `P8-05`                                                                                                    | `GAP-AUX-ANN-TARGET-01`                                                                | `AUX-13F`, `AUX-13H`                                                        | `GAP-AUX-ANN-TARGET-01`, `CS-ANN-01`                     | integrated        | — / event/one-session, duplicate send E2E + docs sync                                                     |
| `AUX-13H` | U2  | [!]  | integration   | `/admin/role` assignments                                                          | `AUX-09C`, `AUX-13A`, `P9-02`                                                                                                               | `BLOCKER-OPS-01`, `GAP-AUX-ROLE-01`                                                    | `AUX-13F`, `AUX-13G`                                                        | `CS-ADMIN-01`                                            | integrated        | — / scope/guard E2E + docs sync                                                                           |
| `AUX-13I` | U1  | [!]  | integration   | `/admin/reporty` request, jobs a expiring download                                 | `AUX-10G`, `AUX-13A`, `P9-05`, `P9-06`, `P9-07`                                                                                             | `GAP-AUX-EXPORT-01`, `BLOCKER-INFRA-01`                                                | `AUX-13J`, `AUX-13K`                                                        | `CS-ADMIN-01`                                            | integrated        | — / download audit/expiry/CSV tests + docs sync                                                           |
| `AUX-13J` | U1  | [ ]  | integration   | `/admin/audit` query a cursor                                                      | `AUX-10G`, `AUX-13A`, `P9-04`                                                                                                               | —                                                                                      | `AUX-13I`, `AUX-13K`                                                        | `CS-ADMIN-01`                                            | integrated        | — / redaction/filter/pagination E2E + docs sync                                                           |
| `AUX-13K` | U1  | [!]  | integration   | `/admin/nastaveni` read/update                                                     | `AUX-10F`, `AUX-10G`, `AUX-13A`, `P9-09`                                                                                                    | `GAP-AUX-SETTINGS-01`                                                                  | `AUX-13I`, `AUX-13J`                                                        | `CS-ADMIN-01`                                            | integrated        | — / stale/archive/audit E2E + docs sync                                                                   |
| `AUX-13L` | U2  | [!]  | integration   | `/admin/obsah` asset read/upload/replace/remove                                    | `AUX-00B`, `AUX-04G`, `AUX-13C`                                                                                                             | `GAP-AUX-ASSET-01`, `BLOCKER-INFRA-01`                                                 | `AUX-13I`                                                                   | `GAP-AUX-ASSET-01`, `ADR-007`, `P3-01`                   | integrated        | — / nový backend slice, storage, auth, alt-text a asset E2E                                               |
| `AUX-14A` | U0  | [ ]  | UAT           | 5× aktualizace vstupenek ze zdroje a opravy                                        | `AUX-00C`, `AUX-13D`                                                                                                                        | —                                                                                      | `AUX-14B`, `AUX-14C`                                                        | `AUX-00C`, `AUX-13D`                                     | UAT               | — / pět řádků `UAT-1-*`; bez file inputu, 0 zápisů při chybě                                              |
| `AUX-14B` | U0  | [ ]  | UAT           | 5× participant activation scénář a opravy                                          | `AUX-00C`, `AUX-13E`                                                                                                                        | —                                                                                      | `AUX-14A`, `AUX-14C`                                                        | `AUX-00C`, `AUX-13E`                                     | UAT               | — / pět řádků `UAT-2-*`; správná osoba                                                                    |
| `AUX-14C` | U0  | [ ]  | UAT           | 5× kapacitní scénář a opravy                                                       | `AUX-00C`, `AUX-13F`                                                                                                                        | —                                                                                      | `AUX-14A`, `AUX-14B`                                                        | `AUX-00C`, `AUX-13F`                                     | UAT               | — / pět řádků `UAT-3-*`; canonical 90                                                                     |
| `AUX-14D` | U0  | [!]  | UAT           | 5× announcement scénář a opravy                                                    | `AUX-00C`, `AUX-13G`                                                                                                                        | `BLOCKER-OPS-01`                                                                       | `AUX-14E`                                                                   | `AUX-00C`, `AUX-13G`                                     | UAT               | — / pět řádků `UAT-4-*`; žádné wrong audience                                                             |
| `AUX-14E` | U0  | [!]  | UAT           | 5× content publication scénář a opravy                                             | `AUX-00C`, `AUX-13C`                                                                                                                        | `BLOCKER-CONTENT-01`                                                                   | `AUX-14D`                                                                   | `AUX-00C`, `AUX-13C`                                     | UAT               | — / pět řádků `UAT-5-*`; human diff                                                                       |
| `AUX-14F` | U0  | [ ]  | UAT/release   | Shell, dashboard a správa smoke; uzavřít ≥23/25 a severity gate                    | `AUX-12C`, `AUX-12D`, `AUX-13B`, `AUX-13H`, `AUX-13I`, `AUX-13J`, `AUX-13K`, `AUX-14A`, `AUX-14B`, `AUX-14C`, `AUX-14D`, `AUX-14E`, `P9-08` | —                                                                                      | —                                                                           | `AUX-00C`, `P9-08`                                       | UAT               | — / plná UAT + release-smoke tabulka, perf a 0 severity 1/2                                               |

### 14.1 Doporučené pořadí a paralelní lane

```text
AUX-00A
  ├─ AUX-00B (nejdřív governance sync)
  └─ AUX-00C (nábor a UAT data běží s předstihem)
       AUX-00B → AUX-01* + AUX-02A/B/C
                    └─ AUX-02D–G + AUX-03A
                         ├─ Lane A: AUX-03B/C (dashboard)
                         ├─ Lane B: AUX-04* (obsah + assets)
                         ├─ Lane C: AUX-05* + AUX-06* (vstupenky/účastníci)
                         └─ Lane D: AUX-07* až AUX-10* (provoz/správa)
                              └─ AUX-11* + AUX-12*
                                   └─ AUX-13A shell
                                        └─ AUX-13B–L per route, paralelně
                                             └─ AUX-14A–F průběžné UAT
```

Po dobu foundations má `packages/ui`, root chrome a shared admin shell jediného
vlastníka. Po splitu mají page lane vlastní route komponenty a CSS moduly.
Sdílený `admin-workspace.module.css` nesmí upravovat několik agentů současně.
`parallel_with` je neorientovaný vztah: uvedení druhého ID v kterémkoli z obou
řádků platí pro dvojici obousměrně a záměrně se nezrcadlí, aby nevznikal drift.
Dovoluje souběh pouze při oddělených souborech/worktrees a nenahrazuje kontrolu
čistoty stromu. Každý `AUX-13*` integrační řez sám
aktualizuje hlavní plán, route mapu, frontend report a tento tracker — nejde o
samostatný jednorázový „sync“ úkol.

---

## 15. Detailní karty workstreamů

### 15.0 `AUX-00` — governance a UAT příprava

- [x] **00A-1:** Audit odkazuje na ověřený baseline, odděluje současnost od
      návrhu a obsahuje IA, screen specs, gap registr, tracker i changelog.
- [x] **00B-1:** Hlavní plán výslovně převezme mapování §0.5, AUX refaktor F4,
      route integrační vlastníky a pravidla větve/worktree/handoff; odkazy jsou
      obousměrné a bez druhého status trackeru. Založí také samostatný backend
      task pro asset read/resolver/mutations; `P3-05` se za něj nepovažuje.
- [ ] **00C-1:** Je zajištěno pět oprávněných pořadatelů, syntetický fixture,
      staging, zařízení a prázdná 25řádková UAT tabulka přesně podle §1.4.

### 15.1 `AUX-01` — design systém a primitives

**Soubory v rozsahu**

- `packages/ui/src/tokens.ts`, `packages/ui/src/styles.css`, exporty `@byzon/ui`
- nové admin primitives v `packages/ui` nebo sdíleném `app/admin/_components`
- postupné odstranění hard-coded palety z
  `apps/conference/src/components/admin-workspace.module.css`

**Akceptace**

- [x] **01A-1:** Hodnoty z §9.2 existují jako semantické tokeny, ne raw hex v
      page CSS.
- [x] **01A-2:** Admin pracovní typografie je Inter a není ovlivněna
      marketingovým `h1`.
- [x] **01B-1:** Button variants a focus/disabled/hover/pressed splní kontrast
      a hierarchii §9.6.
- [x] **01B-2:** Status používá ikonu/text a semantickou barvu.
- [x] **01B-3:** `AdminErrorSummary` odkazuje na konkrétní pole.
- [x] **01B-4:** Technical details jsou defaultně sbalené a screen-reader
      čitelné.
- [x] **01B-5:** Každá primitive má component test pro keyboard, accessible
      name a dlouhou češtinu.
- [x] **01C-1:** Každý user-facing enum/action má contract-derived exhaustive
      mapování; neznámá hodnota blokuje mutaci a nikdy se nevypíše raw.

**Mimo rozsah:** dark mode, nový marketingový redesign a plošná změna
participant UI.

### 15.2 `AUX-02` — shell, landmarks a navigace

**Doporučená struktura**

```text
apps/conference/src/app/admin/
  _components/admin-shell.tsx
  _components/admin-navigation.tsx
  _components/admin-topbar.tsx
  _components/admin-shell.module.css
  layout.tsx
  loading.tsx
  error.tsx
```

Route-aware root chrome může být jinak pojmenovaný, ale výsledek je závazný:
public header a vnější main se pro admin vůbec nevykreslí. Vizuální `display:
none` není řešení landmark problému.

**Akceptace**

- [ ] **02A-1:** Právě jeden skip link a jeden main v server-rendered i
      hydrated DOM; public chrome není v accessibility tree.
- [ ] **02B-1:** Shell view je nezávislý na mocked/production portu a per-route
      fail-closed guard zůstává zachovaný.
- [ ] **02C-1:** Context kontrakt rozlišuje permission, feature stav a
      `canEnterCheckin`; role/flag kombinace mají validované fixtures.
- [ ] **02D-1:** Nav odpovídá §7, skrývá chybějící permission, vysvětluje
      feature-off a nepřednačítá P3 data.
- [ ] **02E-1:** Event name, phase a actor label jsou lidské; UUID/timezone
      nejsou v shellu; menu má skutečné dostupné akce.
- [ ] **02F-1:** Drawer splní dialog semantiku, inert, focus trap/restore,
      Escape, body lock a safe area.
- [ ] **02G-1:** Každá route má metadata title, stabilní loading/error a právě
      jeden focus přesun po navigaci.
- [ ] **02G-2:** 320 px, 200% zoom a keyboard focus nemají překrytí ani page
      scroll do strany; mock toolbar není v produkčním grafu.

### 15.3 `AUX-03` — route ownership a dashboard

**Refaktor hranic**

- `AdminOperationsWorkspace` se rozpadne na dashboard data view, team view a
  reports view.
- `AdminReservationWorkspace` se rozpadne na reservations view, audit view a
  settings view.
- Sdílená logika request fence, failure translation a idempotence zůstává ve
  shared hook/util; nesmí se zkopírovat do pěti variant.

**Dashboard akceptace**

- [ ] **03A-1:** Každá route vlastní samostatný workspace/h1; request fence,
      failure překlad a idempotence zůstávají sdílené bez kopírování.
- [ ] **03B-1:** `metric.id` má compile-time exhaustivní label, pořadí, icon a
      permission-safe target/fallback podle §10.1.
- [ ] **03B-2:** Attention seznam se odvozuje ze stavu, ne z hard-coded karet;
      bez řešitelného targetu nevyrábí CTA.
- [ ] **03B-3:** `generatedAt` je „Aktuální k…“ v event timezone; queue raw
      názvy a DLQ nejsou v hlavním toku.
- [ ] **03B-4:** Fáze draft/activation/live/ended/archived mění další kroky,
      nikoli permissions.
- [ ] **03C-1:** Empty/healthy/degraded/offline/permission/archived, všech šest
      metrik a negativní CTA případy jsou testované.

### 15.4 `AUX-04` — program, obsah a publikace

**Soubory v rozsahu**

- `admin-content-workspace.tsx`, `admin-content-console.tsx`
- `publication-control.tsx`, content port a fixtures
- route-local components/CSS pod `/admin/obsah`

**Akceptace**

- [ ] **04A-1:** Po otevření je první seznam, ne create formulář ani checksum;
      osm zdrojů a vnořené typy odpovídají §10.2 bez změny serverových typů.
- [ ] **04B-1:** Každé pole má specifický label/helper; slug a pořadí jsou
      progressive; speaker picker funguje myší, dotykem i klávesnicí.
- [ ] **04C-1:** Contract summary nese autoritativní změny, revision/time a
      title-level dopad, nebo explicitně označí hodnotu jako nedostupnou.
- [ ] **04D-1:** Review ukazuje lidské názvy a dopad, ne raw session IDs;
      publikace používá primary confirm a archivace danger confirm. Permanentní
      delete není v baseline kontraktu ani UI.
- [ ] **04E-1:** Archive, timezone, version, collision, dirty, stale a ambiguous
      invariants mají regresní testy celé routy.
- [ ] **04E-2:** Produkční content port není nahrazen preview portem.
- [ ] **04F-1:** Nový asset slice definuje autorizovaný event-scoped
      read/resolver, typ/velikost/purpose, preview, upload, replace/remove,
      problems a syntetické fixtures bez trvalé storage URL.
- [ ] **04G-1:** Foto/logo UI nikdy nežádá raw asset ID; bez resolveru má
      placeholder, po schválení accessible preview, progres, error a read-only
      variantu.

### 15.5 `AUX-05` a `AUX-06` — vstupenky a účastníci

**Aktualizace vstupenek — akceptace**

- [ ] **05A-1:** Stepper jednoznačně rozlišuje serverové načtení ze SimpleShopu,
      kontrolu, potvrzení a výsledek; zachová integrovaný `P4-02` preview a Back
      před apply nic nezapisuje. DOM neobsahuje file input ani dropzone.
- [ ] **05B-1:** Konflikt/unknown vysvětlí chybu ve zdroji, blokuje apply a
      souhrn/záznamy mají české labely i mobilní ekvivalent.
- [ ] **05B-2:** Potvrzení shrne exact impact a zachová preview/version a
      idempotency pod povrchem.
- [ ] **05C-1:** Source unavailable/auth expired/no changes/conflict/unknown/
      stale/ambiguous/offline a exact retry jsou testované; raw source data ani
      credentials nejsou v URL, telemetry nebo cache.
- [ ] **05C-2:** Production dependency graph a request test prokážou, že route
      nevytváří `File`, `FormData` ani multipart request; CTA „Načíst ze
      SimpleShopu“ volá pouze serverový endpoint podle `ADR-015`.

**Účastníci akceptace**

- [ ] **06A-1:** Search je POST/body, PII není v URL/history a read-only actor
      nevidí mutation controls.
- [ ] **06B-1:** Picker kontrakt vyhledá bezpečný cílový ticket, minimalizuje
      PII a má no/ambiguous/stale problem větve.
- [ ] **06C-1:** Každá dostupná akce má „Kdy použít“, lidský label, dopad,
      confirm a success/recovery větu; reassign/transfer nevyžaduje UUID a do
      uzavření `GAP-AUX-SUPPORT-ACTIONS-01` zůstává skryté.
- [ ] **06D-1:** 401/403/offline/session expiry vymaže P3 list, selection,
      preview i reason; stale/ambiguous zachová pouze bezpečný exact-request
      invariant.

### 15.6 `AUX-07` a `AUX-08` — živý provoz

**Rezervace akceptace**

- [ ] **07A-1:** DTO je session-first, cursor-paginated a validuje maskovanou
      participant reference; netvrdí úplnost bez `pageInfo`.
- [ ] **07B-1:** Aktivita/kapacita jsou hlavní hierarchie; kapacita a storno
      mají odlišný formulář/copy a minimum kapacity je `reservedCount`.
- [ ] **07B-2:** Progress má textovou hodnotu a význam není jen barvou.
- [ ] **07C-1:** Full/stale/cancel/permission/offline a stránkování jsou
      testované; žádná attendance mutace se nevrátí.

**Oznámení akceptace**

- [ ] **08A-1:** Kritická severity je pevná; publikum je event nebo právě jedna
      serverem povolená pojmenovaná aktivita.
- [ ] **08A-2:** Změna textu/publika zneplatní preview a send vyžádá novou
      kontrolu; recipient/excluded count jsou pravdivě vysvětlené.
- [ ] **08B-1:** `sent` a `already_sent` mají kanonický receipt; žádný delivery
      stav ani historie se neodvozují z audience preview.
- [ ] **08C-1:** Dirty, feature-off, zero-audience, stale, duplicate, offline a
      session-expired jsou otestované pro event i jednu session.
- [ ] **08D-1:** Picker načte event-scoped, pojmenované a serverem povolené
      sessions z výslovného options kontraktu nebo schváleného
      `program:published:read` reuse; `assignedSessions` ani raw ID nepoužije.

### 15.7 `AUX-09` a `AUX-10` — tým, reporty, historie a nastavení

**Tým**

- [ ] **09A-1:** Kontrakt načte/paginuje assignments a poskytne person + scope
      options bez raw ID vstupu.
- [ ] **09B-1:** Člověk, role a scope jsou pojmenované selectory;
      `organizer_admin` se nepřidává mimo schválený kontrakt.
- [ ] **09C-1:** Grant/revoke/stale/permission a serverové self-lockout/
      last-admin problems mají test a lidskou recovery copy.

**Reporty**

- [ ] **10A-1:** Typ reportu, období, formát, PII dopad a reason jsou v jednom
      souvislém request flow; queued nepředstírá stažení.
- [ ] **10B-1:** Job contract rozlišuje queued/ready/failed/expired a expiring
      download s auditem i CSV injection ochranou.
- [ ] **10C-1:** Historie exportů tyto stavy zobrazí; stará download URL se
      nikdy neobnoví z klientské persistence.

**Historie změn**

- [ ] **10D-1:** Kategorie/action/outcome se lokalizují exhaustivně; UI nabízí
      jen filtry podporované serverovým query.
- [ ] **10D-2:** Cursor pagination zachová bezpečné filtry; redacted detail
      neodhalí before/after a request ID/version jsou technical details.

**Nastavení**

- [ ] **10E-1:** Read stav má „Upravit nastavení“; každá core volba vysvětlí
      dopad a archiv je semanticky read-only.
- [ ] **10E-2:** Dirty bar vznikne jen po změně; save zmrazí visible draft při
      ambiguous retry.
- [ ] **10F-1:** `supportMessage` má až po rozhodnutí ověřený label, místo
      zobrazení a preview; do té doby se dopad netvrdí.
- [ ] **10G-1:** Reporty, audit a core settings projdou celou maticí §11,
      keyboard/axe, permissions a P3 wipe.

### 15.8 `AUX-11` až `AUX-14` — copy, QA, integrace a UAT

**Copy QA**

- [ ] **11A-1:** Projít rendered produkční copy; scan se nevztahuje na type/
      function names, sbalené technical details ani jednoznačně dev-only mock.
- [ ] **11A-2:** Zakázané výrazy z §6.2 nejsou v main UI, aria-labelu ani
      uživatelské chybě.
- [ ] **11B-1:** Dlouhá čeština, pluralizace, locale date/number a všechny
      shared feedback vzory jsou testované.

**Automatické minimum pro každý slice**

```text
pnpm --filter @byzon/conference test
pnpm --filter @byzon/conference test:components
pnpm --filter @byzon/conference typecheck
pnpm --filter @byzon/conference lint
```

Navíc relevantní route E2E/axe, production mock-boundary test a případný
contract test v `@byzon/domain`/`@byzon/test-support`.

**Cross-route QA**

- [ ] **12A-1:** Všechny routy projdou axe, keyboard-only a manuálním
      screen-reader smoke podle §1.4/§12.2; automatický axe výsledek sám
      neprokazuje WCAG AA.
- [ ] **12B-1:** Vizuální matice pokryje 320–1440 px, 1280 × 800, 200% zoom,
      dlouhou češtinu, reduced motion a žádný horizontální page scroll.
- [ ] **12C-1:** Měření nad fixture §12.3 doloží route bundle delta, CLS,
      interakční long tasks, serverové stránkování browsable seznamů a bounded
      payload aktualizace vstupenek/supportu na jejich kontraktním maximu.
- [ ] **12D-1:** Security review doloží permission/event scope, P3 wipe,
      no-store, žádnou PII v URL/telemetrii/cache a oddělení produkce od mocků.

**Integrační gate**

Odemknout vždy jen route, jejíž server endpoint, session/auth, permission,
PII/no-store, problems, idempotence/audit, E2E a povinný security → code review
→ fix gate jsou integrovány. Nepoužít globální přepínač, který by vystavil
ostatní mocked routy. Každý `AUX-13*` sám synchronizuje hlavní plán, route mapu,
frontend report, tracker a changelog.

- [ ] **13A-1:** Produkční shell/context má jeden landmark strom, explicitní
      feature/capability gates a zachová fail-closed chování každé routy.
- [ ] **13B-1:** Dashboard používá skutečné, permission-safe metriky a
      degraded worker/sync stav; bez targetu nevykreslí CTA.
- [ ] **13C-1:** Core obsah používá produkční content port, human publication
      summary a neimportuje preview adapter/fixtures.
- [ ] **13D-1:** Aktualizace vstupenek projde source → preview → apply → report
      E2E bez browserového souboru a se stejným exact-retry/idempotency
      invariantem.
- [ ] **13E-1:** Účastníci a support akce projdou produkčním vyhledáním bez PII
      v URL/cache a bez raw ID vstupu; neodsouhlasený transfer/storno dopad
      zůstává fail-closed.
- [ ] **13F-1:** Rezervace používají session-first stránkovaný kontrakt,
      kanonický capacity write a oddělené storno; edge case z
      `BLOCKER-RES-03` se bez rozhodnutí nenasadí.
- [ ] **13G-1:** Oznámení integruje event/jednu session, preview invalidation a
      `sent`/`already_sent` bez smyšleného delivery stavu.
- [ ] **13H-1:** Tým načte assignments i pojmenované options a serverové
      grant/revoke guards mají negativní E2E test.
- [ ] **13I-1:** Reporty integrují request, job list, expirovaný download,
      audit a CSV-injection ochranu.
- [ ] **13J-1:** Historie změn používá serverové filtry, cursor pagination a
      redakci bez klientského předstírání úplnosti.
- [ ] **13K-1:** Core nastavení integruje read/update, stale, archive a audit;
      `supportMessage` se dokončí pouze po uzavření jeho gapu.
- [ ] **13L-1:** Nový asset backend slice po storage gate bezpečně integruje
      read/resolver, upload, preview, replace/remove, event scope, autorizaci a
      alt-text E2E; `P3-05` se za asset endpoint nevydává.

**UAT gate**

UAT použije produkčně podobný staging, data a přesná pravidla §1.4; každý task
uzavírá své vady před `[x]`.

- [ ] **14A-1:** Pět řádků `UAT-1-*` pro aktualizaci vstupenek splní success
      definici bez výběru souboru a při chybě doloží nula zápisů.
- [ ] **14B-1:** Pět řádků `UAT-2-*` doloží výběr správné osoby a kanonické
      potvrzení aktivace.
- [ ] **14C-1:** Pět řádků `UAT-3-*` doloží nalezení kapacity a kanonickou
      změnu na 90.
- [ ] **14D-1:** Pět řádků `UAT-4-*` doloží jednu správnou session audience a
      žádné odeslání špatným příjemcům.
- [ ] **14E-1:** Pět řádků `UAT-5-*` doloží uložení, human diff a kanonické
      publikování.
- [ ] **14F-1:** Souhrnná tabulka má ≥23/25 bez pomoci, žádnou kritickou chybu,
      0 otevřených severity 1/2 a manuální accessibility smoke evidence.
- [ ] **14F-2:** Všechny řádky release-smoke matice §1.4 projdou pro plného i
      omezeného actora, desktop/mobil, dashboard a čtyři správní průchody.
- [ ] **14F-3:** `AUX-12C` performance evidence a globální skutečný-endpoint
      accessibility/responsive smoke `P9-08` jsou dokončené a přiložené.

---

## 16. Definition of Done podle typu a lifecycle

### 16.1 Platí pro každý task

- [ ] Splnil přesně svůj `Výsledek`, všechny acceptance body se stejným ID v
      §15 a nevzal si scope sousedního tasku.
- [ ] `depends_on`, `blocked_by`, `parallel_with`, `integration_gate`, owner,
      větev/worktree a capability cíl odpovídají skutečnosti.
- [ ] Relevantní kontroly jsou zelené a přesná evidence je v §14; task a gap,
      který uzavírá, se aktualizují atomicky.
- [ ] Agent provedl self-review, respektoval cizí změny, přidal changelog a bez
      explicitního souhlasu necommitoval ani nepushoval.

### 16.2 `N/A` — research, governance, protocol a cross-route QA

- [ ] Research/governance má dohledatelné zdroje, rozhodnutí a žádné
      nedoložené tvrzení; nemusí splnit serverové ani viewportové DoD.
- [ ] Protocol má účastníky, fixture, formulář, zařízení, success/error definici
      a bezpečné zacházení se záznamy podle §1.4.
- [ ] QA task uvádí přesný nástroj, verzi, dataset, výsledek, nález i opravný
      task; samotné „zkontrolováno“ není evidence.

### 16.3 `contract ready`

- [ ] Sdílené strict request/response/problem schemas, typy a production-like
      syntetické fixtures pokrývají happy, empty, permission, validation,
      stale/ambiguous a session-expired větev podle relevance.
- [ ] Role/permission, event scope, PII klasifikace, cache/offline, verze,
      idempotence a audit jsou výslovné; server zůstává autoritou.
- [ ] Contract testy a negativní PII/unknown-field testy prošly a gap řádek má
      exit evidence.

### 16.4 `UI ready (mocked)`

- [ ] Splňuje §10 a má v každém stavu/viewportu nejvýše jednu primary akci;
      raw ID/interní enum nejsou v hlavním toku.
- [ ] Všechny relevantní stavy §11, dlouhá čeština, 320–1440 px, 200% zoom,
      keyboard-only, reduced motion, 44px targety a 16px mobilní input prošly.
- [ ] Axe má 0 serious/critical, A/AA nálezy jsou triagované, heading/landmark/
      focus pořadí je správné a loading nezpůsobí CLS ≥0.1.
- [ ] Mock je jednoznačně dev/test, používá validované fixtures a route zůstává
      produkčně fail-closed. Component/route testy dokazují acceptance.

### 16.5 `integrated`

- [ ] Platí globální DoD hlavního plánu §23 a všechny podmínky `UI ready` nad
      skutečným endpointem.
- [ ] Server znovu ověřuje membership, roli, permission/context, event scope,
      verzi a audit; P3 je `private, no-store` a mizí při
      401/403/offline/scope/session change.
- [ ] PII, reason, token a secret nejsou v URL/logu/analytics/cache; ambiguous
      retry zachová exact request; produkční graf neobsahuje mock/fixture.
- [ ] Contract/integration/E2E a negative-auth testy prošly. Security review →
      code review → opravy → re-test jsou doložené.
- [ ] Příslušný `AUX-13*` aktualizoval hlavní plán, route mapu, frontend report,
      tento tracker, gap registry a changelog i bez změny názvu lifecycle.

### 16.6 `UAT`

- [ ] Capability je nejdřív `integrated`; test běží na produkčně podobném
      stagingu s bezpečnými daty a protokolem §1.4.
- [ ] Každý pokus má úplný UAT řádek a navazující vady mají AUX ID/evidence.
- [ ] Finální gate má ≥23/25 úspěchů bez pomoci, žádnou kritickou chybu,
      0 otevřených severity 1/2 a manuální accessibility smoke evidence.

---

## 17. Rozhodnutí, otevřené otázky a blockery

### 17.1 Přijatá rozhodnutí

| ID            | Rozhodnutí                                                                       | Důvod                                                                                              |
| ------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DEC-AUX-001` | Jeden autoritativní soubor pro návrh i status                                    | Omezuje dokumentační drift mezi agenty                                                             |
| `DEC-AUX-002` | Zachovat kanonické `/admin/*` routy a přejmenovat pouze UI                       | Odkazy, security map a route kontrakt zůstanou stabilní                                            |
| `DEC-AUX-003` | Světlý minimální BYZON styl, Inter pro pracovní UI                               | Non-IT čitelnost a návaznost na shared brand tokeny                                                |
| `DEC-AUX-004` | Brand pink `#F5218E` je dekorativní; primary je `#B01365`                        | Pink nesplní 4.5:1 jako normální text na bílé                                                      |
| `DEC-AUX-005` | Technická data přes progressive disclosure                                       | Support je dohledá, ale pořadatel jimi není zatížen                                                |
| `DEC-AUX-006` | Baseline zobrazuje jednu current event bez switcheru                             | Současný bezpečný context nemá schválený switch flow                                               |
| `DEC-AUX-007` | `/check-in` a `/host/aktivity` zůstávají oddělené režimy                         | Jiný primární úkol, role, zařízení a bezpečnostní shell                                            |
| `DEC-AUX-008` | Danger a checkbox pouze pro skutečně nevratné/high-impact akce                   | Obnovuje sémantiku rizika a snižuje confirmation fatigue                                           |
| `DEC-AUX-009` | Screenshot není autorita pro návrat Interakcí/networkingu/Q&A                    | Baseline kód a v6 scope je neobsahují v Priority A                                                 |
| `DEC-AUX-010` | Produkční preview boundary se zachová per route                                  | Hotový mock vzhled není integrovaná capability                                                     |
| `DEC-AUX-011` | Announcement history a per-recipient delivery reporting nejsou v Priority A 2026 | `CS-ANN-01` vrací `sent/already_sent`; pokročilou historii/reporting vyřazuje `P8-12`              |
| `DEC-AUX-012` | Odbavení se v admin nav ukáže jen přes explicitní `canEnterCheckin` capability   | Admin a check-in context dnes používají rozdílné permission modely; klient nesmí přístup hádat     |
| `DEC-AUX-013` | AUX nahrazuje F4 prezentační/IA vrstvu, nikoli bezpečnostní kontrakty            | Zachová ověřené F4 invarianty a předejde paralelní implementaci                                    |
| `DEC-AUX-014` | Aktualizace vstupenek nepoužívá browserový soubor                                | `ADR-015` a `P4-02`: pořadatel spouští serverový SimpleShop GET a pracuje jen s kanonickým preview |

### 17.2 Otevřené produktové rozhodnutí

| ID                           | Otázka                                                                    | Do vyřešení                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GAP-AUX-SETTINGS-01`        | Kde přesně účastník uvidí `supportMessage` a jaký má být jeho label?      | Pole může být bezpečně read/update dle kontraktu, ale UI nesmí tvrdit neověřený dopad; blokuje `AUX-10F`, `AUX-13K` a finální settings UAT |
| `GAP-AUX-SUPPORT-ACTIONS-01` | Jaký je přesný rozdíl, precondition a dopad `reassign` versus `transfer`? | Obě volby zůstávají skryté; rozhodnutí musí pokrýt držitele, oba tickety, přístup, rezervace, confirm/success/recovery a `BLOCKER-RES-03`  |

Ostatní položky v §13 jsou implementační/kontraktní mezery s pojmenovanými
vlastníky, ne důvod hádat produktové chování.

---

## 18. Changelog

| Verze | Datum      | Změna                                                                                                                                         | Evidence                                                                        |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1.4   | 2026-09-01 | `AUX-01A`–`C`: sdílené admin tokeny, Inter pracovní typografie, povinné primitives a exhaustive prezentační registry                          | UI 18/18; conference unit 547/547; admin browser/axe 873/873; typecheck a lint  |
| 1.3   | 2026-09-01 | `AUX-00B` synchronizoval AUX→F4/P/CS mapování, branch/handoff pravidla a založil samostatný asset backend slice `P3-13`                       | `AI_IMPLEMENTATION_PLAN.md` v6.32, `handover.md`                                |
| 1.2   | 2026-09-01 | Importní UX sladěn se server-only SimpleShop API tokem; bez file uploadu, s integrovaným read-only preview a budoucím odděleným apply         | `ADR-015`, `P4-02`, `CS-IMPORT-01`; fact-check `main` `bfead32`                 |
| 1.1   | 2026-09-01 | Zapracován nezávislý UX, kontraktní a tracking review: per-route integrace/UAT, lifecycle DoD, context/asset/action gaps a přesné API hranice | Review tří agentů; contract fact-check `CS-ADMIN-01`, `CS-ANN-01`, content port |
| 1.0   | 2026-09-01 | Vytvořen kompletní audit, cílová IA, slovník, design systém, screen specs, API gap register, tracker a DoD                                    | Baseline `d09a59d`; audit zdrojů uvedených v §3                                 |
