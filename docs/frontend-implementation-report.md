# BYZON 2026 – report dokončení frontendu

> Stav k 26. červenci 2026: kompletní frontendové preview nad syntetickými daty
>
> Lifecycle: `UI ready (mocked)`
>
> Rozsah: frontendový track `F0` až `F6-05`; produkční integrace a UAT nejsou
> tímto stavem deklarované

## 1. Výsledek

Frontend nyní nabízí propojené uživatelské průchody pro účastníka,
administrátora, operátora sálu, check-in operátora a PWA/offline režim.
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

## 2. Spuštění mockovaného preview

Požadovaná verze je Node `24.18.0` a pnpm `11.15.1`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev:mock
```

Poté otevřete `http://localhost:3000/`. Úvodní stránka nabízí čtyři hlavní
průchody: účastnickou aplikaci, organizační provoz, check-in a offline centrum.
Všechny obrazovky jsou viditelně označené jako syntetické preview.

## 3. Rychlé testovací vstupy

### Aktivace a obnova

- nový aktivační průchod: `TST-OPAQUE-2026`;
- recovery průchod: `TST-RECOVERY-2026`;
- camera flow vždy nabízí ruční fallback a syntetický scan.

### Admin

V levém panelu lze přepnout personu `Administrátor`, `Operátor sálu` nebo
`Účet bez přístupu`. Přepnutí okamžitě invaliduje předchozí event/permission
scope.

- importní scénář se volí názvem bezpečného `.csv`/`.xlsx` souboru; klíčová
  slova `conflict`, `unknown`, `stale` a `collision` vyvolají odpovídající
  syntetický stav;
- support hledání: `single`, `ambiguous`, `none`, `error`;
- oznámení umožňuje scénáře stale/expired/timeout podle nápovědy přímo ve
  formuláři;
- role, export, rezervace, attendance a settings mají canonical success,
  stale, permission, idempotency a audit varianty.
- `/admin/obsah` nabízí přepínač běžného stateful, empty, archived, stale,
  conflict, offline, permission a session-expired scénáře pro všech osm
  obsahových zdrojů i immutable publikaci.

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

Úvod rozlišuje dostupnost preview a vede na ruční nebo camera aktivaci.
Aktivační kód zůstává opaque, neukládá se do URL ani draftu a všechny neplatné
varianty mají neenumerující odpověď. Navazující identita, jednorázový fragment
link, login/recovery, onboarding, právní acknowledgement, session expiry,
logout, logout-all a switch-account používají bezpečný návrat a synchronní
vymazání privátního stavu.

### Účastník

Pěticílový responsive shell pokrývá přehled, program, osobní agendu, oznámení
a hub `Více`. Přehled reaguje na fázi eventu a ukazuje publikovaný program,
praktické informace a nejbližší kanonický bod osobní agendy bez vymyšlených
live dat.

Program má filtr, detail session, řečníky, partnery a praktický obsah. Agenda
podporuje save/remove, rezervaci/cancel, waitlist, nabídku s expirací,
kapacitní stavy, časový konflikt, registration estimate a `.ics` export.
Oznámení obsahují all/unread filtr, stránkování, detail, online read a bezpečný
návrat s filtrem/scroll pozicí.

Vstupenka je záměrně status-only: valid/cancelled/refunded/blocked a maskovaný
suffix, bez vymyšleného skenovatelného credentialu. Profil, soukromí,
nastavení, právní dokumenty, privacy request a session controls jsou dostupné
z hubu `Více`.

### Organizátor a operátor sálu

Jeden adaptivní admin shell obsahuje overview, import vstupenek, participant
support, oznámení, role, report/export, rezervace a attendance, audit, event
settings a správu obsahu. Desktop používá sidebar, úzký viewport jednu
ekvivalentní navigaci; breadcrumbs nevytvářejí paralelní systém.

Import provádí bezpečný typ/MIME sniff, upload progress, staging validation,
diff `new/unchanged/status changed/conflict/unknown`, immutable SHA-256 preview,
explicitní impact confirmation a report. Support pracuje s maskovanými PII,
POST search body, odděleným read/write oprávněním, reason, potvrzením,
idempotencí a výsledným auditem.

