# BYZON 2026 – report dokončení frontendu

> Stav k 2. září 2026: v6 scope-aligned frontendové preview a probíhající AUX redesign administrace
>
> Lifecycle: `UI ready (mocked)`
>
> Rozsah: frontendový track `F0` až `F6-05`; produkční integrace a UAT nejsou
> tímto stavem deklarované

## 1. Výsledek

Frontend nyní nabízí propojené uživatelské průchody pro účastníka,
administrátora, vedoucího aktivity, check-in operátora a PWA/offline režim.
Vývojový mock běží přes stejné typované API porty a stejné striktní Zod
kontrakty jako budoucí serverová integrace. Mock handlery, přímo injektované
preview porty a syntetické fixtures smějí být pouze v development/test grafu;
source boundary tuto závislost odmítá a prošla před i po produkčním buildem.
Čerstvý standalone artefakt byl ověřený také jako skutečně spuštěný server.
Serverová preview větev poskytuje syntetický aktuální event bez PostgreSQL a
aktivuje se jen kombinací development režimu a explicitního
`BYZON_FRONTEND_PREVIEW`.

Hotový frontend neznamená hotový backend, produkční přihlášení, skutečné
vstupenky, staging UAT ani provozní schválení. UI tyto hranice výslovně
označuje a u neintegrovaných autoritativních funkcí failne zavřeně.
Produkční participant shell proto nabízí jen trasy se skutečným serverovým
protějškem; agenda, oznámení a účetní hub se zpřístupní pouze v explicitním
frontendovém preview. Stejná hranice platí pro odkazy archivovaného účtu.

## 2. Spuštění mockovaného preview

Požadovaná verze je Node `24.18.0` a pnpm `11.15.1`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev:mock
```

Poté otevřete `http://localhost:3000/`. Root zobrazuje rovnou passwordless
přihlášení a jako sekundární cestu aktivaci vstupenky. Ostatní syntetické
průchody zůstávají dostupné přímo na `/app`, `/admin`, `/check-in` a
`/offline`; marketingový rozcestník patří na statický web, ne do aplikace.
Všechny mockované obrazovky jsou viditelně označené jako syntetické preview.

## 3. Rychlé testovací vstupy

### Aktivace a obnova

- nový aktivační průchod: `TST-OPAQUE-2026`;
- recovery průchod: `TST-RECOVERY-2026`;
- camera flow vždy nabízí ruční fallback a syntetický scan.

### Admin

V levém panelu lze přepnout personu `Administrátor`, `Vedoucí aktivity` nebo
`Účet bez přístupu`. Přepnutí okamžitě invaliduje předchozí event/permission
scope.

- aktualizace vstupenek používá serverový SimpleShop preview bez file inputu;
  cílené fixture testy kryjí no-change, conflict, unknown, stale, ambiguous,
  offline a session-expired stavy i mockované potvrzení/report;
- support hledání používá syntetické `single`, `ambiguous`, `none`, `error`;
  vstup se posílá jen POST/no-store body a neukládá se do URL/historie;
- oznámení má testované event/session, zero-audience, stale, duplicate,
  ambiguous retry, offline a session-expired scénáře bez technických hesel v
  produkční nápovědě;
- role, export, rezervace a settings mají canonical success,
  stale, permission, idempotency a audit varianty.
- `/admin/obsah` otevírá seznam místo formuláře, seskupuje osm obsahových
  zdrojů do pěti lidských oblastí a používá bezpečný URL stav bez interních ID.
  Zveřejnění ukazuje autoritativní title-level změny a technické údaje schovává
  do disclosure; mocked asset UI kryje placeholder, krátkodobý náhled,
  progres, chybu, výměnu, odstranění a read-only stav. Produkční asset resolver
  zůstává záměrně nepřipojený do `P3-13`/`AUX-13L`.

### Check-in

- `DEMO-VALID`
- `DEMO-DUPLICATE`
- `DEMO-CANCELLED`
- `DEMO-REFUNDED`
- `DEMO-BLOCKED`
- `DEMO-UNKNOWN`
- `DEMO-ERROR`

Každý lookup je oddělený od potvrzení. Platný výsledek lze potvrdit a následně
v časovém okně auditovaně vrátit s povinným důvodem.

### Offline

