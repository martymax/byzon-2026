# BYZON 2026 – handover

> Poslední aktualizace: 21. srpna 2026

## Pokyny pro pokračování

Před prací přečti `AI_IMPLEMENTATION_PLAN.md`, související ADR a `README.md`.
Ověř větev, stav a log; cizí změny neměň. Po každém kroku aktualizuj tento
soubor. Commit ani push nedělej bez explicitního schválení uživatelem.

Na konci každé etapy povinně a v tomto pořadí:

1. proveď security review celého rozsahu etapy;
2. proveď code review úplného etapového diffu/PR;
3. rovnou zapracuj potvrzené actionable nálezy z obou review, doplň regresní
   testy a znovu spusť relevantní kontroly a CI.

Etapu neuzavírej ani nemerguj, dokud nejsou nálezy opravené a ověřené; úplný
kontrakt tohoto gate je v §1.6 `AI_IMPLEMENTATION_PLAN.md`.

## Aktuální stav

- Scope alignment v6.2 z [PR #19](https://github.com/martymax/byzon-2026/pull/19)
  je sloučený do `main` merge commitem `277ec06`; CI bez skipů prošlo a
  následný security/code review nemá otevřený actionable nález.
- `P4-13` je sloučený do `main` přes
  [PR #20](https://github.com/martymax/byzon-2026/pull/20) merge commitem
  `1c52791`. Produkční Better Auth `/api/v1/me/*`
  zahrnuje private/no-store bootstrap, atomický onboarding, optimistic profil,
  event-scoped deletion request a session actions. Migrace
  `0006_woozy_the_professor.sql` přidává profilovou verzi a tabulku
  `privacy_requests`; nevznikla nová env proměnná. `BLOCKER-LEGAL-01` dál
  blokuje pouze finální právní obsah/UAT, ne tuto integraci.
- `P5-08` je sloučený do `main` přes
  [PR #21](https://github.com/martymax/byzon-2026/pull/21) merge commitem
  `5433cbb`. `CS-ROSTER-01` a produkční
  `/host/aktivity` používají Better Auth, canonical event a aktivní
  session-scoped `room_operator` assignment. List/detail vrací jen bounded
  reservation reference, stav, jméno a firmu; networking, attendance,
  kontakty, ticket data a export nejsou součástí řezu.
- `P5-01`/`P5-02` a transakční jádro `P5-03` jsou sloučené do `main` přes
  [PR #22](https://github.com/martymax/byzon-2026/pull/22) merge commitem
  `501fa55`; přesný rozsah a otevřené produktové hranice jsou v samostatné
  sekci níže.
- `P5-05` je sloučené do `main` přes
  [PR #24](https://github.com/martymax/byzon-2026/pull/24) merge commitem
  `140ae8c`: participant cancel do začátku session, reasoned admin
  cancel/capacity override a produkční reservation-only admin UI. Waitlist
  promotion je vypnutá do `P5-04`.
- `P5-06`/`F3-06` jsou sloučené do `main` přes
  [PR #25](https://github.com/martymax/byzon-2026/pull/25) merge commitem
  `9e2be72` jako dvě source-verified řady nad
  snapshotem `Pátek!G1:I18`: Radim Roček 12 slotů a Stanislava Maunová 14
  slotů, vždy 30 minut, kapacita 1, cutoff v začátku a bez waitlistu. Import i
  migrace nahrazují 11 legacy placeholderů fail-closed a canonical agenda
  nezveřejňuje identitu rezervujícího.
- `P5-09` zapojuje produkční `GET /api/v1/me/agenda.ics` nad stejným
  autorizovaným, owner-scoped a pod participant lockem znovu načteným canonical
  snapshotem jako JSON. Neprázdná live agenda nabízí privátní no-store download
  se stabilním ne-PII UID, publication sequence, UTC, CRLF, Unicode-safe
  75octetovým foldingem a `STATUS:CANCELLED`; prázdná agenda zůstává `empty`.
- `P5-07` bylo 21. 8. 2026 znovu ověřeno proti autoritativnímu produktovému
  dokumentu včetně všech komentářů. Revize se od 15. 8. nezměnila a stále
  nedodává číselnou kapacitu networkingu ani waitlist/storno režim, proto úkol
  korektně zůstává fail-closed za `BLOCKER-RES-01` bez náhradního estimate.
- `static-site/data/content.json` nyní deterministicky připraví 67 validních
  sessions a jednu položku `24:00 - ?` odmítá; coaching snapshot nahradí 11
  obecných placeholderů 26 přesnými slots, takže výsledný aktivní import má 82
  sessions. Dry-run i PostgreSQL regrese ověřují idempotenci a nepřevedené
  `span`/`compact` atributy. `P3-11` zůstává otevřený pro finální
  loga, FAQ, praktické kontakty a obsahové UAT k 31. 8.
- Recovery a identity potvrzení v produkčním buildu negenerují ani nezobrazují
  syntetický odkaz. Development helper i preview copy jsou v `src/test/mocks`
  a načítají se jen za pozitivním build-time dev/test guardem; production
  source/build boundary explicitně odmítá jejich nehlídaný import i výsledný
  text syntetické recovery akce. `pnpm dev:mock` si tak zachovává celý průchod.
- Bezpečnostní overrides připínají `brace-expansion 5.0.9`, `js-yaml 4.3.1`,
  `nanoid 3.3.18`, `postcss 8.5.23` a starou tranzitivní větev esbuild na první
  dostupnou opravenou řadu `0.25.0`. `pnpm audit` i `pnpm audit --prod` hlásí
  nula známých zranitelností.
- V6 gate z 16. 8. 2026 prošel nad všemi pěti migracemi a izolovaným
  PostgreSQL: database 81/81, conference server/unit 482/482, browser
  components 843/843 a Playwright E2E 15/15 bez přeskočených integrací.
  Formát, lint, sedm typechecků, produkční Next/worker build, source/build mock
  boundary, static smoke a oba dependency audity byly zelené.
- Lokální post-review gate z 20. 8. 2026 ověřil domain 174/174,
  nedatabázové conference server/unit testy 448/448 a cílený profilový browser
  průchod 108/108 ve třech viewports; relevantní typecheck, lint, formát,
  source mock boundary a oba audity jsou zelené. Nová databázová regrese pro
  nekonzistentní onboarding replay se na tomto stroji načetla, ale spolu s
  dalšími 34 DB scénáři byla bez `TEST_DATABASE_URL` přeskočená. Pokus o
  izolovaný PostgreSQL zablokoval sandbox na systémové sdílené paměti.
- [CI run 32377970145](https://github.com/martymax/byzon-2026/actions/runs/32377970145)
  následně prošel na headu `85f6081` bez skipů: database 81/81, domain
  174/174, conference server/unit 483/483 včetně 4/4 onboarding integrací,
  browser components 846/846 a Playwright E2E 15/15. Migrace, seed, frozen
  install, formát, lint, typecheck, produkční Next/worker build, source/build
  mock boundary, audit i samostatný static-site job jsou zelené.

- Better Auth session má nově 48hodinovou expiraci a zachovaný 24hodinový
  refresh aktivní relace. Aplikace nemá samostatný idle logout, takže neaktivní
  uživatel zůstane přihlášený po celé dvoudenní konferenční okno a aktivní
  relace se před jeho koncem průběžně prodlouží. Regresní test připíná přesných
  48 hodin a PostgreSQL integrační test dál ověřuje skutečné databázové
  `expires_at`.
- Celý frontendový track `F0` až `F6-05` je dokončený ve stavu
  `UI ready (mocked)` a [PR #17](https://github.com/martymax/byzon-2026/pull/17)
  byl sloučen do `main` merge commitem `64f1b84`. Syntetické preview
  se spouští jediným příkazem `pnpm dev:mock`; root nabízí rovnou passwordless
  přihlášení a aktivaci vstupenky, ostatní průchody jsou dostupné na přímých
  routes `/app`, `/admin`, `/check-in` a `/offline`.
- Propojené průchody pokrývají aktivaci, identity/onboarding/recovery,
  participant home/program/agendu/oznámení/vstupenku/účet, kompletní admin
  provoz a obsah, check-in confirm/undo i PWA/offline lifecycle. Přesné vstupy,
  routes a scénáře jsou v `docs/frontend-implementation-report.md`.
- Security a code review všech etap i pozdní post-review oprav skončily
  `PASS`. Finální hardening uzavřel agenda owner/epoch race, stale auto-sync,
  mock dependency boundary, E2E preview parity, React keyed-children warning a
  novou high-severity `brace-expansion` advisory. Následný PR rereview navíc
  oddělil mock-only participant a archivní navigaci/agendu od produkčního
  režimu; oba P1 thready jsou opravené, otestované a uzavřené.
- Před-merge gate PR #17 byl zelený: 747 unit/integration testů, publication
  4/4 proti PostgreSQL 17, browser komponenty 840/840, Playwright E2E 15/15,
  Prettier, ESLint, sedm typechecků, static smoke, produkční Next/worker build,
  source/post-build mock boundary a standalone runtime smoke.
- Produkční build PR #17 obsahoval 25 statických app stránek a 26 digestovaných
  offline assetů. Service worker měl 24 057 B, standalone server vrátil `200`
  pro root/offline/PWA assety/ikony/health a mock runtime v produkčních
  chunkech není.
- Následná korekce rootu na přímé přihlášení prošla 29/29 cílenými unit/PWA
  testy, 45/45 browser component běhy, 15/15 mock E2E scénáři a static smoke
  všech 25 stránek. Aktuální offline shell má 27 assetů včetně oficiálního
  loga, manifest
  `ec4b7f4743633482876c658d157532327303ae529da2b1613f5198871a475556`
  a service worker 24 142 B.
- Legacy `minimatch 3.1.5` si zachovává malý reprodukovatelný API adapter
  patch pro moderní `brace-expansion`; aktuální přesné bezpečné verze a nulový
  audit jsou uvedené v baseline bodu výše.
- Produkční claim/recovery handshake, skutečný ticket credential, SimpleShop
  synchronizace, offline lease/replay, staging UAT a fyzická zařízení
  zůstávají správně backend/provozními handoffy. Účet, profil, onboarding,
  privacy minimum a session controls už mají autorizované produkční endpointy.

## Dokončená práce (`P8-01`, PR #23)

- Samostatný infrastrukturní PR `#23` byl integrován do `main`; agenda PR `#22`
  na něj navazuje až po rebase, takže Redis základ zůstal oddělený.
- Nový `@byzon/redis` připíná ioredis `6.0.0` a nabízí lazy connection pro web
  i BullMQ worker. Web má bounded connect/command timeout,
  `maxRetriesPerRequest=1`, vypnutou offline queue a žádné pozdní resend;
  worker používá pro blocking commandy `maxRetriesPerRequest=null`, neomezený
  request retry a bounded exponential reconnect. `family=0` zachovává Railway
  dual-stack DNS; `4`/`6` jsou pouze explicitní provozní override.
- Sdílený Redis rate-limit provider používá jeden atomický Lua fixed window.
  Přijme jen přesný `byzon:rate-limit:<scope>:<64hex HMAC>` bucket, takže raw
  IP, e-mail, user ID ani device hodnota se do Redis nedostane. Samostatný
  `RATE_LIMIT_SUBJECT_SECRET` a length-prefixed HMAC helper oddělují prostředí
  i význam jednotlivých subject částí.
- `/health/ready` kontroluje DB a Redis paralelně. Nedostupná DB vrací `503`,
  samotný výpadek Redis vrací `200` se stavem `degraded`; DTO obsahuje pouze
  stav a `redisPingMs`. Connection error log neobsahuje URL/provider detail, je
  omezený na jeden warning za minutu a po obnově vydá jediný recovery log.
  Worker před startem ověří DB i Redis, zaloguje jejich stav/latenci a při
  `SIGTERM`/`SIGINT` obě spojení uzavře.
- Staging/production nově vyžadují explicitní `REDIS_URL` a samostatný HMAC
  secret. Přibyly `REDIS_FAMILY`, Redis timeouty, versionovaný `compose.yaml`,
  root `dev:infra`/`dev:infra:down`, Redis 8.2 CI service a staging runbook.
  Redis/BullMQ používá `maxmemory-policy=noeviction`; native optional
  `msgpackr-extract` build je supply-chain politikou explicitně zakázaný a
  ověřený JS fallback funguje. Databázové schéma ani migrace se nemění.
- Plný lokální gate proti izolovanému PostgreSQL 17 a Redis 8.2 prošel bez
  skipů: config 11/11, Redis 8/8, database 89/89, domain 174/174, UI 7/7,
  test-support 37/37 a conference 519/519, tedy 845 workspace testů. Následný
  self-review doplnil bounded listener cleanup a counter cap; finální Redis
  sada prošla 9/9, takže aktuální agregát je 846 testů. Redis integrace ověřila
  50 souběžných inkrementů ze dvou spojení, odmítnutí raw subjectu, bounded
  zamítnutý counter a reálnou kompatibilitu BullMQ `6.1.2`.
- Prošly Prettier, všechny linty a osm typechecků, produkční Next/worker build,
  source/build mock boundary, static smoke 25 HTML/58 assetů, browser
  komponenty 846/846, Playwright E2E 15/15 a oba dependency audity bez známé
  zranitelnosti. Standalone runtime smoke ověřil `ready → degraded → ready`,
  jednu throttled warning zprávu, recovery log a worker startup/shutdown.
- Agenda PR `#22` nyní provider používá přes explicitní read/mutation scope;
  ostatní API route musí dál samostatně zvolit subject a outage politiku.

## Dokončená práce (`P5-01`, `P5-02`, jádro `P5-03`, PR #22)

- Migrace `0008_pretty_firebrand.sql` přidává versioned
  `participant_agendas` a event/user/session-scoped `agenda_items` se složenými
  membership/session FK. Rezervace zůstávají samostatnou provozní autoritou a
  do agendy se promítají při čtení; session attendance/no-show nevzniká.
- Produkční `GET /api/v1/me/agenda` a
  `POST /api/v1/me/agenda/actions` používají Better Auth, canonical event a
  poslední immutable publication snapshot. DTO jsou bounded,
  `private, no-store`; add/remove/reserve vyžadují optimistic version,
  idempotency a exact same-origin JSON. Live `/app/agenda`, home a detail
  programu už nejsou omezené na development preview.
- Rezervace vyžaduje uloženou položku, aktivovanou vstupenku, publikovanou
  nenetworkingovou session a explicitní kapacitu. Owner, sdílený content a
  event/session advisory lock, nový autoritativní čas po získání locků,
  count+insert v jedné transakci a PostgreSQL race testy zaručují jediného
  vítěze posledního místa a nepovolí rezervaci souběžnou se stornem nebo po
  cutoffu. Aplikované add/remove/reserve zapisují ve stejné transakci minimální
  audit; replay/no-op nový audit nevytváří.
- Živý Harmonogram BYZON 2026 byl znovu přečten: import/migrační backfill
  bezpečně nastavuje EB21 na 12 a dva sobotní workshopy na 20, s cutoffem v
  začátku session a vypnutým waitlistem. `P5-06` doplnilo dvě paralelní
  coaching řady; nejsou zploštěné do chybného společného slotu.
  Dvoudílný sobotní mastermind s kapacitou 6 čeká na nový
  `BLOCKER-RES-05`, zda jedna rezervace pokrývá obě části.
- Stav sloučeného PR záměrně odmítal cancel/waitlist/offer akce a pro tehdy
  nehotový `.ics` vracel poctivé `not_ready`. Následné `P5-05` zapojilo cancel
  a `P5-09` osobní `.ics`; waitlist/offer zůstávají v `P5-04` a networking za
  `BLOCKER-RES-01`.
- Security/code review doplnil kontrolu aktivované vstupenky, audit a fail-closed
  ověření provozní session proti publication allowlistu. Review PR `#22`
  navíc opravil běžné snapshot-published zdrojové řádky ve stavu `draft`,
  minimalizoval uložený idempotency receipt, vynutil limit 512 položek, zachoval
  konzervativně zavřenou potvrzenou rezervaci při capacity driftu s operator
  warningem, skryl server-disabled offer akce a před backfillem atomicky ověřuje
  všechny tři provenance/title/time targety. Následné Codex review navíc
  serializovalo rezervaci s provozním stornem, přesunulo cutoff kontrolu za
  locky a pro replay překonaný pozdější opačnou mutací zavedlo explicitní
  canonical výsledek `superseded` bez ukládání privátního snapshotu. Další
  review rozšířilo stejnou ochranu i na první odpověď po commitu a změnilo add
  nad existující rezervací nebo viditelným waitlistem na čistý no-op bez nové
  verze, auditu či duplicitní uložené vrstvy. Finální review navíc serializuje
  GET snapshot participant lockem, hlídá 512 unikátních položek přes sjednocení
  save/reservation/waitlist ještě před add a dovolí odstranit uloženou session
  zrušenou v poslední publikaci. Následná kontrola přesunula snapshotový
  `serverNow` až za participant lock a zachovala exact-key replay i po novější
  publikaci, která cílovou session odstranila. Downstream roster nyní používá
  stejný latest-publication allowlist, takže nová rezervace nad běžným
  importovaným `draft` řádkem je viditelná přiřazenému operátorovi. Poslední
  review navíc zachovává aktivní waiting projekci i po uvolnění místa, ale s
  vypnutými akcemi až do canonical FIFO promotion, a její pořadí počítá živě
  pouze mezi aktivními waiting řádky. Session odebrané z poslední publikace se
  nezobrazují ani neblokují limit 512, jejich vlastní uloženou agenda vrstvu
  však lze idempotentně uklidit. Následný review hardening zachovává waiting
  projekci jako bezpečně uzavřenou a operator-visible i při ztrátě provozní
  kapacity/type policy. Migrační backfill navíc drží rezervační tabulkový lock
  a odmítne nastavit kapacitu pod počet již potvrzených rezervací; čerstvá
  PostgreSQL regrese ověřila odmítnutí 13 rezervací pro kapacitu 12. Poslední
  retention review navíc revaliduje aktuální eventový anonymizační
  deadline i eventovou fázi po participant a případných content/session
  locích: pozdní read nevrátí P2 snapshot ani po souběžné archivaci a
  pozdní mutation rollbackne agenda i idempotency zápis po cutoffu nebo
  souběžném ukončení eventu. Stejný post-lock gate znovu ověřuje aktivní
  membership a participant roli, takže souběžná revokace nepropustí privátní
  GET ani zápis. Exact-key replay po `ended` zůstává dostupný přes read-only
  canonical snapshot; nová mutace je nadále odmítnuta uvnitř non-replay callbacku.
  Immutable publication nyní uchovává server-only rezervační okno, které
  public/participant program DTO odstraňují, ale agenda používá jako živý cutoff
  až do další publikace; migrace `0009` ho z dosavadní autoritativní hodnoty
  backfilluje i legacy publikacím, takže ho nepublikovaný import časů nezmění.
  Conflict odpovědi se po rollbacku překlasifikují podle čerstvé canonical
  projekce a souběžné storno/změna kapacity již nevede na schema `500`.
  Latest immutable publication se po participant locku rovněž znovu načte pro
  GET i non-replay mutation callback, takže agenda version, položky a
  publication version tvoří jeden canonical bod i při souběžném publish/add.
  PostgreSQL race sada má 28/28 agenda HTTP scénářů. Po rebase a rate-limit zapojení
  prošel izolovaný PostgreSQL po všech deseti migracích, Redis integrační sada
  9/9, agenda HTTP 28/28 a conference 556/556 bez skipů. Globální
  gate prošel bez lint chyb včetně 890 workspace testů, všech
  typechecků, produkčního Next/worker buildu, source/build mock boundary a
  static smoke 25 HTML/58 assetů. Browser komponenty prošly 849/849,
  Playwright E2E 15/15 ve třech viewports a úplný i production-only dependency
  audit hlásí nula známých zranitelností.
- Po rebase na integrované `P8-01` používá GET atomický
  `participant_agenda.read` bucket 120/min a při nedostupném Redis explicitně
  failne otevřeně s throttled PII-free warningem. POST používá
  `participant_agenda.mutation` 30/min a failne zavřeně ještě před DB a
  idempotency prací. Subject je environment-keyed HMAC canonical event slugu a
  user UUID; povolené odpovědi nesou rate-limit hlavičky a vyčerpání vrací
  kontraktové `429 RATE_LIMITED`.

## Dokončená implementace (`P5-05`)

- Participant `cancel` používá stejné owner → content → session lock pořadí
  jako rezervace. Cutoff je immutable publikovaný začátek session; před ním
  se confirmed reservation atomicky změní na `cancelled`, zvýší agenda
  version a zapíše minimální audit. V cutoffu a později vrací canonical
  `RESERVATION_CLOSED`. Exact replay nevytváří druhý audit a starý cancel
  replay po novější re-reservation vrátí `superseded` snapshot.
- Produkční admin endpointy `GET /api/v1/admin/context`,
  `GET /api/v1/admin/events/:eventId/reservations` a
  `POST /api/v1/admin/events/:eventId/reservations/actions` jsou Better Auth,
  current-event a permission scoped, bounded a `private, no-store`. Organizer
  může po povinném reason a novém potvrzení snapshotu zrušit rezervaci i po
  participant cutoffu nebo změnit kapacitu; snížení pod confirmed count je
  odmítnuté a obě akce jsou idempotentní a auditované.
- Admin reservation read a mutation mají samostatné one-minute shared Redis
  buckety 120/30, environment-keyed HMAC subject canonical event slugu a user
  UUID a fail-closed outage politiku. Mutace spotřebuje bucket před databází a
  idempotency prací; raw identifikátor se do Redis klíče nedostane.
- `/admin/rezervace` je v produkci live v omezeném reservation-only režimu.
  Audit browser a event settings se nenačítají ani nezobrazují, dokud je
  nedokončí `P9-04`/`P9-09`; development preview si zachovává plný mock.
  Produkční admin navigace ukazuje jen skutečně integrovaný přehled,
  rezervace a obsah.
- Uvolněná kapacita sama nepromuje FIFO waitlist; to patří výhradně do
  `P5-04` po rozhodnutí `BLOCKER-RES-04`. `BLOCKER-RES-03` je rozhodnutý:
  transfer/storno má zrušit aktivní rezervace a uvolnit kapacitu. Samotné
  napojení na budoucí ticket transition zůstává v `P4-09`.
- Service-backed workspace gate prošel 905/905 bez skipů: database 94/94,
  Redis 9/9 a conference 571/571; cílená PostgreSQL 17 sada
  participant/admin rezervací má 37/37. Browser komponenty prošly 852/852 a
  Playwright E2E 15/15 ve třech viewports. Zelené jsou Prettier, všechny linty
  a typechecky, production web/worker build, source/build mock boundary,
  statický smoke 25 HTML/58 assetů a oba dependency audity.

## Dokončená práce (`P5-08`, PR #21)

- Přidány read-only endpointy `GET /api/v1/activity-roster` a
  `GET /api/v1/activity-roster/:sessionId`. Identitu odvozují výhradně z Better
  Auth, event ze serverového slugu a session scope z aktivní `room_operator`
  role; unknown a nepřiřazený detail mají stejný `ROSTER_NOT_FOUND`.
- Produkční `/host/aktivity` už není 404-only preview a vykresluje stejný live
  serverový loader. Development mock zůstává dostupný jen za pozitivním
  preview guardem a není součástí production dependency grafu.
- Migrace `0007_living_magik.sql` doplňuje nullable profilovou firmu a minimální
  kanonický read-model základ `reservations`/`waitlist_entries` se složenými
  event FK, partial unique aktivními stavy a stabilní unikátní FIFO pozicí.
  Nevytváří agenda write flow, nevolí `RES-04` promotion režim a nepřidává
  blokovanou networkingovou kapacitu.
- Server promítá pouze sessions z poslední validní immutable publication,
  které mají aktivní provozní řádek `draft`/`published` s
  `capacity_mode=reservation` a nejsou networking. Tím podporuje běžný
  importovaný stav `draft` bez
  zpřístupnění nepublikovaných sessions. Membership musí být aktivní a do
  rosteru vstupují jen confirmed/waiting řádky. SQL dotazy i DTO jsou bounded;
  response je `private, no-store`, vary Cookie + Authorization a DTO nevrací
  user ID, telefon, e-mail, ticket ani attendance.
- Security review doplnil SQL limit před kontraktovou projekcí. Code review
  ověřil fail-closed malformed/revoked/cross-event scope, nerozlišující detail
  404, retenční stop na `operationalDataAnonymizesAt`, deterministické pořadí,
  composite FK a oddělení blokovaných produktových rozhodnutí. Nezůstává
  otevřený actionable nález. Opakovaný globální gate navíc odhalil a opravil
  starší auth integrační test, který počítal cizí paralelní session místo pouze
  vlastního testovacího uživatele; produkční session logika se nezměnila.
- Izolovaný PostgreSQL po všech sedmi migracích a seedu prošel: database 89/89,
  conference 514/514, cílené roster/page scénáře 14/14 a activity-roster
  browser/axe průchod 6/6 ve třech viewports. Celá browser component sada
  prošla 846/846 a Playwright E2E 15/15. Globální `pnpm run ci` prošlo včetně
  829 workspace testů, formátu, lintů, typů, produkčního Next/worker buildu,
  source/build mock boundary a statického smoke 25 HTML/58 assetů; production
  i úplný dependency audit hlásí nula známých zranitelností.
- `CS-ROSTER-01` a capability Roster vedoucího aktivity jsou `integrated`.
  Následný agenda write řez je popsán v aktuální sekci výše; `P5-04` dál
  čeká na `BLOCKER-RES-04`.

## Dokončená práce (`P4-13`, sloučeno přes PR #20)

- Přidány autorizované endpointy `GET /api/v1/me/bootstrap`,
  `POST /api/v1/me/onboarding`, `PATCH /api/v1/me/profile`,
  `POST /api/v1/me/privacy-requests` a `POST /api/v1/me/session-action`.
  Identita i event vznikají jen z Better Auth session a serverového canonical
  event slugu; klient neposílá vlastní user/event scope.
- Bootstrap vrací pouze contract-validní live data, aktuální publikované právní
  dokumenty jako bezpečný plain text nebo credential-free HTTPS URL, efektivní
  acknowledgement, eventové role, feature flags a privacy stav. Všechny
  odpovědi jsou `private, no-store` a `Vary: Authorization, Cookie`.
- Onboarding, privacy a session mutace používají hashované idempotency keys,
  uložené response DTO a transakční business zápis. Onboarding navíc používá
  deterministický UUID pro append-only consent deduplikaci; po dokončení už
  nemůže novým klíčem obejít optimistic profil. Session action umí přesný
  bounded replay i po revokaci původní cookie bez vrácení PII.
- Migrace `0006_woozy_the_professor.sql` přidává `participant_profiles.version`
  s minimem 1 a event/user/kind unikátní `privacy_requests` s konzistentními
  pending/completed/rejected stavy. Je dopředně kompatibilní se starší aplikací;
  rollback aplikace může nové sloupce/tabulku bezpečně ignorovat. Nová env
  proměnná nevznikla.
- Security review ověřil auth, CSRF Origin, IDOR/event scope, PII/audit,
  bounded JSON/legal obsah, souběh a replay. Code review opravil dva actionable
  nálezy: zákaz profilového bypassu přes nový onboarding key a atomický přesný
  replay onboardingu/session action po změně právní verze nebo revokaci cookie.
  Po opravách nezůstává otevřený severity 1/2 ani jiný actionable nález.
- Izolovaný PostgreSQL průchod po všech šesti migracích a seedu prošel:
  database 83/83 a conference 502/502 bez skipů. Cílené identity/onboarding/
  Better Auth/idempotency regrese prošly 33/33 a relevantní browser component
  sady onboarding/account/session 183/183 ve třech viewports. Playwright E2E
  prošlo 15/15 nad připravenou PostgreSQL ve phone/tablet/desktop viewportu. Globální
  `pnpm run ci` prošlo včetně formátu, lintů, typů, workspace testů,
  produkčního Next/worker buildu, source/build mock boundary a statického smoke
  25 HTML/58 assetů; oba dependency audity hlásí nula známých zranitelností.
- `BLOCKER-LEGAL-01` dál blokuje jen finální právní obsah a UAT. Agregovaná
  aktivace zůstává `UI ready (mocked)` kvůli claim/recovery handshaku, ale
  `CS-BOOT-01` a Priority A účet/profil/soukromí jsou `integrated`. Následující
  doporučený `P5-08` byl dokončen v samostatném řezu výše.

## Historický průběh frontendové větve

Následující body zachovávají etapový stav v okamžiku jednotlivých commitů.
Aktuální souhrn a konečné počty jsou výše.

- `F3-01` až `F3-05` jsou na `track/frontend-complete` po závěrečném security
  a code review ve stavu `UI ready (mocked)`; oba review skončily `PASS` bez
  nevyřešeného actionable nálezu. `F3-06` zůstává správně blokovaný přes
  `BLOCKER-RES-02`.
- `/app/agenda` nabízí kompletní syntetický průchod přes uložené body,
  rezervace, kapacitní stavy, čekací listinu, časově omezenou nabídku místa,
  odhad účasti, konflikty a `.ics` export. Agenda je napojená na detail
  programu i domovský přehled a pátý cíl primární navigace; návrat z detailu
  zachová přesný bezpečný origin a owner-scoped scroll.
- `CS-AGENDA-01` je strict event/user-scoped private/no-store kontrakt.
  Mutace korelují action, session, offer, version a canonical postcondition,
  rozlišují ponechaný saved zdroj od odstraněné projekce a při neurčitém
  výsledku opakují stejný idempotency key. 401/403, revokace a změna účtu
  okamžitě skryjí osobní data; rezervace se nikdy lokálně neslibuje.
- Finální `F3` gate je zelený: 124 domain testů, 28 fixture testů, 273
  conference unit testů, 36 očekávaně přeskočených DB scénářů a 618 Chromium
  component/axe/responsive scénářů ve třech viewports. Prošly Prettier,
  ESLint, relevantní typechecky, produkční Next build a source/post-build
  mock boundary.
- Celá etapa `F2` je na `track/frontend-complete` po závěrečném security a code
  review ve stavu `UI ready (mocked)`; oba review skončily `PASS` bez
  nevyřešeného actionable nálezu. Rozšířený `CS-BOOT-01` nese event/user
  scope, verzovanou správu profilového minima, úplný právní obsah nebo HTTPS
  odkaz, přesnou evidenci acknowledgement, privacy stavy a support e-mail.
- `/app/vice` je nový funkční hub pro profil, soukromí, nastavení, vstupenku,
  praktické informace, řečníky a partnery. Primární navigace má nyní pět cílů
  `Přehled / Program / Agenda / Oznámení / Více`.
  `/app/profil` podporuje canonical save, stale-version reload, lokální
  validaci a ochranu rozepsaných změn. `/app/soukromi` zobrazuje aktuální
  právní verze/evidenci pouze pro čtení a export/smazání odesílá až po
  explicitním potvrzení.
- Account resource načítá private/no-store bootstrap až na účetních routách,
  PII drží jen v paměti a failne zavřeně při pending, suspended, revoked,
  neparticipant roli nebo neshodě canonical event/user/version. Logout,
  switch-account a autoritativní revokace provádějí wipe. Stateful mock přejde
  do `synthetic_preview` active participant stavu až po úspěšném onboardingu,
  nic nepersistuje přes reload a nevytváří skutečnou Better Auth session ani
  membership.
- Finální `F2` gate je zelený: 113 domain testů, 27 fixture testů, 229
  conference unit testů, 36 korektně přeskočených DB scénářů a 510 Chromium
  component/axe/responsive scénářů ve třech viewports. Prošly Prettier,
  ESLint, všechny workspace typechecky, produkční Next build a source i
  post-build mock boundary.
- Etapové hardening regrese vážou všechny privátní resource na event,
  uživatele a session; 401/403, revokace i switch-account synchronně mažou
  PII. Archiv používá pouze domain-separated SHA-256 scope fingerprint,
  nikoli serializované event ID. Profil, privacy a session mutace odmítají
  stale nebo nekorelovaný canonical výsledek.
- Recovery odkazy nyní zachovají přesnou bezpečnou participant úlohu přes
  uzavřený allowlist statických tras, UUID detailů a bounded slugů. Mock token
  používá canonical base64url, fatal UTF-8 decode, opakovanou schema validaci
  a fingerprint-bound replay; jde výhradně o development transport, nikoli
  produkční autentizační důkaz.
- `F2-05` je na `track/frontend-complete` dokončený ve stavu
  `UI ready (mocked)`. Nový participant subset `CS-ANN-01` pokrývá privátní
  inbox, detail a online-only read včetně přesných problem kódů,
  idempotency, recipient oprávnění a validovaných syntetických fixtures.
  Produkční participant endpoint zůstává v `P8-06`, admin draft/audience/send
  v `P8-05`/`F4-06`; e-mail provider tento mocked řez neblokuje.
- `/app/oznameni` je dostupné z pěticestné participant navigace. Inbox má URL
  all/unread filtr reagující na Back/Forward, cursorové načítání se zachováním
  globálního newest-first pořadí, bezpečné prázdné/offline/auth/permission/
  disabled/error stavy a nebarevné read cues. Detail zachová filtr, načtenou
  hloubku a číselný scroll bez uložení announcement ID, obsahu nebo cursoru;
  read se spouští až po validovaném renderu a neurčitý retry drží stejný key.
- Závěrečný security i code review `F2-05` skončil `PASS`. Zapracované regrese
  failnou zavřeně při neshodě eventu/route ID, synchronně skryjí P1/P2 data
  při autoritativní revokaci, odříznou stale resource/filter race a v mocku
  vracejí bitově shodnou 404 pro neexistující i cizí recipient snapshot.
  Bounded return context se nejprve strict-validuje, po auth/revokaci maže a
  crafted URL nemůže spustit cursor request amplification.
- Finální `F2-05` gate prošel jako 144 conference unit testů a 36 korektně
  přeskočených DB scénářů, 68 domain testů, 22 fixture testů a 369 Chromium
  component/axe/responsive scénářů ve třech viewports. Prošly všechny
  workspace typechecky, ESLint, Prettier, produkční Next build a source/
  post-build mock boundary. Skutečný Next server nad izolovanou migrovanou a
  seednutou PostgreSQL vrátil `200` pro inbox i detail a použil stejný
  kanonický event ID jako mock DTO.
- Celá etapa `F1` je po závěrečném security a code review ve stavu
  `UI ready (mocked)`. Review opravil race při camera permission/claim/cancel,
  stabilní idempotency pro neurčité výsledky a přesné serverové
  `IDEMPOTENCY_*` kódy, autoritativní login gate, ochranu rozepsaného
  onboardingu, focus po stavovém přechodu a redigované mock diagnostiky.
- Jednorázové aktivační a recovery tokeny jsou jen v URL fragmentu, který se
  před explicitním consume okamžitě odstraní. Query token je odmítnutý a
  scrubbed; mock replay ukládá pouze SHA-256 fingerprint, rozlišuje stejný
  key/payload, key collision i dříve spotřebovaný token.
- Závěrečný gate prošel: 133 conference unit/contract testů a 36 korektně
  přeskočených DB scénářů, 87 domain testů, 18 fixture testů a 252 Chromium
  component/axe/responsive scénářů na třech viewports. Prošel ESLint,
  Prettier, typecheck, produkční Next build i source/post-build mock boundary.
- `F1-06` je dokončený na `track/frontend-complete`. Přesný syntetický
  already-active kód `TST-RECOVERY-2026` vrátí `recovery_required` a vede na
  samostatný neenumerující recovery formulář. E-mail se netrimuje ani
  nepersistuje a po neutral accepted odpovědi není zobrazený; syntetický
  recovery token se na `/aktivace/odkaz` okamžitě odstraní z URL a končí
  kontraktním `active → /app`.
- Mock replay jednorázového odkazu je vázaný na přesný token i idempotency key
  a vrací původní větev; jiný token nebo key je obecně odmítnutý.
  `/chyba-pristupu` zobrazuje pouze syntetický bezpečný access stav a opaque
  support referenci bez PII. `/app/nastaveni` zpřístupňuje logout current,
  logout all a switch account bez seznamu cizích účtů.
- Všechny session akce vyžadují potvrzení, korelují response action a až po
  canonical úspěchu spouštějí injektovatelný lokální wipe seam. Mock invaliduje
  syntetický owner/bootstrap kontext, ale výslovně přiznává, že skutečná Better
  Auth session nebyla změněná. `CS-BOOT-01` nově odmítá role u pending,
  suspended i revoked membership.
- Cílené výsledky jednotlivých F1 kroků zůstávají níže jako historická
  evidence; autoritativní závěrečné počty jsou uvedené v úvodu tohoto stavu.
- `F1-05` je dokončený na `track/frontend-complete`. Nový `CS-BOOT-01`
  striktně popisuje private/no-store `/me/bootstrap` a idempotentní
  `/me/onboarding`: event, minimální identitu, pending/active access bez
  důvěry v klientskou roli, profil, feature flags, privacy minimum, onboarding
  stav a právě aktuální právní dokumenty. Pending aktivace nenese role a live
  data nesmí přijmout syntetické právní preview.
- Development-only `/onboarding` vede kroky profil → podmínky/privacy →
  dobrovolný networking. Jméno a e-mail kanonizuje podle domény, povinné
  dokumenty potvrzuje přes exact ID/verzi a networking začíná bez předvolby;
  opt-out neposílá networking consent ID, opt-in má samostatné potvrzení.
  Back zachová jen in-memory draft, opuštění je chráněné a URL, local/session
  storage, cache ani offline mutace P2 data nedostanou.
- Chybějící/nepublikované či stale právní verze zastaví submit a zruší staré
  checkboxy. Syntetické texty jsou výslovně označené jako neschválený draft.
  Same-tick lock propustí jeden submit a neurčitý retry znovu použije stejnou
  idempotency key; deterministický problem ji zahodí. Mock nikdy nevytvoří
  skutečnou Better Auth session, membership nebo consent record.
- Ověření `F1-05` prošlo jako 109 conference testů (36 DB scénářů korektně
  přeskočeno), 118 domain/UI/test-support testů a 27 onboarding komponentových
  scénářů na třech viewports včetně axe, overflow a `44 px`. Prošly také
  cílený ESLint, Prettier, typecheck, produkční Next build a source/post-build
  mock boundary. Produkční právní UAT zůstává za `BLOCKER-LEGAL-01` a skutečný
  autorizovaný zápis za `P4-13`.
- `F1-04` je dokončený na `track/frontend-complete`. Po manual/camera claimu
  používá CTA klientskou Next navigaci, aby dev/test MSW zachoval syntetický
  serverový pending stav. `/prihlaseni` vždy znovu čte landing
  `claim_in_progress`; flow ID, e-mail ani ticket kód neukládá do URL,
  history, cookie, local/session storage, IndexedDB ani Cache API.
- Identity form přesně validuje e-mail a allowlisted `returnTo` (`/app` nebo
  `/onboarding`), koreluje response `flowId`, má focusovatelný error summary,
  same-tick submit lock a pro neurčitý offline/transport retry znovu použije
  stejnou idempotency key. `link_sent` zůstává neenumerující a výslovně
  potvrzuje, že mock nevytvořil session ani membership.
- `/aktivace/odkaz` nečte token v RSC. Client effect vezme právě jednu hodnotu
  z URL fragmentu pouze do ref a před akcí nahradí URL čistou route se
  zachováním `history.state`; query token odmítne. Route má `noindex`,
  route-specific
  `Referrer-Policy: no-referrer` a `Cache-Control: private, no-store`.
  Explicitní consume je zamčený, při neurčitém retry drží stejný token/key jen
  v paměti a terminální stav pokračuje pouze na kontraktem povolený
  `/onboarding`.
- Dev MSW modeluje claim → landing pending → identity → one-time link v paměti,
  validuje každý body/idempotency key a stejnou link key replayne; jiná key po
  spotřebování dostane generické odmítnutí. Skutečný Better Auth endpoint,
  user, session ani membership se nepoužije; produkční handoff zůstává za
  `BLOCKER-AUTH-01`/`P4`.
- Ověření `F1-04` prošlo jako 105 conference testů (36 DB scénářů korektně
  přeskočeno), 81 domain testů a 84 cílených komponentových scénářů na třech
  viewports včetně axe, overflow a `44 px`. Prošly také ESLint, Prettier,
  typecheck, produkční Next build a source/post-build mock boundary.
- `F1-03` je dokončený na `track/frontend-complete`. Development-only
  `/aktivace/skenovat` nejprve přes landing kontrakt ověří otevřenou fázi,
  anonymní flow a serverem povolené `camera_scan`; teprve potom po explicitním
  kliknutí žádá o browser camera permission. Global response header omezuje
  kameru na `Permissions-Policy: camera=(self)`.
- Scanner drží stream pouze v paměti, neukládá obraz ani QR a odpojí video i
  zastaví všechny tracks při cancel, unmountu, Back/pagehide, skrytí tabu a
  pozdním doběhnutí permission promise. Claim lock propustí nejvýše jeden
  idempotentní `camera_scan`; default mock generuje jednorázovou validní
  hodnotu za běhu, takže v produkčním bundle není fixture secret.
- `CS-ACT-01` nově odmítá nabídku kamery bez `manual_code` fallbacku a
  aktivační landing vykresluje pouze serverem povolené metody. Scanner má
  explicitní requesting/scanning/cancelled/denied/unsupported/unavailable/
  offline/rate-limit/rejected/session-expired/error/success stavy a v každém
  nedokončeném průchodu bezpečný návrat nebo ruční zadání.
- Ověření `F1-03` prošlo jako 81 domain a 92 conference unit/contract testů
  (36 DB scénářů korektně přeskočeno), 42 cílených browser scénářů na třech
  viewports, axe/overflow/`44 px`, lint, Prettier, typecheck a produkční Next
  build včetně source/post-build mock boundary. Build obsahuje
  `/aktivace/skenovat`, ale žádný test-support/MSW runtime.
- `F1-02` je dokončený na `track/frontend-complete`. Development-only
  `/aktivace/kod` zachovává opaque kód přesně bez trim/case transformace,
  neukládá jej do URL ani draftu, používá no-store typed request s
  idempotency key a odmítnutí mapuje na jedinou neenumerující zprávu.
  Kanonický dev/test kód je `TST-OPAQUE-2026`; po jeho přijetí UI výslovně
  sděluje, že nevznikl skutečný účet, membership ani session.
- Mock handler validuje body i idempotency key a přijme jen kanonický
  syntetický kód. Regrese odhalená React Strict Mode testem opravila mounted
  guard asynchronního submitu. Cílené contract/MSW testy a 12 browser
  komponentových scénářů na třech viewports procházejí; route má lokální
  validaci, focus na error summary, obecný rejected stav, axe, `44 px` input
  a kontrolu overflow.
- `F1-01` je implementovaný na `track/frontend-complete`. Nový
  `CS-ACT-01` striktně popisuje landing, opaque claim, identity handoff,
  one-time link a neenumerující recovery včetně no-store, secrets a
  same-origin `returnTo` hranic. Validované fixtures vždy uvádějí
  `membershipCreated: false` a `sessionCreated: false`, dokud skutečný
  handshake neodemkne `BLOCKER-AUTH-01`.
- Development-only `/aktivace` pokrývá anonymní, rozpracovaný, aktivovaný,
  suspended, před/po/archivně uzavřený, loading, offline, error a
  session-expired stav. Root v developmentu nabízí přihlášení a odkazuje na
  aktivační mock průchod; `pnpm dev:mock` jej spustí s viditelným syntetickým
  režimem. Cíleně prošlo
  21 unit/contract/fixture testů, 18 browser komponentových scénářů ve třech
  viewports, axe, overflow, `44 px`, ESLint, Prettier a typecheck.
- Kompletační práce pokračuje lineárně na
  `track/frontend-complete`. Foundation security/code audit před `F1`
  zpevnil mock runtime: neobsloužené same-origin `/api/**` požadavky včetně
  Better Auth selžou zavřeně, zatímco Next RSC, dokumenty a assety mohou
  normálně projít. Při selhání workeru platí stejná `/api/**` hranice.
- Syntetický participant program a obsah jsou dostupné pouze pro jediný
  kanonický event fixture; cizí event ID vrací bezpečné `404`.
  `participantContentResponseSchema` navíc odmítne rozdíl top-level event
  scope a `content.event.id`. Mock odpovědi nesou explicitní `no-store`,
  privátní varianty také `Vary: authorization, cookie`.
- Neintegrovaná `/app/vstupenka` je od foundation review v produkci tvrdě
  skrytá přes `404`; funkční data v development preview vyžadují explicitní
  `NEXT_PUBLIC_BYZON_API_MOCKS=enabled`. Test mock indikátor už na telefonu
  nepřekrývá spodní participant navigaci.
  Regresní výběr prošel 18/18 testů, cíleným ESLintem, Prettierem a
  domain/conference typecheckem.
- Dílčí řez `F2-06` je commitnutý jako `e387c3b` a pushnutý na
  `origin/track/frontend-b/F2-06-content-a11y`. Shell/program gate přidává
  redigovaný browser-side `axe-core` WCAG A/AA helper, skutečný participant
  layout nad validovanou syntetickou fixture, focus/touch/overflow/responsive
  geometrické kontroly, CDP reduced-motion kontrolu a jeden visual baseline
  pro každý schválený viewport. Ticketová část je nově pokrytá v `F2-04`;
  inboxová část je pokrytá v `F2-05` a celý `F2-06` zůstává otevřený už jen
  pro účet po `F2-07`.
- `F2-01` je commitnutý jako `8c4d1cc` a pushnutý na
  `origin/track/frontend-b/F2-01-participant-shell`. Participant layout používá sdílený
  `ParticipantNavigation` pro čtyři existující funkční cíle, každý s
  konzistentní ikonou a labelem. Segmentově bezpečné mapování udržuje
  `aria-current` i na detailu; telefon má fixed spodní navigaci se
  safe-area/content clearance, tablet a desktop sticky variantu. Root viewport
  má `viewport-fit=cover`; stávající skip link zůstává prvním focusovatelným
  prvkem.
- `F2-02` je commitnutý jako `ad6b5cf` a pushnutý na
  `origin/track/frontend-b/F2-02-home-overview`. `/app` už nepřesměrovává na
  program: používá serverový stav
  eventu, z publikovaného `CS-CONTENT-01` skládá phase-aware dnešní minimum,
  praktické informace a bezpečný před/po/archivní stav. Navigace má pátý
  funkční cíl `Přehled`; mobilní hierarchie drží jedinou dominantní CTA a
  konkrétní program nad spodní navigací.
- Produkce zatím nepředstírá osobní agendu. `ParticipantHome` umí přijmout
  budoucí `nextSavedSessionId`, ale zobrazí jej jen jako neukončený,
  nezrušený bod nalezený v publikovaném programu. Dokud není hotový
  `CS-AGENDA-01`, stránka místo syntetického personalizovaného stavu otevřeně
  vysvětluje, že uložené body v přehledu nejsou dostupné. `F2-02` proto
  zůstává otevřený také pro `CS-BOOT-01`, skutečnou agendu a phase-aware
  omezení navigace v archivním stavu.
- `F2-04` je commitnutý jako `73ef595` a pushnutý na
  `origin/track/frontend-b/F2-04-ticket-screen`. `/app/vstupenka` zobrazuje validovaný stav
  `valid/cancelled/refunded/blocked`, minimálního držitele a nejvýše
  čtyřznakový maskovaný suffix. Prezentační plocha má jediný povolený stav
  `unavailable`; žádná fixture, response schema ani DOM neobsahují QR,
  barcode, source ticket kód nebo presentation value.
- Nový status-only [`CS-TICKET-01`](packages/domain/src/contracts/ticket.ts)
  je privátní a `no-store`, odmítá unknown pole, nebezpečné control/bidi
  znaky, nekonzistentní status/reason i pokus dodat credential před
  `BLOCKER-TKT-05`. Typed klient `/api/v1/me/ticket` má bezpečné loading,
  offline, authentication, session-expired, not-found a invalid-response
  stavy; skutečný server endpoint zatím neexistuje a produkční integrace
  zůstává vlastnictvím `P4-12`.
- Security a code review `F2-04` zapracovaly limit suffixu na čtyři znaky,
  single-line holder allowlist, stavové invarianty a formulaci, která
  neslibuje budoucí credential. UI používá text i ikonu, nikoli samotnou
  barvu, a drží BYZON tokeny, focus, `44 px`, safe-area clearance a
  mobile-first hierarchii. Nezůstává otevřený actionable nález mocked řezu.
- Ověření `F2-04` prošlo cíleným ESLintem/Prettierem, domain, test-support a
  conference typecheckem, 74 domain testy, 17 test-support testy a 78
  conference unit/architecture testy; 36 DB scénářů se bez PostgreSQL
  korektně přeskočilo. Chromium component suite prošla 72/72 scénářů v 15
  souborech napříč `375 × 667`, `768 × 1024` a `1280 × 800`, včetně všech
  čtyř ticket stavů, privátní failure taxonomy, loading/offline, axe,
  overflow, `44 px` retry a tří visual baseline. Produkční Next build i
  source/post-build mock boundary prošly a obsahují `/app/vstupenka`, nikoli
  MSW ani test fixtures.
- Dílčí `F2-02` ověření prošlo cíleným ESLintem a Prettierem, conference
  typecheckem, 76 unit/architecture testy a 42 browser component testy ve 12
  souborech napříč `375 × 667`, `768 × 1024` a `1280 × 800`. Nový home řez
  kontroluje focus, nejméně `44 px` viditelné targety, overflow, axe,
  poctivý unavailable agenda stav, uzavřenou fázi bez content requestu a tři
  deterministické visual baseline. Produkční Next build i source/post-build
  mock boundary prošly.
- Focus management nyní omezeně sleduje asynchronně vykreslený route heading a
  zvládne i výměnu starého nadpisu za nový při klientské navigaci. Observer se
  odpojí po pěti sekundách a nikdy nevezme focus uživateli, který mezitím
  začal stránku ovládat. Detail řečníka aktivuje rodičovské `Řečníci` a
  zachovává kanonický návrat `/app/recnici`; programový detail dál zachovává
  query filtry a scroll.
- `F2-01` ověření prošlo jako 71 conference unit/architecture testů a 30
  browser component testů v 9 souborech napříč `375 × 667`, `768 × 1024` a
  `1280 × 800`; prošel cílený ESLint, Prettier, conference typecheck,
  `git diff --check`, produkční Next build a source/post-build mock boundary.
  Visual baselines byly zkontrolované, včetně čtyř plně čitelných mobilních
  cílů bez překryvu obsahu.
- E2E `conference-shell.spec.ts` byl rozšířen o ikony, aktivní stav, 44px
  geometrii, mobilní content clearance a `viewport-fit=cover`. Deep-link
  návrat zůstává v browser component testu nad validovanou fixture, protože
  základní CI DB seed záměrně neobsahuje syntetický profil řečníka. Lokálně
  proběhly pouze tři DB-independent reduced-motion scénáře; dev server pak
  správně vracel `/health/ready` 503 a participant server routy skončily před
  renderem na `ECONNREFUSED`, protože neběží PostgreSQL. Úplný scénář zůstává
  pro DB-backed GitHub CI.
- Security a code review úplného `F2-01` diffu proběhly. Zapracované nálezy
  doplnily chybějící iOS `viewport-fit=cover` a zpevněný focus při výměně
  asynchronního nadpisu. Navigační konfigurace je statická, nevykresluje data
  uživatele, observer je bounded a safe-area rezervuje prostor i pro obsah.
  Nezůstává otevřený actionable security ani code-review nález.
- Security a code review dílčího `F2-02` diffu proběhly. Zapracované nálezy
  odmítají skončenou session jako „další uložený bod“, odlišují po-akční copy
  od pokynů před cestou a správně označují oba konce vícedenního rozsahu
  samostatnými `<time>` prvky. Fázi dodává serverový event status, živý stav se
  neodhaduje, dynamické ID se přijme jen proti publikovanému allowlistu a
  draft/archiv nevyvolává content request. Nezůstává otevřený actionable nález
  tohoto dílčího řezu.
- Frontendový řez `F2-03` je commitnutý jako `ece9c10` a pushnutý na
  `origin/track/frontend-b/F2-03-content-contract`. `CS-CONTENT-01` v
  [`packages/domain/src/contracts/content.ts`](packages/domain/src/contracts/content.ts)
  nyní definuje striktní publikovaný program, directory/practical DTO, query a
  přesné problem uniony i cache/offline/PII hranici. Serverové P3 snapshot
  extraktory, response validace, typed browser `ApiPort`, dev MSW handlery a
  syntetické fixtures používají stejný runtime kontrakt.
- Security a code review dílčího `F2-06` diffu proběhly. Zapracovaný nález
  přesunul `axe-core` k conference jako explicitní dev dependency a rozšířil
  architecture i production source/build guard, aby se browserový audit
  runtime nemohl dostat do produkce. Axe chyba vypisuje pouze rule metadata a
  počty uzlů, baseline obsahují výhradně validované syntetické fixtures a CDP
  media emulace se po testu úplně resetuje. Nezůstává otevřený actionable
  security ani code-review nález tohoto dílčího řezu.
- Participant program, detail, řečníci, partneři a praktické informace mají
  bezpečné loading/empty/offline/authentication/session-expired/permission/
  invalid-response stavy s retry, pouze validovanou request referencí a bez
  vykreslení serverového `detail`. Filtry programu se zachovávají v URL a
  session-scoped continuity storage, návrat z detailu je nese dál a scroll se
  obnovuje bez smooth motion. Route change přesouvá focus, dlouhý český obsah
  se bezpečně zalamuje a interakce dodržují `44 px`, viditelný focus a
  `prefers-reduced-motion`.
- Security a code review `F2-03` proběhly. Zapracované nálezy: browser přestal
  importovat serverový typ a všechny odpovědi odmítají unknown fields;
  snapshot parser striktně allowlistuje publikovaná pole a odstraní private
  metadata; klient nerozhoduje podle lokalizovaného textu; externí URL jsou
  pouze HTTP(S), map query je encoded; storage/history selhání je fail-soft;
  `304` bez lokálního ETag nesmí ponechat nekonečný loading; Zod textová
  validace netrimuje a tudíž tiše nemění existující P3 wire hodnoty. A11y
  smoke navíc odhalil, že první skutečné content handlery přivedly source-only
  test-support exporty s `.js` specifiery do Turbopack dev grafu; package nyní
  publikuje buildnuté ESM runtime exporty a conference dev/test/component
  skripty je deterministicky sestaví před startem.
- Ověření `F2-03` prošlo pro celý workspace ESLint, Prettier, typecheck a 237
  unit/architecture/contract testů; 51 DB integračních testů se bez běžícího
  PostgreSQL korektně přeskočilo. Prošlo také 18 Chromium component scénářů
  a 6 axe/keyboard/overflow smoke scénářů napříč `375 × 667`, `768 × 1024` a
  `1280 × 800`. Kompletní web/worker production build prošel i se záměrně
  nastaveným `NEXT_PUBLIC_BYZON_API_MOCKS=enabled`; source/post-build boundary
  v deployment grafu nenašla MSW ani fixtures. High dependency audit je čistý
  a eviduje jediný známý moderate vývojový `esbuild` přes `drizzle-kit`.
  Docker CLI je dostupné, ale lokální daemon neběží, proto skutečné P3 DB
  integrační testy zůstávají na PostgreSQL-backed GitHub CI.
- Capability Program a informace zůstává `contract ready`. `F2-01` je hotový
  pro současné funkční participant routy, první řez `F2-02` přidal
  nepersonalizovaný phase-aware přehled a shell/program část `F2-06` je
  pokrytá, ale `F2-02` čeká na `CS-BOOT-01`/`CS-AGENDA-01` a celý `F2-06`
  zůstává otevřený pro správu účtu/soukromí, která vznikne v `F2-07`; teprve
  potom lze participant quality capability uzavřít. `BLOCKER-CONTENT-01`
  blokuje až obsahové UAT, ne další contract-first práci. `F6-02` může
  paralelně začít nad public částí `CS-CONTENT-01`.
- V pracovním stromu zůstávají cizí nestagované soubory
  `apps/conference/src/components/content-state 2.tsx` a
  `apps/conference/src/components/content-state 3.tsx`. Při produkčních
  kontrolách byly pouze dočasně přesunuty mimo
  `src` a vráceny; nejsou součástí `F2-01` až `F2-06` a nesmí být
  commitnuté.
- Frontendový řez `F0-06` je implementovaný v commitu `f14c6d5` a pushnutý na
  `origin/track/frontend-a/F0-06-component-a11y`.
  Samostatný Vitest Browser/Playwright component runner vykresluje React 19
  komponenty ve skutečném headless Chromiu ve všech třech schválených
  viewports `375 × 667`, `768 × 1024` a `1280 × 800`. Stabilní interní
  `renderComponent` hranice používá accessible locators a skutečné keyboard/
  pointer události; CI ji spouští po instalaci přesně připnutého Chromia.
- `@byzon/test-support` poskytuje validované a hluboce zmrazené
  `targetViewports`, deterministický `selectFixtureContexts` a stabilní
  `fixtureContextName` pro role/phase matice. Page-level
  `@axe-core/playwright` helper kontroluje WCAG A/AA a do CI chyby vypíše pouze
  rule metadata a počet uzlů, nikdy raw DOM/HTML nebo text s možnou PII.
  Playwright projekty i component instances čtou jediný sdílený viewport
  registr.
- Security a code review celého `F0-06` diffu proběhly. Zapracované nálezy:
  component test runtime má architektonický zákaz DB/server importů;
  produkční source/post-build skener nově odmítá Vitest Browser, axe Playwright
  a `test/component` importy; testovací live-start override je explicitní a
  výchozí full E2E dál čeká na DB-backed `/health/ready`; axe report rediguje
  DOM obsah. Reálný browser smoke odhalil a opravil brand link menší než
  minimální dotykový cíl přidáním sdíleného `44 px` tokenu.
- Ověření `F0-06` prošlo pro frozen offline instalaci, celý workspace ESLint,
  Prettier, typecheck, unit/integration testy a web/worker build. Bez lokální DB
  prošlo 227 testů a 51 DB integračních scénářů bylo korektně přeskočeno.
  Navíc prošly 3 Chromium component testy, 6 axe/keyboard/overflow smoke testů
  a 3 reduced-motion smoke testy napříč třemi viewporty. Produkční build se
  záměrně zapnutým mock flagem neobsahuje mock ani component/axe test runtime;
  high dependency audit je čistý a zůstává jen známý moderate vývojový
  `esbuild` přes `drizzle-kit`.
- Úplný `pnpm test:e2e` lokálně nemohl doběhnout, protože výchozí
  `/health/ready` správně hlásil chybějící PostgreSQL. Veřejná DB-independent
  axe/responsive sada proto běžela přes explicitní live-start režim; GitHub CI
  instaluje Chromium, migruje a seeduje PostgreSQL a poté spouští component i
  úplnou E2E sadu. `F1-01` zatím čeká na společný kontrakt s nedokončenými
  `P4-04`/`P4-07`.
- Frontendový řez `F0-05` je implementovaný v commitu `bce2a46`, pushnutém na
  `origin/track/frontend-a/F0-05-msw-mocks`. Přesně
  připnutý MSW `2.15.0` v dev/test používá stejný produkční `ApiPort` nad
  nativním `fetch`; Node harness i browser worker sdílejí kontraktem validované
  response helpers a feature handlers zůstávají u vlastníka příslušného
  `CS-*` slice. Lokální browser mock se zapíná pouze build-time hodnotou
  `NEXT_PUBLIC_BYZON_API_MOCKS=enabled` v development compile a zobrazuje
  trvalý textový indikátor „Mock data · pouze vývoj/test“.
- Mock režim je fail-closed: neobsloužený request nesmí propadnout do skutečného
  API a při selhání workeru se blokují same-origin `/api/v1` požadavky.
  Vygenerovaný `public/mockServiceWorker.js` je ignorovaný a produkční build ho
  před kompilací odstraní. Zdrojový i post-build skener odmítá MSW,
  `@byzon/test-support`, fixture cestu, veřejný přepínač, worker asset a
  runtime marker v produkčním grafu. Existující `/sw.js` se neregistruje přes
  cizí root-scope worker a po vypnutí mocku se MSW klient okamžitě zastaví,
  jeho registrace odstraní a aplikační worker může scope znovu převzít.
- Security a code review celého `F0-05` diffu proběhly. Zapracované nálezy:
  fallback `fetch` guard je HMR-safe, nevrství se a při obnově vrací původní
  implementaci; vypnutí funguje i bez Service Worker API; aktivní MSW klient
  se před odregistrováním explicitně zastaví; fixture validační chyba
  neobsahuje raw tajnou hodnotu; aplikační worker nikdy nepřepíše neznámou
  registraci stejného scope; indikátor bezpečně počká na dostupné DOM.
  Dependency audit navíc odhalil nové high advisories v `next 16.2.10` a
  `sharp 0.34.x`, proto byly minimálně aktualizovány Next i
  `eslint-config-next` na `16.2.11` a transitive Sharp na `0.35.0`.
- Ověření `F0-05` prošlo pro frozen offline instalaci na pnpm `11.15.1`,
  conference typecheck, 60 unit/architecture/transport testů ve 12 souborech,
  cílený ESLint, Prettier a `git diff --check`. Negativní boundary test správně
  odmítl přítomný vygenerovaný worker. Produkční Next build prošel i se záměrně
  nastaveným `NEXT_PUBLIC_BYZON_API_MOCKS=enabled` a následná kontrola
  deployment artefaktů nenašla mock runtime ani syntetická data. Audit
  `--audit-level high` je čistý; zůstává pouze dříve evidovaný moderate
  vývojový `esbuild 0.18.20` přes `drizzle-kit/@esbuild-kit`.
- Dev server s mock přepínačem vrátil aplikaci i oficiální vygenerovaný worker;
  marker a indikátor byly přítomné pouze v dev chunku. Vizuální kontrola
  skutečné registrace a indikátoru nemohla proběhnout, protože v relaci nebyl
  dostupný in-app browser.
- Frontendový řez `F0-04` je implementovaný na stacked větvi
  `track/frontend-a/F0-04-api-client` v commitu `19cb6e2`, pushnutém na
  `origin/track/frontend-a/F0-04-api-client` nad pushnutým `F0-03`. Nový
  [`apps/conference/src/lib/api/README.md`](apps/conference/src/lib/api/README.md)
  popisuje tenký typovaný `ApiPort` a klienta nad nativním `fetch`. Endpointy
  deklarují přesná request/success/problem schémata, allowlist problem kódů,
  response, retry a idempotency policy; klient používá pouze same-origin
  `/api/v1`, validuje request i response, rozlišuje abort, timeout, offline,
  transport, neplatnou odpověď, expirovanou session a doménový problem.
- Security a code review celého `F0-04` diffu proběhly. Zapracované nálezy:
  URL se normalizuje a odmítá traversal, externí i chybně kódované cesty;
  explicitní base URL je povolená jen proti známému browser originu; request
  a response mají byte limity a response se čte omezeným streamem; timeout a
  caller abort fungují i při injektovaném fetchi ignorujícím signál; `304`
  vyžaduje shodný ETag; problem status i request ID se musí shodovat s hlavičkou
  a endpointem; runtime klient znovu ověřuje endpoint policy, takže ji nelze
  obejít ručně sestaveným objektem. Raw výjimky, request payloady ani nevalidní
  response bodies se nevracejí do UI.
- Ověření `F0-04` prošlo pro domain i conference typecheck, domain build,
  42 unit/architecture testů v 5 souborech, Prettier, `git diff --check` a
  produkční Next build. Mutace se v regresních testech nikdy automaticky
  neopakují, zatímco pouze explicitní safe reads mají nejvýše dva bounded
  retry pokusy. ESLint se i nad přesně omezenými změněnými soubory zasekl bez
  výstupu déle než minutu a byl ukončen; žádný lint nález nevypsal.
- Při typechecku bylo nalezeno šest ignorovaných `.next/types` souborů se
  suffixem ` 2`/` 3`. Všechny byly byte-identické s kanonickými protějšky a
  byly recoverably přesunuty do `/tmp/byzon-next-types.UXYN5d`; žádná unikátní
  změna se neztratila.
- Frontendový řez `F0-03` je implementovaný na větvi
  `track/frontend-a/F0-03-fixtures` v commitu `ea78775`, pushnutém na
  `origin/track/frontend-a/F0-03-fixtures`.
  `@byzon/test-support` nyní poskytuje deterministickou fixture factory,
  validační harness nad skutečným Zod schématem, validované a hluboce zmrazené
  base/session-expired problem fixtures a úplnou matici 7 eventových rolí × 5
  fází. Feature fixtures zůstávají vlastnictvím příslušného `CS-*` slice.
- Security a code review celého `F0-03` diffu proběhly. Zapracované nálezy:
  vstup i výstup fixture musí být JSON-safe, validační chyba neobsahuje raw
  payload, issue metadata i výstupy jsou zmrazené, role/fáze procházejí
  validací a dependency test zakazuje database/framework/server importy i
  runtime závislost produkčních aplikací na `@byzon/test-support`.
- Ověření `F0-03` prošlo pro frozen offline lockfile, test-support typecheck,
  12 unit/architecture/export testů ve 4 souborech, build, veřejný
  `@byzon/test-support/fixtures` subpath, Prettier a `git diff --check`. ESLint
  se opět zasekl bez výstupu déle než minutu ve známém lokálním problému a byl
  ukončen; žádný lint nález nevypsal.
- Frontendový řez `F0-02` je implementovaný na větvi
  `track/frontend-a/F0-02-contracts` v commitu `bd69221`, pushnutém na
  `origin/track/frontend-a/F0-02-contracts`. Nový veřejný subpath
  `@byzon/domain/contracts` poskytuje striktní `CS-BASE-01`: bezpečně
  omezenou `application/problem+json` obálku a factory pro endpointové kódy,
  přesný `AUTH_SESSION_EXPIRED`, cursor pagination metadata, request ID/ETag
  metadata a transport-neutral error taxonomy bez raw výjimek či payloadů.
  Exportní a ownership konvence jsou v
  `packages/domain/src/contracts/README.md`; feature DTO zůstávají mimo tento
  řez.
- Security a code review celého `F0-02` diffu proběhly. Zapracované nálezy:
  cursor má transport-safe allowlist, ETag musí mít bezpečný quoted tvar,
  `fieldErrors` odmítají prototype-pollution segmenty a import-boundary test
  rekurzivně dovoluje jen Zod a relativní importy, které zůstávají uvnitř
  `src/contracts`.
- Ověření `F0-02` prošlo pro frozen offline lockfile, domain typecheck, 37
  unit/architecture testů ve 4 souborech, domain build, veřejný
  `@byzon/domain/contracts` subpath, Prettier a `git diff --check`. Běžný
  `pnpm` shim postrádá spravovanou binárku, proto byl použit funkční
  `corepack pnpm 11.15.1` a přímé lokální binárky. ESLint se znovu zasekl bez
  výstupu déle než minutu ve známém lokálním problému a byl ukončen; žádný
  lint nález nevypsal.
- Frontendový řez `F0-01` je implementovaný na větvi
  `track/frontend-a/F0-01-route-map` v commitu `ec6115f`, pushnutém na
  `origin/track/frontend-a/F0-01-route-map`.
  [`docs/frontend-route-map.md`](docs/frontend-route-map.md) eviduje 39
  Priority A routes: role/minimální permission, fázi a flag/gate, jediný
  primární úkol/CTA, deep link/Back/state preservation, data/offline/PII a
  povinné UX profily. Participant shell má závazných pět top-level cílů a
  admin jednu adaptivní hierarchii. Devět chybějících jemnozrnných serverových
  permission významů je explicitně zapsaných; UI je nesmí nahrazovat širším
  role guardem.
- Security a code review celého `F0-01` diffu proběhly. Dokumentace zakazuje
  secret/PII v URL, historii, analytice a obecných cache, vyžaduje same-origin
  allowlist pro `returnTo`, online-only zacházení s provozními PII a serverové
  ověření event scope i oprávnění. Zapracovaný review nález sjednotil skip
  link, focus management, jediný `h1`, viditelný focus, minimální touch target
  a bezpečné zacházení s dynamickými identifikátory pro všechny shelly.
- Ověření `F0-01` prošlo: Prettier, `git diff --check`, lokální Markdown
  odkazy, úplnost 39 rout, tvar všech route řádků a shoda použitých
  existujících permission názvů s doménovým registrem. Runtime testy se
  nespouštěly, protože změna je pouze dokumentační.
- Před `F0-01` se znovu objevilo 11 neversionovaných UI kopií se suffixem
  ` 2`. Deset bylo byte-identických s kanonickými soubory a `index 2.ts`
  odpovídal starému pre-`F0-07` exportu; žádná kopie neobsahovala unikátní
  změnu. Kopie byly recoverably přesunuty mimo repozitář do
  `/tmp/byzon-ui-duplicates.vyCfpv`; kanonické soubory zůstaly beze změny.
- Frontendový řez `F0-07` je implementovaný a lokálně sloučený do větve
  `main` a pushnutý na `origin/main` v merge commitu `d30c823`.
  `packages/ui` nyní obsahuje sémantické BYZON tokeny a přístupné primitives
  pro akce, formuláře, feedback/stavy, karty, taby, dialog/sheet, live region,
  potvrzení destruktivní akce, participant/admin navigaci, tabulku, seznam a
  stránkování. Konferenční shell importuje jediný sdílený stylesheet a používá
  Khand pro display a Inter pro aplikační text.
- Unit sada `packages/ui` prošla 6 testy, samostatný UI typecheck a build jsou
  zelené, `git diff --check` prošel a produkční Next build včetně vlastního
  TypeScript kroku je úspěšný. Kontrast ověřených textových párů je nejméně
  4,86:1 a primární akce 5,01:1. Vizuální localhost kontrola nemohla proběhnout,
  protože v relaci nebyl dostupný in-app browser. Samostatný conference
  typecheck se znovu zasekl bez výstupu jako v dřívějším známém lokálním
  problému; TypeScript uvnitř produkčního Next buildu však dokončil úspěšně.
  ESLint je lokálně blokovaný poškozeně načítanými transitive moduly
  (`uri-js`/`optionator` vracejí neúplné exporty), nikoli nahlášeným nálezem v
  aplikačním kódu.
- Security a code review celého `F0-07` diffu proběhly před předáním. Nebyl
  přidán žádný HTML injection sink, browser storage ani datový transport.
  Zapracované review nálezy: dialog má programově svázaný název a bezpečný
  cancel, formulář zachovává vlastní ARIA popisy a propaguje required stav,
  taby mají klávesovou obsluhu, fixed navigace rezervuje prostor a toast
  respektuje safe area, admin navigace má mobilní alternativu a všechny
  interakce mají focus/pressed/reduced-motion stavy.
- Revize plánu v3.1 je v commitu `cbefb74`; spolu s `F0-07` byla sloučena a
  pushnuta do `origin/main` merge commitem `d30c823`.
- `AI_IMPLEMENTATION_PLAN.md` je přepracovaný na v3.1. Priority A má
  dependency-driven frontendový track `F0`–`F6`, lifecycle
  `not started → contract ready → UI ready (mocked) → integrated → UAT`,
  capability matrix a explicitní kontrakt/fixture/mock/test gates. SimpleShop podklady blokují jen
  produkční mapping, apply, claim a související UAT; frontendové kontrakty,
  syntetické fixtures, navigace, formuláře a mockované cesty mohou pokračovat
  paralelně. Nové rozhodovací body jsou `BLOCKER-AUTH-01` a
  `BLOCKER-TKT-05`.
- Odstraněno bylo 32 neversionovaných pracovních kopií se suffixem ` 2`/` 3`
  a tři stejnojmenné ignorované `.next` artefakty. Audit před odstraněním
  prokázal, že 15 kopií bylo byte-identických, 15 odpovídalo starším Git
  verzím a dva Drizzle snapshoty byly neplatné mezistavy; žádná kopie
  neobsahovala unikátní změnu. Kanonické soubory zůstaly zachované.
- Ověření revize: Prettier, `git diff --check`, lokální Markdown odkazy,
  unikátnost a úplnost 49 `F`, 162 `P`, 12 contract-slice a 19 blocker ID i
  absence všech suffixových kopií prošly. Databázová sada v jednovláknovém
  režimu prošla 66 testy, 15 integračních bylo bez lokální DB přeskočeno.
  Conference Vitest a jeho `tsc` byly opakovaně blokované při importu
  `kysely` v lokálním Node procesu bez assertion/type chyby a byly po dlouhém
  nečinném čekání přerušeny; před commitem je zopakovat v běžném CI prostředí.
- Etapa 4 byla zahájena na lokální větvi `stage/04-tickets`. Bezpečně
  oddělitelná část `P4-01` je rozpracovaná: event-scoped ticket/import/history a
  claim-attempt schéma, HMAC-SHA-256 rozhraní s active/previous pepperem,
  stabilní infrastrukturní test vector a rotační runbook. Databáze ani staging
  neukládají raw ticket kód; normalizace je povinně injektovaná a do potvrzení
  `BLOCKER-TKT-04` nic netrimuje ani nepřepisuje. Produkční normalizér, SimpleShop
  mapping/apply a claim zůstávají blokované `BLOCKER-TKT-01` až `TKT-04`.
- Security review a následný code review rozpracované části `P4-01` byly
  provedeny před sloučením. Opravené nálezy: odstranění volného staging JSON,
  který mohl nést raw kód, event-scoped membership FK aktéra historie, validace
  všech claim hashů a kladné retence a použití skutečných unique constraints
  pro cíle složených PostgreSQL FK. Regresní integrační testy ověřují neplatnou
  aktivaci bez držitele, cross-event import row a cross-event aktéra historie.
- Migrace `0004_famous_donald_blake.sql` a seed prošly nad izolovanou lokální
  PostgreSQL. Celý `pnpm run ci` následně prošel se zapnutými integračními testy:
  81 databázových a 59 conference testů, format, lint, typecheck, produkční
  Next/worker build a statický smoke 25 HTML/58 assetů. Dočasná databáze byla po
  ověření odstraněna.
- Nezávislý follow-up review etapy 3 byl zapracován: publish nyní ověřuje
  checksum schváleného preview a sdílí eventový advisory lock s CRUD, ETag
  zahrnuje publication version, admin umí plnohodnotně upravovat obsah a vazby
  session–řečník v event timezone a audit zachovává HTTP korelaci. Regresní
  testy kryjí stale preview, stejný snapshot v nové verzi, speaker vazby,
  request ID a zimní/letní timezone offset. Celý `pnpm run ci` prošel nad
  izolovanou migrovanou PostgreSQL: 66 database a 57 conference testů,
  produkční buildy a statický smoke. Po doplnění timezone unit testů prošlo 59
  conference testů; dočasná databáze byla odstraněna.
- Implementační rozsah `P3-01` až `P3-10` je dokončen. Povinný security review
  a code review etapy našel a zapracoval: zákaz ne-HTTP(S) externích URL při
  zápisu i čtení snapshotu, explicitní offset admin timestampů, kontrolu konce
  session vůči event dni, možnost zrušit/archivovat session bez falešné kolize,
  bezpečný `409` pro používaný obsah, potvrzení destruktivní akce, kompletní
  venue/reference/update admin flow a Unicode-safe 75-byte ICS folding.
- Finální review gate prošel: celý `pnpm run ci`, 66 database a 55 conference
  testů, produkční Next/worker build, statický smoke 25 HTML/58 assetů a 3 mobile
  Chromium E2E. Public API ověřuje byte-for-byte determinismus stejné
  publication version. Review fix je commit `b50e299`, pushnutý na
  `origin/stage/03-content`.
- `pnpm audit --audit-level high` prošel bez high/critical nálezu. Zůstává jedna
  moderate advisory `GHSA-67mh-4wv8-2f99` v transitive esbuild `0.18.20` přes
  `drizzle-kit/@esbuild-kit`; jde o neexponovaný vývojový server, který se v
  produkčním Next/worker runtime nespouští. Bez neověřeného dependency override
  byl nález zdokumentován jako neprodukční upstream riziko.
- `P3-10` je dokončený v commitu `79ba63d`: mobilní Playwright testy kontrolují
  participant landmarky/navigaci, keyboard skip link a focus hlavního obsahu,
  minimální 44px touch targety, absenci horizontálního overflow a reduced-motion
  vypnutí dekorativních přechodů. Kontrast brand marku používá tmavší růžovou.
- Všechny 3 mobile Chromium E2E testy prošly nad migrovanou lokální PostgreSQL.
- `P3-09` je dokončený v commitu `14076c7`: veřejné routes pro bootstrap, content a
  `calendar.ics` nad event slugem. Vrací jen whitelisted publication data,
  veřejnou ETag cache/304 a žádný transient request ID v cacheovaném těle.
- ICS používá CRLF, escaping/folding, UTC, stabilní UID, publication SEQUENCE,
  místnost a `STATUS:CANCELLED`. Conference sada prošla 53 testy včetně veřejné
  odpovědi bez auth, odstranění neznámého admin pole, ETag a chybějící publikace.
- `P3-08` je dokončený v commitu `21ea336`: snapshot diff detekuje změnu času,
  místnosti, stavu/zrušení, odebrání session i přejmenování/přesun místnosti.
  Publish ukládá jen při neprázdném cíli deduplikovanou `program.changed`
  outbox událost s publication version a přesnými session IDs; nic neodesílá.
- Conference sada prošla 50 testy včetně canonical hash, removed/room rename
  projekce a PostgreSQL publish změněného času s cílitelným pending outboxem.
- `P3-07` je dokončený v commitu `2c4a007`: admin preview a atomický publish pod
  transaction-scoped zámkem, canonical JSON/SHA-256, expected previous version,
  immutable publication, audit a `content.published` outbox pro následnou
  synchronizaci. Admin konzole nabízí náhled a potvrzené publikování.
- Conference sada prošla 47 PostgreSQL-backed testy včetně deterministického
  preview, atomického publish, snapshot stavu `published`, auditu/outboxu a
  odmítnutí stale souběžného publishera. Sekvenční snapshot dotazy respektují
  kontrakt jednoho transakčního pg klienta.
- `P3-06` je dokončený v commitu `ed1d77b`: admin mutace validují venue/day/room
  event scope, časový rozsah, příslušnost k lokálnímu dni `Europe/Prague`,
  kolize místnosti a duplicitní slug. Očekávané konflikty vracejí strukturované
  `409 CONTENT_VALIDATION_FAILED`, ne generickou `500`.
- Conference sada prošla 45 PostgreSQL-backed testy včetně cross-event room,
  room collision, duplicate slug a timestampu mimo zvolený lokální den.
- `P3-05` je dokončený v commitu `9cec1c8`: admin CRUD API pro dny, místnosti,
  sessions, řečníky, partnery, stránky a FAQ plus `/admin/obsah`. Čtení i mutace
  vyžadují event-scoped `program:manage`; mutace navíc same-origin kontrolu,
  optimistic version a audit. Participant dostává nerozlišující `404`.
- Conference sada prošla 43 PostgreSQL-backed testy včetně create/list/update,
  stale update, archive, auditu, IDOR a cross-origin odmítnutí. Produkční build
  obsahuje admin UI i obě dynamické CRUD routes; bez migrace a nové env.
- `P3-04` je dokončený v commitu `f18a305`: mobilní `/app` navigace, program s
  filtry a detailem, řečníci a profily, partneři a praktické informace. Nový
  participant content endpoint vrací pouze explicitně whitelisted pole
  publication snapshotu a vyžaduje stejnou event-scoped autorizaci jako program.
- Conference sada prošla 41 PostgreSQL-backed testy; produkční Next build
  obsahuje nové `/app/*` stránky a `/api/v1/events/:eventId/content`. Nevznikla
  migrace ani env proměnná.
- `P3-03` je dokončený v commitu `f690037`. `GET /api/v1/events/:eventId/program` čte výhradně
  immutable `content_publications`, vyžaduje aktivní event membership s
  `program:published:read` a pro cizí event i chybějící publication vrací stejnou
  bezpečnou `404`.
- API podporuje bounded filtry `day`, `room`, `type`, volitelnou publication
  `version` a representation-specific ETag. Privátní odpovědi mají revalidaci,
  `Vary: Cookie, Authorization` a autorizovaný `If-None-Match` podporuje seznam
  tagů, weak porovnání i `304`.
- PostgreSQL integrační sada conference prošla 39 testy včetně latest/exact
  publication, filtrů, anonymního přístupu, event IDOR a ETag. Celý `pnpm run
  ci` prošel včetně 66 databázových testů, produkčních buildů a statického smoke
  testu 25 HTML/58 assetů. Build zároveň opravil runtime export
  `@byzon/domain`; nevznikla migrace ani nová env proměnná.
- `P3-02` je dokončený v commitu `8d4fe20`. Přidává transakční CLI import `static-site/data/content.json`,
  event-scoped provenance tabulku a JSON report nepřevedených polí. Import je
  při stejném SHA-256 no-op, zapisuje pouze drafty, nepublikuje a nevytváří
  rezervace; neplatnou položku `24:00 - ?` bezpečně přeskočí.
- Import připraví 25 assetů, 17 řečníků, 7 partnerů, 1 místo, 1 praktickou
  stránku, 2 dny a 65 validních sessions. Stage názvy se nehádají jako fyzické
  místnosti a zůstávají v reportu; přesně spárovaní řečníci mají stabilní vazby.
- Migrace `0003_curious_sunspot.sql` přidává pouze
  `content_import_provenance`. PostgreSQL integrační sada po migraci a seedu
  prošla se 66 testy včetně dvojího importu bez duplicit. Celý `pnpm run ci`
  prošel včetně 32 conference testů, produkčních buildů a statického smoke testu
  25 HTML/58 assetů; migrační drift je nulový.
- `P3-01` je dokončený v commitu `ee854b5`, pushnutém na
  `origin/stage/03-content`; větev byla založena z
  `b22a4df`; před implementací byly znovu ověřeny §1, §9.5, §9.9, §10.4 a
  Etapa 3 plánu, `README.md`, ADR-003, ADR-007, ADR-008, ADR-012 a inventura
  obsahu.
- `P3-01` obsahuje event-scoped tabulky programu, míst, řečníků,
  partnerů, praktického obsahu, privátních asset metadat a publication snapshotů
  včetně složených eventových FK, databázových invariantů programu a ochrany
  immutable publication payloadu. Migrace `0002_superb_roulette.sql`, seed,
  63 databázových testů, celý `pnpm run ci`, produkční buildy i statický smoke
  prošly nad dočasnou izolovanou PostgreSQL instancí. Self-review opravil
  PostgreSQL `NULL` mezeru v capacity/waitlist checku; migrační drift je nulový.
- Etapa `02-database-auth` je dokončená; v etapě 3 následuje `P3-03`.
- Pracovní větev: `stage/03-content`, sleduje stejnojmennou větev na `origin`.
- Etapa 1 je sloučená do `main`; uživatel potvrdil úspěšný Railway deploy, proto
  je `P1-11` uzavřen.
- Nejnovější dokončený implementační úkol je `P2-10`; `P2-07` až `P2-10` jsou
  sloučené do `main` přes PR `#16` na merge commitu `acaa5cd`. `P2-06` je
  sloučený přes PR `#14` na merge commitu `e286ef6`.
- Post-merge CI běh `29808091210` pro `acaa5cd` prošel; joby `application` i
  `static-site` skončily úspěšně včetně PostgreSQL migrace/seed, E2E a auditu.
- Follow-up ke dvěma funkčním CodeRabbit připomínkám z PR `#16` je commit
  `d061d73`; změna projektových pokynů je commit `928dab5`. Oba jsou pushnuté na
  `origin/agent/p2-review-followup`, ale zatím nemají PR ani merge.
- Následná údržba GitHub Actions pro Node 24 je sloučená přes PR `#15` na merge
  commitu `48c11fc`; CI na `main` je zelené bez anotací.
- Railway packaging hotfix je commit `02e3b43`; je pushnutý do
  `origin/stage/02-database-auth`, fast-forwardnutý do `main` a pushnutý do
  `origin/main`.
- Railway conference readiness je po hotfixi a doplnění konfigurace zelená:
  `status=ready`, `environment=staging`, release
  `02e3b43fb1c37c72a70305ef14931ec29ea6e2d2` a `database=ready`.

## Dokončená práce

- Přidán workspace balíček `@byzon/database` s Drizzle ORM a `pg`.
- Přidány Better Auth core tabulky `user`, `session`, `account`, `verification`.
- Přidány eventy/features, memberships/event-scoped role, právní dokumenty a
  append-only consent records, audit, outbox a idempotency keys.
- Eventové tabulky nesou `event_id`; vazba consent → legal document používá
  složený cizí klíč, který brání propojení dat různých eventů.
- Přidáno 12 schema-level testů pro event scope, Better Auth tabulky, složenou
  vazbu legal documentu a částečné/deduplication unique indexy.
- `P2-01` neobsahoval databázovou migraci; ta vzniká v navazujícím `P2-02`.

## Dokončená práce (`P2-03`)

- `@byzon/database` poskytuje bounded `pg` pool, Drizzle client, transakční
  wrapper a transaction-scoped advisory lock.
- Web readiness vrací `200/database=ready` jen při dostupné DB a bezpečné
  `503/database=unavailable` při výpadku. Worker DB ověří při startu a pool
  zavře při shutdownu.
- Staging env vyžaduje explicitní `DATABASE_URL`; lokální vývoj má pouze lokální
  default bez produkčních dat.
- Web Railway config spouští migraci pouze jednou; ve staging prostředí navíc
  idempotentní seed. Worker migraci nespouští.
- Worker hotfix bundluje workspace config a databázový kód do samostatného
  `apps/worker/dist/index.js`, takže Railway runtime nepotřebuje chybějící
  `@byzon/database/dist/index.js`.
- Conference Railway služba používá `/railway.web.json`, poslouchá na
  `0.0.0.0:8080` a má `NODE_ENV=production`, `APP_ENV=staging`, staging URL a
  `RELEASE_SHA=${{RAILWAY_GIT_COMMIT_SHA}}`.

## Otevřené body a rizika

- `support_operator` není ve schématu vytvořen, protože plán jej zakazuje bez
  potvrzené potřeby.
- P0 produktové blockery zůstávají otevřené, ale `P2-01` neblokují.
- Railway staging má služby `@byzon/conference`, `@byzon/worker` a `Postgres`.
  Uživatel potvrdil reference `DATABASE_URL` a pool limity ve webu i workeru.
- Původní Railway 502 webu je vyřešený. `GET /health/ready` na
  `https://byzonconference-staging.up.railway.app` vrací `200` a potvrzuje
  dostupnou databázi.
- Railway CLI potvrdilo staging worker ve stavu `SUCCESS`; neběží v restart
  loopu.
- PostgreSQL IDOR test načetl oba seed eventy `byzon-2026` a
  `byzon-isolation-test`, takže staging seed je potvrzený.
- Bootstrap vyžaduje existující Better Auth účet; cílový organizátor se proto
  musí před udělením role alespoň jednou přihlásit. CLI pozastavenou nebo
  revokovanou membership záměrně nereaktivuje.
- Rate-limit kontrakt nemá záměrně procesový produkční store. Chráněný endpoint
  se nesmí zapnout, dokud staging/production nepoužije atomický sdílený provider
  a environment-keyed HMAC subjecty; výpadek store je fail-closed.
## Doporučený další krok

`P5-07` zůstává fail-closed za chybějící číselnou kapacitou a waitlist/storno
detailem `BLOCKER-RES-01`; nevytvářet místo něj `registration_estimate`.
`P5-04` nezačínat bez jediného potvrzeného promotion režimu v
`BLOCKER-RES-04`; dvoudílný sobotní mastermind zůstává za `BLOCKER-RES-05`.
Ticket transfer/storno consumer rozhodnutého cancel pravidla
doplní `P4-09`, až vznikne skutečná ticket transition.

## Dokončená oprava review PR `#16`

- `RateLimit-Reset` nyní vrací relativní `retryAfterSeconds` místo Unix epoch
  timestampu; regresní test přesně ověřuje hodnotu hlavičky.
- `logout-all` si před nevratnou revokací vyžádá od Better Auth přesné
  cookie-expiration hlavičky interním `sign-out` požadavkem bez session cookie.
  Nehardcoduje proto vývojový název cookie a zachovává produkční `__Secure-`
  variantu i ostatní Better Auth cookies.
- Pokud příprava cookies vrátí non-2xx nebo vyhodí výjimku, revokace se vůbec
  nespustí. Po úspěšné revokaci už nezůstává žádný post-revoke krok, který by
  mohl vrátit zavádějící `500`.
- Nové unit testy kryjí non-2xx, thrown failure, pořadí volání, nepředání session
  cookie do preflight `sign-out` a propagaci secure clearing cookie. Reálná
  PostgreSQL/Better Auth integrace pro expiraci a dvě sessions také prošla.
- Globální `pnpm run ci` nad izolovanou DB prošlo: 32 database a 32 conference
  testů, format, lint, typecheck, produkční Next/worker build a static smoke 25
  HTML/58 assets.
- Nízkohodnotový návrh na sdílení dvou regex konstant zůstal záměrně bez změny.
  Na GitHubu zatím nebyla odeslána odpověď ani resolve review vláken.
- Implementace je commit `d061d73`, pushnutý na
  `origin/agent/p2-review-followup`; projektový review gate je commit `928dab5`
  na stejné větvi.

## Dokončená práce (`P2-10`)

- Better Auth session politika je explicitně připnutá na sedmidenní expiraci,
  jednodenní refresh interval a jednodenní fresh age; cookie zůstává
  `HttpOnly` a `SameSite=Lax`, v produkci ji existující konfigurace vydává jako
  secure.
- Přidán `POST /api/v1/auth/logout-all`. Wrapper používá Better Auth
  `revoke-sessions` pro všechny databázové relace a následný `sign-out` pro
  expiraci lokálních cookies; nevytváří vlastní session mechanismus.
- Mutace vyžaduje přesnou shodu `Origin` s `APP_BASE_URL`, anonymní požadavek
  vrací bezpečný `401` a cross-origin požadavek bezpečný `403` přes jednotný
  `application/problem+json` kontrakt. Odpovědi nesou request ID a `no-store`.
- PostgreSQL-backed HTTP integrační test ověřuje sedmidenní dobu session,
  odmítnutí ručně expirované relace, revokaci dvou souběžných sessions,
  neplatnost obou původních cookies, lokální expiraci cookie a zachování session
  při anonymním i cross-origin odmítnutí.
- Globální `pnpm run ci` prošlo nad izolovanou DB: database 32 testů,
  conference 29 testů, produkční Next/worker build a static smoke 25 HTML/58
  assets. Nevznikla migrace ani nová env proměnná.
- Implementace je commit `7ee5450`, sloučený do `main` přes PR `#16`; PR CI běh
  `29807725597` i post-merge běh `29808091210` prošly.

## Dokončená práce (`P2-09`)

- Přidán jednotný `application/problem+json` kontrakt s `type`, `title`,
  `status`, `code`, `detail`, `requestId` a volitelnými `fieldErrors`; neznámá
  exception se mapuje na generickou `500` bez původní message.
- Proxy používá stejnou bounded validaci request ID jako API helper a response
  vrací `x-request-id`, `no-store` a nezměnitelný problem content type.
- `executeIdempotentMutation` vyžaduje validní `Idempotency-Key`, ukládá pouze
  jeho SHA-256 a fingerprint přes metodu/path/raw request bytes, serializuje
  souběh advisory lockem a provádí business callback ve stejné DB transakci.
- Stejný request replayuje uložené DTO; změněný payload vrací `409`, chyba
  callbacku rollbackne business zápis i idempotency řádek a expirovaný klíč lze
  bezpečně znovu použít.
- Rate-limit rozhraní přijímá pouze HMAC-SHA-256 subject, vyžaduje atomický
  sdílený store, vrací remaining/reset údaje a odmítnutí mapuje na generické
  `429` včetně `Retry-After`; store failure se propaguje fail-closed.
- Nevznikla migrace ani nová env proměnná. Provozní kontrakt handlerů je v
  `apps/conference/src/server/api/README.md`.
- Implementace je commit `83ef545`, sloučený do `main` přes PR `#16`.

## Dokončená práce (`P2-08`)

- `@byzon/database` exportuje jediný auditovací vstup `writeAuditLog`; onboarding
  ani admin bootstrap už nevkládají řádky do `audit_logs` přímo.
- Helper rekurzivně kopíruje payload a rediguje citlivé klíče pro jména,
  kontakty, adresy, zprávy, profily, cookies, sessions, hesla, kódy, tokeny a
  secrets; v textu odstraňuje e-maily, telefony, IP adresy, Bearer credentials a
  citlivé query parametry.
- Technická metadata `actorType`, `action` a `targetType` přijímají pouze krátké
  strojové identifikátory, aby nevznikl vedlejší kanál pro volný text/PII.
- PostgreSQL test načetl skutečně uložený audit a ověřil absenci raw e-mailu,
  jména a secretu při zachování bezpečných UUID a stavových údajů.
- Nevznikla migrace, nová env proměnná ani změna veřejného API; pokyny pro
  minimální audit payload jsou v `packages/database/README.md`.
- Implementace je commit `a12b13a`, sloučený do `main` přes PR `#16`.

## Dokončená práce (`P2-07`)

- Přidán explicitní příkaz `db:bootstrap-admin`; v aplikačních routes ani
  exportovaném databázovém API nevznikl endpoint pro udělení role.
- CLI vyžaduje konkrétní event slug, e-mail již existujícího Better Auth účtu a
  explicitní `DATABASE_URL`; nevytváří globální superadmin roli.
- Transakční operace používá per-event/per-user advisory lock, vytvoří pouze
  chybějící aktivní membership a event-scoped `organizer_admin`; suspendovanou
  nebo revokovanou membership odmítá.
- Skutečná změna zapíše jediný audit bez jména/e-mailu. Souběžný či opakovaný
  běh je idempotentní a nevytváří další roli ani audit.
- Nevznikla migrace ani nová environment proměnná; provozní postup je popsaný v
  `packages/database/README.md`.
- Implementace je commit `704032a`, sloučený do `main` přes PR `#16`.

## Dokončená práce (`P2-06`)

- Přidána čistá onboarding state machine pro povinný eventový profil, aktuální
  verze podmínek/privacy notice a samostatnou networking volbu.
- Přidána tabulka `participant_profiles` a deduplikační index pro consent records
  z opakovaného requestu; dopředná migrace je `0001_strong_venus.sql`.
- Conference server dokončuje onboarding v transakci serializované per-user
  advisory lockem, s event membership kontrolou, feature flagem, append-only
  consent records a auditní stopou bez jména/e-mailu.
- PostgreSQL integrace na izolované lokální DB prošla: 24 databázových testů a
  12 conference testů včetně retry, cross-event odmítnutí, opt-in/opt-out a nové
  aktuální právní verze.
- Globální `pnpm run ci` prošlo: format, lint, typecheck, běžné testy, produkční
  conference/worker build a smoke test statického veřejného webu.
- GitHub Actions `application` job nově spouští PostgreSQL 17, migraci a seed;
  readiness E2E proto nečeká na chybějící DB a PostgreSQL integrační testy běží
  i v CI.
- Finální právní texty se neseedují; testovací právní fixtures jsou označené jako
  draft a produkční networking zůstává blokovaný `BLOCKER-LEGAL-01`.
- Implementace je commit `39736e9`, oprava PostgreSQL CI je commit `b624f65` a
  PR `#14` je sloučený do `main` merge commitem `e286ef6`.

## Dokončená práce (GitHub Actions / Node 24)

- `actions/checkout` je aktualizovaný z `v4` na `v7`, `actions/setup-python` z
  `v5` na `v7`, `actions/setup-node` z `v4` na `v7` a `pnpm/action-setup` z
  `v4` na `v6`.
- Manifesta všech zvolených verzí deklarují `runs.using: node24`; konfigurace a
  posloupnost CI kroků se nezměnila.
- Změna je commit `3e3de83`, sloučený přes PR `#15` do `main` merge commitem
  `48c11fc`; pracovní větev `agent/upgrade-actions-node24` byla odstraněna.
- PR CI běh `29744166349` i post-merge běh na `main` `29744361372` prošly.
  Joby `static-site` a `application` mají v obou případech nula anotací, takže
  původní upozornění na Node 20 kompatibilitu je odstraněné.

## Dokončená práce (`P2-05`)

- `@byzon/domain` obsahuje explicitní event role, permission matrix a fail-closed
  podmínky pro vlastnictví, networking opt-in/spojení, přidělené bloky/místnosti
  a auditovanou admin výjimku; `support_operator` zůstává záměrně mimo model.
- Conference server načítá aktivní membership a nerevokované role výhradně z DB
  pro zadané `actor.userId` a `eventId`; odmítnutí používá neenumerující chybu.
- Přidán PostgreSQL integrační test, který stejnému uživateli nedovolí přenést
  admin roli do izolačního eventu a odmítne suspendovanou membership.
- Unit testy, typecheck, lint, format check a produkční conference build prošly.
- PostgreSQL IDOR test byl spuštěn proti Railway staging DB přes Railway-managed
  connection proměnnou bez vypsání credentialů; oba scénáře prošly a syntetický
  uživatel byl po testu odstraněn.
- Commit `7e0a234` je pushnutý do `origin/stage/02-database-auth`.
- Ruční upload deployment conference `9cdaa2ce-7b11-4466-a97a-3a5f928a30cf`
  zůstal na Railway ve stavu `INITIALIZING` bez přiřazeného buildu; je zastavený
  a dosavadní zdravý staging release `85666aa` zůstal aktivní a ready.

## Dokončená práce (`P2-04`)

- Přidán Better Auth `1.6.23` s Drizzle adapterem nad existujícími core auth
  tabulkami a Next.js handlerem `/api/auth/[...all]`.
- Magic link expiruje za pět minut, v DB se ukládá hashovaně, Better Auth jej
  spotřebuje atomicky a callback/origin je omezen na `APP_BASE_URL`.
- Fake auth mail provider drží doručené odkazy pouze v paměti a nic neloguje;
  produkční mail provider zůstává navazující integrační prací.
- `BETTER_AUTH_SECRET` je povinný minimálně 32 znaků ve staging/production;
  lokální vývoj používá výslovně neprodukční default.

## Poslední ověření

- PostgreSQL integrace: migrace, dvakrát spuštěný Node seed a 19 databázových
  testů prošly; commit/rollback/advisory lock i uzavření poolu byly ověřeny.
- Produkční conference build a worker build prošly.
- Runtime smoke: readiness s DB `200`, bez DB `503`; worker se připojil a při
  `SIGINT` pool korektně uzavřel.
- Hotfix: format, lint, typecheck, 24 unit testů a oba produkční buildy prošly;
  worker bundle neobsahuje runtime odkaz na workspace balíčky. Statický smoke
  byl přerušen při pomalém kopírování 58 nezměněných assetů z lokálního disku.
- Railway conference ověření po deployi: `/health/ready` vrací `200`, staging
  release `02e3b43fb1c37c72a70305ef14931ec29ea6e2d2` a
  `dependencies.database=ready`.
- `P2-04`: lint, typecheck, 27 unit/schema testů a produkční web build prošly.
- V izolované PostgreSQL prošla migrace, všech 19 databázových testů a všech 5
  conference testů včetně magic-link integrace: raw token nebyl uložen, první
  použití vydalo session cookie a opakované použití bylo odmítnuto.
- Railway release hotfix načítá `RAILWAY_GIT_COMMIT_SHA` přímo jako fallback
  pro chybějící nebo prázdný `RELEASE_SHA`; ruční neprázdný override má nadále
  přednost. Regresní config testy kryjí všechny tři varianty.
- GitHub Actions po sloučení `P2-06`: PostgreSQL 17 service, migrace, seed,
  format, lint, typecheck, 24 databázových a 12 conference testů, oba produkční
  buildy, Playwright E2E i audit prošly v CI.
- Node 24 údržba: PR `#15` a následný push běh na `main` prošly; oba CI joby mají
  nula anotací.
- `P2-07`: na čisté lokální PostgreSQL 17 prošly obě migrace, seed a všech 28
  databázových testů včetně souběžného dvojitého bootstrapu, izolace eventů,
  idempotence, odmítnutí suspended membership a absence e-mailu v auditu.
- CLI smoke vytvořil právě jednu aktivní roli a jeden audit; druhý běh byl no-op.
  Globální `pnpm run ci` prošlo včetně formátu, lintů, typů, testů, obou
  produkčních buildů a statického smoke (25 HTML stránek a 58 assetů).
- `P2-08`: na čisté lokální PostgreSQL 17 prošly migrace, seed, všech 32
  databázových a 12 conference testů. Samostatný DB test potvrdil, že se raw
  e-mail, jméno ani secret neuložily do žádného volného auditního pole.
- Globální `pnpm run ci` po `P2-08` prošlo: format, lint, typecheck, běžné testy,
  produkční conference/worker build a statický smoke (25 HTML stránek a 58
  assetů).
- `P2-09`: na čisté lokální PostgreSQL 17 prošly migrace, seed, všech 32
  databázových a 25 conference testů. Idempotency test kryje souběžný replay,
  změněný payload, rollback callbacku, expiraci a absenci raw klíče v DB.
- Globální `pnpm run ci` po `P2-09` prošlo se zapnutou PostgreSQL integrací:
  format, lint, typecheck, všechny testy, produkční conference/worker build a
  statický smoke (25 HTML stránek a 58 assetů).
- `P2-10`: PostgreSQL-backed HTTP integrace ověřila expiraci, revokaci dvou
  souběžných sessions, expiraci caller cookie, anonymní `401` a cross-origin
  `403`; celý lokální CI průchod měl 32 database a 29 conference testů.
- PR `#16` CI běh `29807725597` a post-merge běh `29808091210` na commitu
  `acaa5cd` prošly. Lokální `main` odpovídá `origin/main`; post-merge
  `application` zahrnul migraci, seed, format, lint, typecheck, testy, build,
  Playwright E2E a audit, `static-site` smoke také prošel.