Oznámení používají draft, audience preview a immutable send. Role jsou
event/session/room scoped; exporty jsou asynchronní. Rezervační override,
attendance, audit a settings vyžadují přesné oprávnění, expected version a
canonical odpověď. Každý request je fenced podle eventu a security epoch;
permission loss nebo 401/403 skryje P3 data a přeruší stale práci.

Správa obsahu na `/admin/obsah` používá jedno typed port rozhraní pro dny,
místa, místnosti, body programu, řečníky, partnery, stránky a FAQ; development
injektuje stateful preview port a produkce používá výchozí fetch port. Dny lze
po potvrzení bezpečně trvale odstranit, ostatních sedm typů archivovat.
Archivované položky zůstávají v admin seznamu read-only a jsou vyloučené z
publication snapshotu; celý archivovaný event uzamkne workspace. Neuložené
změny mají dirty guard a změna scope, permission loss nebo session expiry
formulář bezpečně vymaže. Publikace vždy vzniká z immutable preview, vyžaduje
potvrzení a koreluje verzi i request.

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

Frontend má 35 kanonických routes, tři kompatibilní admin redirecty a jednu
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

### Admin a operátor

- `/admin`
- `/admin/vstupenky`, `/admin/ucastnici`, `/admin/oznameni`
- `/admin/role`, `/admin/reporty`
- `/admin/rezervace`, `/admin/audit`, `/admin/nastaveni`
- `/admin/obsah`
- legacy `/admin/import`, `/admin/support`, `/admin/provoz` po preview gate
  přesměrují na kanonického vlastníka obrazovky;
- `/check-in`.

## 6. Kontrakty a bezpečnostní hranice

Stav `contract ready` mají `CS-BASE-01`, `CS-ACT-01`, `CS-BOOT-01`,
`CS-CONTENT-01`, `CS-AGENDA-01`, `CS-IMPORT-01`, `CS-SUPPORT-01`,
`CS-CHECKIN-01`, participant i admin část `CS-ANN-01`, `CS-ADMIN-01` a
`CS-OFFLINE-01`.

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
  oprava `206d048` a bezpečný `brace-expansion 5.0.8` backport `0c25160`.
  Každý pozdní řez prošel samostatným read-only review; výsledky `PASS`.

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

Kompletní před-merge lokální gate je `PASS`:

- Prettier, ESLint a všech sedm workspace typechecků;
- 736 unit/integration testů prošlo a 51 databázových testů bylo při
  bezdatabázovém běhu očekávaně přeskočeno; opravená publication regrese navíc
  prošla 4/4 proti dočasné PostgreSQL 17;
- 60 browser component souborů a 837/837 scénářů prošlo společně v phone,
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
  `21d45c701fdca2fc2952ad445e9b22f93bc769cb483ac9c8811aa6e12a850356`
  a service worker o 24 057 bytech, tedy pod limitem 24 KiB;
- standalone runtime vrátil `200` pro root, offline shell, manifest, oba PWA
  assety, obě ikony a oba health endpointy a zachoval bezpečnostní/cache
  hlavičky;
- frozen install je reprodukovatelný a `pnpm audit --audit-level high` končí
  kódem `0`. Zůstává jedna nesouvisející `moderate` položka ve starém
  transitivním `esbuild` dev-toolingu.

PR gate spouští stejný formát, lint, typecheck, PostgreSQL integrace, unit,
produkční build, 837 browser scénářů, 15 E2E scénářů a audit. Merge je povolen
až na zeleném finálním headu.

## 10. Otevřené blokátory a backend handoff

Tyto body nejsou chybějící mockované FE průchody:

- `F3-06` coaching/registration estimate rozšíření čeká na
  `BLOCKER-RES-02`;
- skutečný auth/session/membership a autorizované backend endpointy pro celý
  F1–F6 rozsah;
- produkční ticket import mapping/apply a SimpleShop synchronizace;
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
každý krok byl pushnutý. Předání probíhá přes
[PR #17](https://github.com/martymax/byzon-2026/pull/17) a větev se merguje do
`main` až po úspěšném kompletním gate. Výsledný merge SHA je součástí
závěrečného uživatelského reportu.