V `dev:mock` nejprve otevřete `/offline` online a až potom v DevTools přepněte
síť offline. Lze tak projít offline/stale stavy, owner-lease agendu a frontu
pouze pro `add`/`remove`; rezervace a check-in zůstávají vždy online. PWA
service worker se ve vývoji záměrně neregistruje, protože stejný scope vlastní
MSW. Produkční build ověřuje kompletní zabalení shellu a absenci mocků;
service-worker harness testuje install/update, validaci, fallback a rollback
lifecycle. Nainstalovaná PWA na stagingu a fyzických zařízeních zůstává v
`F6-07`/`F6-08`. Produkční feature gate osobní cache/replay zůstává vypnutý,
dokud server neposkytne skutečný `lease-v1` preflight.

## 4. Implementované uživatelské průchody

### Veřejný vstup, aktivace a identita

Root je přímý passwordless login s neenumerující odpovědí a sekundárním odkazem
na aktivaci. Před zobrazením formuláře respektuje serverem potvrzený
rozpracovaný claim, takže neobchází bezpečný aktivační handoff. Aktivační kód
zůstává opaque, neukládá se do URL ani draftu a všechny neplatné varianty mají
neenumerující odpověď. Navazující identita, jednorázový fragment link,
login/recovery, dvoukrokový onboarding profilu a právního acknowledgement,
session expiry, logout,
logout-all a switch-account používají bezpečný návrat a synchronní vymazání
privátního stavu.

### Účastník

Pěticílový responsive preview shell pokrývá přehled, program, osobní agendu,
oznámení a hub `Více`. Produkční režim failne zavřeně a do doplnění
autorizovaných endpointů ukazuje jen přehled a program; mock-only route ani
agenda request nelze otevřít nepřímou navigací či deep-linkem. Přehled reaguje
na fázi eventu a v preview ukazuje publikovaný program, praktické informace a
nejbližší kanonický bod osobní agendy bez vymyšlených live dat.

Program má filtr, detail session, řečníky, partnery a praktický obsah. Agenda
podporuje save/remove, rezervaci/cancel, automatický FIFO waitlist, kapacitní
stavy, časový konflikt a `.ics` export. Historická `registration_estimate` i
offer/TTL větev byly z kontraktu, fixtures a UI odstraněny; networking je po
administrátorském nastavení kladné kapacity běžná rezervovatelná session.
Oznámení obsahují all/unread filtr, stránkování, detail, online read a bezpečný
návrat s filtrem/scroll pozicí.

Vstupenka je záměrně status-only: valid/cancelled/refunded/blocked a maskovaný
suffix, bez vymyšleného skenovatelného credentialu. Profil, soukromí,
nastavení, právní dokumenty, kontaktní privacy cesta, deletion request a
session controls jsou dostupné z hubu `Více`. Profil obsahuje dobrovolný
telefon v E.164; participant self-service export není součástí v6.

### Organizátor a vedoucí aktivity

Jeden adaptivní admin shell obsahuje overview, import vstupenek, participant
support, kritická oznámení, role, report/export, rezervace, audit, event
settings a správu obsahu. Desktop používá sidebar, úzký viewport jednu
ekvivalentní navigaci; breadcrumbs nevytvářejí paralelní systém.

Aktualizace vstupenek načítá změny výhradně serverovým SimpleShop API
preview, automaticky ukáže problematické záznamy a používá stejné lidské labely
v desktopové tabulce i mobilních kartách. Browser nevytváří `File`, `FormData`
ani multipart request. Potvrzení/report jsou připravené a testované nad
oddělenou mock fixture hranicí; produkční route je do `P4-03`/`AUX-13D`
nezobrazuje. Support pracuje s maskovanými PII, POST search body, odděleným
read/write oprávněním, lidskými stavy a akcemi, důvodem, potvrzením,
idempotencí a výsledným auditem. `block`, `reactivate` a případný serverem
povolený `resend` vysvětlují použití, dopad i recovery. Target-ticket picker
má strict reference kontrakt bez UUID vstupu; `reassign` a `transfer` jsou do
produktového rozhodnutí o jejich rozdílu a rezervacích fail-closed skryté.

