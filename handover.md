# BYZON 2026 – handover

> Poslední aktualizace: 25. července 2026

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
- `/aktivace/odkaz` nečte token v RSC. Client effect vezme právě jednu query
  hodnotu pouze do ref a před akcí nahradí URL čistou route se zachováním
  `history.state`; odstraní také hash. Route má `noindex`, route-specific
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
  session-expired stav. Root v developmentu odkazuje do mock průchodu;
  `pnpm dev:mock` jej spustí s viditelným syntetickým režimem. Cíleně prošlo
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
  celý `F2-06` zůstává otevřený pro inbox a účet po `F2-05`/`F2-07`.
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
  zůstává otevřený pro inbox a správu účtu/soukromí, které dosud neexistují a
  vzniknou v `F2-05`/`F2-07`; teprve potom lze capability označit jako
  `UI ready (mocked)`. `BLOCKER-CONTENT-01` blokuje až obsahové UAT, ne další
  contract-first práci. `F6-02` může paralelně začít nad public částí
  `CS-CONTENT-01`.
- V pracovním stromu zůstává cizí nestagovaný soubor
  `apps/conference/src/components/content-state 2.tsx`, stará kopie z
  22. července. Při produkčních kontrolách byl pouze dočasně přesunut mimo
  `src` a vrácen; není součástí `F2-01`, `F2-02`, `F2-03`, `F2-04` ani
  `F2-06` a nesmí být commitnutý.
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

Po potvrzení úspěšného CI na `origin/stage/03-content` samostatně schválit
vytvoření PR etapy 3 do `staging`. PR ani merge nejsou součástí dosavadního
schválení a nesmějí se provést automaticky.

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