Oznámení používají čtyřkrokový critical-only tok s live participant kartou,
počítadly, dirty guardem a event/právě-jedna-session audience preview. Session
se vybírá pouze z pojmenovaného event-scoped DTO s časem a místností, nikdy
ručním UUID nebo assignment seznamem. Kontrola uvádí recipient/excluded count
bez tvrzení o doručení a canonical `sent`/`already_sent` receipt schovává audit
i preview verzi do technických údajů. `AUX-13G` doplnil autorizovaný
event-scoped options endpoint a bezpečné no-store načtení se session
wipe/retry. Týmová obrazovka zobrazuje stránkované provozní role a vybírá jen
existující osobu, popsanou roli a serverem povolený pojmenovaný
event/station/session rozsah. Ruční ID i grant `organizer_admin` jsou skryté;
grant/revoke má lidské guard chyby, stale reload a exact retry. Produkční
read/search/options endpointy zůstávají v `AUX-13H`. Reporty mají čtyři
popsané typy, CSV jako výchozí formát, období v timezone akce a povinný důvod.
Strict historie rozlišuje queued/ready/failed/expired a nabízí stažení pouze
pro přesnou same-event ready cestu; produkční job list zůstává v `AUX-13I`.
Audit zobrazuje lidské kategorie, akce a výsledky, serverové
category/action/time/request filtry a cursor bez klientského předstírání
úplnosti; actor/outcome filtry zůstávají fail-closed do rozšíření kontraktu.
Core nastavení začíná read-only, vysvětluje dopad registrace a rezervací,
zamyká exact-retry draft a archiv nevykreslí edit controls. Neověřený
`supportMessage` se zachová beze změny, ale nezobrazuje se ani neupravuje do
produktového rozhodnutí. Rezervace mají nový session-first cursor/pageInfo kontrakt s
povinně maskovanou referencí. Kanonická stránka řadí plné a téměř plné
aktivity, zobrazuje textovou obsazenost i progress a odděluje změnu kapacity od
danger storna konkrétní rezervace; attendance mutace se nevrátila. Dokud
produkční read nepřejde na nový stránkovaný kontrakt v `AUX-13F`, UI výslovně
přiznává omezenou první stránku. Rezervační override, audit a settings vyžadují
přesné oprávnění, expected version a canonical odpověď. Každý request je fenced
podle eventu a security epoch; permission loss nebo 401/403 skryje P3 data a
přeruší stale práci.

Cross-route copy QA nyní nad vykresleným hlavním obsahem blokuje technické
výrazy; sbalené `Technické údaje` a jednoznačně vývojové fixture zůstávají
mimo tento scan. Backendová reference historie se překládá na „akce“, společné
offline, relace, oprávnění, změněná data a nejistý výsledek používají jednotné
texty. Reference požadavku se v chybovém souhrnu zobrazí až po otevření
technických údajů. Počty používají česká `Intl` pravidla a lokalizované tisíce.

Cross-route automatizace pokrývá všech 11 admin rout na 320, 375, 414, 768,
1024, 1280 a 1440 px. Ověřuje axe, landmarky, posloupnost nadpisů, skip link,
desktopovou i drawer navigaci, filtry/detail, page overflow, 200% reflow a
reduced motion. Ruční screenshot review opravil mobilní souhrn rezervací.
Bundle budget drží shared admin gzip na +315 B/+0,24 % a přímé route importy snížily
rezervace, tým, reporty, audit a nastavení odstraněním nechtěného legacy
barrel bundlingu. CLS je 0.03246 a měřené interakce nevytvořily long task;
fyzický screen-reader UAT a max-page browser trace zůstávají poctivě otevřené.

Správa obsahu na `/admin/obsah` používá jedno typed port rozhraní pro dny,
místa, místnosti, body programu, řečníky, partnery, stránky a FAQ; development
injektuje stateful preview port a produkce používá výchozí fetch port. Dny lze
po potvrzení bezpečně trvale odstranit, ostatních sedm typů archivovat.
Archivované položky zůstávají v admin seznamu read-only a jsou vyloučené z
publikovaného obsahu; dny nemají permanentní delete akci a celý archivovaný
event uzamkne workspace. Neuložené
změny mají dirty guard a změna scope, permission loss nebo session expiry
formulář bezpečně vymaže. Zveřejnění vždy vzniká z přesně zkontrolované verze,
vyžaduje potvrzení a koreluje verzi i request.

Produkční route po `AUX-13C` nepoužívá paralelní participant event lookup.
Event ID, timezone, phase a oprávnění čte pouze z ověřeného admin shell
contextu; produkční wrapper neinjektuje port, takže používá výhradně fetch
adapter. Security failure invaliduje celý shell scope. Preview workspace je
stále dostupný pouze za development/test guardem a produkční build boundary
odmítá jeho marker i mock závislosti. Finální staging auth/context důkaz patří
společnému `AUX-13A`.

Samostatné development/test preview `/host/aktivity` používá minimální
`CS-ROSTER-01`: vedoucí aktivity vidí pouze přiřazené sessions, jméno, firmu a
stav rezervace. Nemá attendance mutaci, telefon, e-mail ani globální export.
Produkční endpoint a cross-session autorizaci doplní `P5-08`.

### Check-in operátor

Samostatný fullscreen shell ukazuje event, stanoviště, zařízení, síť a roli.
Camera lifecycle má vysvětlení permission, viditelný záměrný start, cancel a
ruční fallback. Alternativou je bounded hledání podle minima maskovaných dat.
Výsledky valid/duplicate/cancelled/refunded/blocked/unknown/error jsou čitelné
bez barvy, zvuku nebo haptiky.

Scan ani lookup nic nemutují. Confirm je explicitní, exact retry zachovává
idempotency pouze u neurčitého výsledku a undo vyžaduje roli, serverovým časem
vymezené okno a důvod.

### PWA a offline

Versionovaný service worker cachuje pouze buildem vygenerovaný explicitní shell
manifest a validovaný veřejný content snapshot. Generátor vychází ze skutečné
offline HTML route, zahrne její fingerprintované CSS, JavaScript a fonty a
standalone balíček doplní o `public` i `_next/static`. Zápisy jsou
serializované per cache key, vyšší neplatná verze nepřepíše poslední dobrou a
rollback přijme jen úplný exact manifest bez privátních odpovědí.
Každý asset má SHA-256 digest, který se kontroluje při instalaci, aktivaci
aktuální cache, navigačním fallbacku i rollbacku.

Osobní IndexedDB je event/user/lease/epoch scoped a při logoutu, změně účtu,
revokaci nebo neřešitelné migraci se synchronně vymaže. Queue přijímá jen
agenda `add`/`remove`, znovu ověřuje lease těsně před POST, odděluje
pending/retry/conflict/failed/superseded a conflict rebase vytváří nové UUID.
Terminal failure nabízí explicitní discard recovery; žádný stav nepředstírá
serverové potvrzení rezervace nebo check-inu.

## 5. Implementované routes

Frontend má 36 kanonických routes, tři kompatibilní admin redirecty a jednu
dynamickou variantu obecné chyby přístupu. Rezervace zůstávají součástí
`/app/agenda`, veškerý editovatelný eventový obsah vlastní `/admin/obsah` a
operátorský check-in má jedinou route `/check-in`.

### Veřejné a identity

- `/`
- `/aktivace`, `/aktivace/kod`, `/aktivace/skenovat`, `/aktivace/odkaz`
- `/prihlaseni`, `/onboarding`
- `/chyba-pristupu`, `/chyba-pristupu/[kind]`
- `/offline`

### Participant

- `/app`
- `/app/program`, `/app/program/[sessionId]`
- `/app/agenda`
- `/app/oznameni`, `/app/oznameni/[announcementId]`
- `/app/vstupenka`, `/app/informace`
- `/app/recnici`, `/app/recnici/[slug]`, `/app/partneri`
- `/app/vice`, `/app/profil`, `/app/soukromi`, `/app/nastaveni`

### Admin, vedoucí aktivity a operátor

- `/admin`
- `/admin/vstupenky`, `/admin/ucastnici`, `/admin/oznameni`
- `/admin/role`, `/admin/reporty`
- `/admin/rezervace`, `/admin/audit`, `/admin/nastaveni`
- `/admin/obsah`
- legacy `/admin/import`, `/admin/support`, `/admin/provoz` po preview gate
  přesměrují na kanonického vlastníka obrazovky;
- `/check-in`;
- `/host/aktivity` (development/test preview; produkčně fail-closed do `P5-08`).

## 6. Kontrakty a bezpečnostní hranice

Stav `contract ready` mají `CS-BASE-01`, `CS-ACT-01`, `CS-BOOT-01`,
`CS-CONTENT-01`, `CS-AGENDA-01`, `CS-IMPORT-01`, `CS-SUPPORT-01`,
`CS-CHECKIN-01`, participant i admin část `CS-ANN-01`, `CS-ADMIN-01`,
`CS-ROSTER-01` a `CS-OFFLINE-01`.

Úplný `CS-TICKET-01` zůstává otevřený. Hotový status-only subset schválně
neobsahuje presentation value; formát, expirace, rotace a verifier skutečného
credentialu patří za `BLOCKER-TKT-05`.

Společné invarianty:

- syntetické fixtures procházejí stejným parserem jako API odpovědi;
- privátní a provozní odpovědi jsou `private, no-store`;
- PII, secrets, ticket kódy, search dotazy a reason nejsou v URL ani cache;
- mutace korelují event/resource/action/version/postcondition;
- neurčitý retry drží přesný frozen body a idempotency key;
- 401/403, revokace a změna scope synchronně invalidují citlivý stav;
- source boundary zakazuje MSW, fixtures a preview scénáře v produkčním
  dependency graphu.

## 7. Responsive, accessibility a UX

Component testy běží v phone, tablet a desktop Chromium projektech. Pokrytí
zahrnuje axe, skip links, focus po route/stavové změně, klávesnici, dialog
focus trap/restore, 44px touch targety, safe areas, overflow, dlouhou češtinu,
reduced motion a landscape check-in. Stav není sdělovaný jen barvou a
kritické formuláře mají focusovatelný error summary, field association a
live/progress region.

## 8. Etapové review

- F0–F3: foundation, aktivace, participant shell/content/account a agenda mají
  uzavřený security/code review; F3 review je zaznamenané v `ca8b03f`.
- F4: review/hardening `0b29f78`, canonical contracts `4c04a2d`, canonical
  port refaktor `a05b6a5`, post-review opravy `20ebc72`, upload hardening
  `b739507`, finální obsahový editor `e429119`, Markdown kontrakt `13e7749` a
  oboustranný boundary test `cf63bb4`; výsledek `PASS`.
- F5: review opravy `3f67715` a server-time post-review `2a41931`; výsledek
  `PASS`.
- F6: ownership/rollback review `e1e23b9`, produkční boundary `8af539e`,
  bezdatabázové participant preview `2b7a9d3`, offline packaging `afb1239`,
  obsahové fingerprinty `4772a95` a fail-closed current-shell opravy
  `b6abbb3`; opakovaný nezávislý post-review skončil `PASS`.
- Finální hardening: preview boundary opravy `4f01336` a `bf786f2`, agenda
  owner/epoch race a stale sync fencing `5304a64`, stabilní tříviewportový
  runner `2817953`, mock E2E server `c5d573f`, React 19/SWC keyed-children
  oprava `206d048`, bezpečný `brace-expansion 5.0.8` backport `0c25160` a
  fail-closed oddělení produkčních a preview participant průchodů `4ce8dae`.
  Poslední řez uzavřel oba P1 PR thready včetně souvisejícího archivního
  deep-linku. Každý pozdní řez prošel samostatným read-only review; výsledky
  `PASS`.

Potvrzené nálezy nebyly pouze zdokumentované: byly opravené, dostaly regresní
testy a prošly opakovaným nezávislým review před merge.

## 9. Testovací gate

Cílené post-review ověření:

- F4: původní admin řezy 77/77 unit/contract/MSW/architecture a 30/30 browser
  viewport běhů; finální obsahový řez 68/68 conference testů, 6/6
  doménových kontraktů a 42/42 browser běhů;
- F5: 72/72 check-in browser viewport běhů;
- F6: finální service-worker/generator/registration sada 32/32, 57/57 offline
  storage/capability browser běhů, 3/3 recovery viewport běhy a 3/3 skutečné
  non-production mount běhy;
- F4/F6-scoped ESLint, TypeScript a source mock boundary,
  `git diff --check` a syntax service workeru: `PASS`.

Kompletní před-merge lokální gate pro PR #17 byl `PASS`:

- Prettier, ESLint a všech sedm workspace typechecků;
- 747 unit/integration testů prošlo a 51 databázových testů bylo při
  bezdatabázovém běhu očekávaně přeskočeno; opravená publication regrese navíc
  prošla 4/4 proti dočasné PostgreSQL 17;
- 60 browser component souborů a 840/840 scénářů prošlo společně v phone,
  tablet a desktop Chromium;
- Playwright prošel 15/15 skutečných mock E2E scénářů ve třech viewports,
  včetně axe, route focusu, navigace, touch targetů, overflow a čisté React
  konzole;
- development route sweep ověřil 37 kanonických odpovědí, tři přesné legacy
  redirecty a jeden očekávaný `404`;
- static-site smoke ověřil 25 HTML dokumentů a 58 assetů;
- Next `16.2.11` produkční build vygeneroval 25 statických app stránek,
  source i post-build mock boundary prošly a worker bundle se sestavil;
- offline balíček obsahuje 26 digestovaných assetů, manifest verze
  `546da19aa63a23395d4e27e8b712d4d846115f02f65b0e6ddf918d2ef7c66631`
  a service worker o 24 057 bytech, tedy pod limitem 24 KiB;
- standalone runtime vrátil `200` pro root, offline shell, manifest, oba PWA
  assety, obě ikony a oba health endpointy a zachoval bezpečnostní/cache
  hlavičky;
- frozen install je reprodukovatelný a `pnpm audit --audit-level high` končí
  kódem `0`. Zůstává jedna nesouvisející `moderate` položka ve starém
  transitivním `esbuild` dev-toolingu.

Následná korekce přihlašovacího rootu prošla 29/29 cílenými unit/PWA testy,
45/45 browser component běhy ve třech viewports, 15/15 mock E2E scénáři,
statickým smoke testem všech 25 HTML stránek, TypeScriptem, ESLintem,
Prettierem a produkčním Next buildem. Aktuální offline balíček obsahuje 27
digestovaných assetů včetně oficiálního loga, manifest verze
`ec4b7f4743633482876c658d157532327303ae529da2b1613f5198871a475556`
a service worker o 24 142 bytech.

PR #17 gate spouštěl stejný formát, lint, typecheck, PostgreSQL integrace, unit,
produkční build, 840 browser scénářů, 15 E2E scénářů a audit. Merge je povolen
až na zeleném finálním headu.

V6 scope-alignment gate z 16. 8. 2026 ověřil aktuální pracovní větev znovu:

- všech pět Drizzle migrací a idempotentní seed prošly nad izolovaným
  PostgreSQL; databázový balíček má 81/81 a conference server/unit balíček
  482/482 testů bez přeskočených integrací;
- 63 browser component souborů a 843/843 scénářů prošlo v cílových phone,
  tablet a desktop viewports;
- Playwright prošel 15/15 E2E scénářů proti skutečnému database readiness,
  včetně axe, klávesnice a reduced-motion kontrol;
- formát, lint, typecheck, produkční Next/worker build, source/build mock
  boundary a static-site smoke jsou zelené; build obsahuje 26 statických app
  stránek včetně development/test preview `/host/aktivity`, offline shell 27
  assetů a veřejný web 25 HTML dokumentů se 58 assety.

Tento gate potvrzuje scope-aligned kontrakty a preview; neposouvá žádnou
capability na `integrated` ani `UAT`.

## 10. Otevřené blokátory a backend handoff

Tyto body nejsou chybějící mockované FE průchody:

- `F3-06`/`P5-06` jsou dokončené nad source-verified snapshotem autoritativního
  harmonogramu; `F3-07` je integrované s administrátorskou networkingovou
  kapacitou a automatickým FIFO;
- read-only roster endpoint a negativní cross-session autorizace jsou
  integrované v `P5-08`; zbývá finální přiřazení skutečných vedoucích;
- skutečný auth/session/membership a autorizované backend endpointy pro celý
  F1–F6 rozsah;
- produkční SimpleShop API mapping, staging/apply a synchronizace na vyžádání;
- úplný participant ticket credential za `BLOCKER-TKT-05`;
- skutečné check-in credential adaptery, zařízení, load profil a provozní UAT;
- produkční offline `lease-v1`, revocation a replay preflight;
- `F6-06`: nahrazení všech mock transportů skutečnými serverovými protějšky a
  negativní autorizační integrace;
- `F6-07`: staging E2E a produktové role/phase/deep-link/offline UAT;
- `F6-08`: fyzický Chrome Android, Safari iOS/installed-PWA a finální
  performance budgets;
- právní texty, produkční obsah a vendor/provozní rozhodnutí evidovaná v
  blocker registru plánu.

## 11. Git předání

Implementace vznikla na `track/frontend-complete` v malých F0–F6 commitech;
každý krok byl pushnutý. [PR #17](https://github.com/martymax/byzon-2026/pull/17)
prošel kompletním gate a byl sloučen do `main` merge commitem `64f1b84`.
Následné v6 scope alignment a baseline opravy se předávají samostatně přes
[PR #19](https://github.com/martymax/byzon-2026/pull/19).
