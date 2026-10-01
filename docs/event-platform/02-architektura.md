# Architektura a technologický stack

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Datový model »](./03-datovy-model.md)

> ⚠️ **Aktualizováno rozhodnutím.** Závazná volba stacku je v [00 — Rozhodnutí](./00-rozhodnuti.md): **Next.js + PostgreSQL na Railway + Cloudflare DNS**, **Auth.js** magic-link, **Cloudflare R2** úložiště, **vlastní Q&A** (SSE + Postgres `LISTEN/NOTIFY`), plný rozsah pro 2026. Níže uvedené **Supabase / SvelteKit / Slido** jsou *zvažované varianty* — rozhodovací matice a obecné principy (topologie, PWA, realtime, prostředí, náklady) ale platí dál.

---

## Cílová architektura a tech stack

Tato sekce navrhuje konkrétní cílovou architekturu pro rozšíření webu BYZON o event-management (před akcí) a event-day (během akce) aplikaci. Vychází z toho, že stávající marketing web je čistě statický (`build.py` → `data/content.json` → HTML na FTP) a tento stav má zůstat zachován jako stabilní, neměnné jádro.

**Hlavní rozhodnutí v jedné větě:** marketing web nech beze změny na FTP, postav samostatnou PWA na subdoméně `app.byzon.cz` se **Supabase** jako backendem a **SvelteKit** jako frontendem, nasazenou na **Cloudflare Pages**, s jediným zdrojem pravdy pro obsah (`content.json` se importuje do DB seed skriptem). Q&A a živé ankety **nekódovat** — embednout Slido. Vše ostatní (agenda, networking, check-in, push) postavit custom.

---

### 1. Topologie

Zachováváme striktní oddělení dvou světů: **read-only marketing** (statika, anonymní, SEO) a **stateful aplikace** (účty, zápis, realtime). Mísení by ohrozilo to, co dnes funguje.

| Vrstva | Doména | Kde běží | Změna oproti dnešku |
|---|---|---|---|
| Marketing | `byzon.cz`, `www.byzon.cz` | FTP, statika z `build.py` | Žádná v architektuře; jen přidat CTA odkazy na app |
| Aplikace | `app.byzon.cz` | Cloudflare Pages (SvelteKit) | Nový projekt |
| Backend / data | (Supabase managed) | Supabase EU region (Frankfurt) | Nový |
| Scanner check-in | `app.byzon.cz/scan` (chráněná role) | totéž PWA, jiná route | Součást app |

**Proč subdoména `app.byzon.cz` a ne `byzon.cz/app`:**
- FTP hosting neumí SPA routing, env secrets ani serverless funkce — `/app` jako podadresář na FTP je technicky neudržitelné.
- Subdoména umožní zcela samostatný deployment pipeline (Cloudflare Pages) bez dotyku FTP.
- Cookie scope lze nastavit na `.byzon.cz`, takže pokud později budeme chtít na marketingu zobrazit „přihlášen jako…", session je sdílitelná. Pro MVP to nepotřebujeme.

**Struktura routes v aplikaci:**

| Route | Účel | Přístup |
|---|---|---|
| `/` | Rozcestník / dashboard účastníka | přihlášený |
| `/login` | Magic-link login | veřejný |
| `/agenda` | Multi-stage program, bookmark, „moje agenda" | přihlášený (částečně veřejné read-only) |
| `/speakers`, `/speakers/<slug>` | Řečníci (zrcadlí marketing) | veřejný |
| `/me` | Profil + networking opt-in toggle | přihlášený |
| `/networking` | Seznam účastníků, matchmaking, žádost o spojení | přihlášený + opt-in |
| `/meetings` | Sloty schůzek, meeting pointy | přihlášený + opt-in |
| `/ticket` | QR vstupenka účastníka | přihlášený |
| `/scan` | Scanner pro recepci/partnery | role `staff`/`partner` |
| `/admin` | Správa, moderace, GDPR výmaz/export | role `admin` |
| `/speaker-portal` | Self-service upload bio/foto/slidů | role `speaker` |

**Provázání marketing ↔ app (jednotný brand, odkazy, login):**

- **Brand:** vytáhnout barvy (`#f5218e`, `#140610`, `#0f172a`) a fonty (Khand + Inter) do sdíleného `design-tokens.css` / `tokens.json`, který konzumují oba projekty. Tím se vyhneme drift mezi marketingem a app. **MUST · S.**
- **Odkazy:** v `content.json` přidat globální CTA „Vstoupit do aplikace BYZON" → `app.byzon.cz`. Po koupi vstupenky (potwrzovací stránka SimpleShop / e-mail) přidat magic-link prompt. **MUST · S.**
- **Login:** jediný účet žije v Supabase Auth na subdoméně. Marketing zůstává anonymní. **MUST · S.**
- **Jeden zdroj obsahu:** `content.json` zůstává single source of truth pro program a řečníky. App ho **importuje** seed skriptem (`scripts/seed_from_content.py`) do Postgres tabulek. `build.py` se nikdy nemění kvůli app. Tím nikdy nerozbijeme marketing web. **MUST · M.**

---

### 2. Volba backendu — rozhodovací matice

Hodnoceno pro reálná omezení: **malý tým bez DevOps, jednorázová/roční akce, potřeba realtime, EU hosting kvůli GDPR, nízká provozní zátěž mezi ročníky.**

| Kritérium (váha) | Supabase | Pocketbase | Directus | Firebase | CF Workers + D1 | Next.js fullstack |
|---|---|---|---|---|---|---|
| Rychlost k MVP (×3) | 5 | 4 | 3 | 5 | 2 | 2 |
| Realtime out-of-box (×3) | 5 | 4 | 2 | 5 | 1 | 1 |
| Auth (magic-link) vestavěné (×2) | 5 | 4 | 4 | 5 | 1 | 2 |
| EU/GDPR hosting (×3) | 5 (EU region) | 5 (self-host EU) | 5 | 2 (US default) | 4 | 5 |
| Žádný lock-in / exportovatelnost (×2) | 5 (čistý PG) | 5 (SQLite) | 4 (PG) | 1 (NoSQL) | 3 | 4 |
| Provozní zátěž po akci (×3) | 5 (managed) | 2 (self-host) | 2 (self-host) | 5 | 4 | 3 |
| Relační model (agenda/řečníci) (×2) | 5 | 4 | 5 | 1 | 3 | 5 |
| Cena pro stovky uživatelů (×2) | 5 (free/levné) | 5 | 4 | 4 | 5 | 3 |
| **Vážené skóre (max 100)** | **~98** | **~78** | **~67** | **~71** | **~52** | **~58** |

**Primární doporučení: Supabase.** Zdůvodnění:

- **Datový model je silně relační** — `days → stages → events`, řečníci, partneři, schůzky, vstupenky. Postgres je přirozený fit; Firebase NoSQL by nás nutil denormalizovat a bojovat s dotazy nad agendou.
- **Vše v jedné službě:** Postgres + Auth (magic-link) + Realtime + Storage (fotky, slidy) + Edge Functions (webhook SimpleShop, push). Pro tým bez DevOps to minimalizuje počet pohyblivých částí.
- **GDPR:** Supabase nabízí EU region (Frankfurt) → data residency v EU bez US transferu. Uzavřeme DPA.
- **Žádný lock-in:** data jsou čistý Postgres, kdykoli `pg_dump`. Mezi ročníky lze projekt uspat (free/pauza) a obnovit.
- **RLS (Row Level Security)** dává deklarativní autorizaci přímo v DB — kritické pro networking opt-in a moderaci Q&A (`approved` flag).

**Záloha: Pocketbase (self-host na EU VPS).** Pokud by vadila závislost na Supabase jako SaaS (např. cenový skok, výpadek), Pocketbase je jediný Go binár se SQLite, vestavěným auth, realtime a file storage. Plná kontrola, levné, ale **my provozujeme a zálohujeme server** — proto záloha, ne primár. Migrace Supabase→Pocketbase je únosná, protože oba mají SQL-like model a držíme schema pod kontrolou.

**Odmítnuté:** Firebase (NoSQL + US + lock-in), Directus (skvělý jako headless CMS, ale realtime slabší a self-host režie), CF Workers+D1 (auth/realtime si stavíme sami = víc kódu), Next.js fullstack (nejvíc kódu i provozu, pomalé k MVP).

---

### 3. Frontend event-day jako PWA

**Volba frameworku: SvelteKit.** Rozhodovací úvaha:

| Kritérium | SvelteKit | Next.js / React | Astro + islands |
|---|---|---|---|
| Velikost bundle (důležité na hotelové WiFi) | nejmenší (no VDOM) | velký | malý, ale interaktivita přes islands |
| Křivka učení / rychlost vývoje | vysoká | střední | střední |
| PWA + service worker + offline | nativní (`@vite-pwa/sveltekit`) | dobré | horší pro stateful app |
| Realtime / reaktivní UI (Q&A, ankety, agenda) | excelentní (runes/stores) | dobré | islands jsou pro to neohrabané |
| Cloudflare Pages adapter | oficiální | oficiální | oficiální |

**Proč SvelteKit a ne Next.js:** event-day app je **interaktivní stateful PWA**, ne obsahový web. Klíčové jsou malý bundle (přetížená WiFi v sále), rychlá reaktivita (živá agenda, Q&A, push) a nízká kognitivní zátěž pro malý tým. Svelte stores se Supabase Realtime tvoří elegantní pár — subscribe na tabulku → store → UI se překreslí. Next.js by přinesl zbytečnou React-runtime váhu a komplexitu (RSC/serverové komponenty pro app, která je z 90 % client-side). Astro je skvělý na obsah (klidně by se hodil i na marketing web v budoucnu), ale na stateful PWA s realtime je islands model neohrabaný.

**PWA specifika:**
- Instalovatelná (manifest, ikona BYZON na ploše) → „appový" pocit bez App Store.
- Service worker cachuje agendu, řečníky, mapu Clarionu → **funguje offline / při přetížené WiFi**. **MUST · M.**
- iOS Web Push funguje jen u PWA přidané na plochu (Safari 16.4+) → onboarding musí uživatele navést k „Přidat na plochu".

**Sladění s brandem:** sdílený `tokens.json` (viz topologie) → Tailwind config nebo CSS custom properties s `#f5218e` / `#140610` / `#0f172a`, fonty Khand (nadpisy) + Inter (text) self-hosted (woff2) kvůli rychlosti a GDPR (žádné Google Fonts CDN). Dodržet přístupnost ze stávajícího webu (ARIA, skip-link, `prefers-reduced-motion`). **MUST · S.**

---

### 4. Realtime vrstva

**Supabase Realtime** (Postgres logical replication + broadcast + presence) — nepřidává žádnou další službu.

| Funkce | Mechanismus | Priorita / odhad |
|---|---|---|
| Živá agenda (změny programu se propíší okamžitě) | subscribe na tabulku `events` | SHOULD · M |
| Q&A | **NE custom — embed Slido** (viz Build vs Buy) | — |
| Live ankety | embed Slido | — |
| Presence „kdo je na sále / na networkingu" | Realtime presence | COULD · M |
| Notifikace o nové žádosti o schůzku | subscribe na `meeting_requests` | SHOULD · S |

**Pozn. ke kapacitě:** stovky účastníků jsou na hraně free tieru u burst eventů. Proto Q&A/ankety odkláníme na Slido (jejich infra to ustojí), a agregace anket neřešíme vůbec custom. Pro custom realtime (agenda, schůzky) je objem zpráv nízký → Supabase free/Pro stačí. Pusher/Ably jen jako nouzová varianta, pokud by se ukázal limit.

---

### 5. Auth, file storage, e-mail, push, QR

| Doména | Doporučení | Detail | Priorita / odhad |
|---|---|---|---|
| **Auth** | Supabase Auth, **magic-link** (bez hesel) | Ladí s „žádné účty" filozofií. Párovací klíč = **e-mail z objednávky SimpleShop**. Po platbě webhook vytvoří/aktualizuje účastníka → účastník se přihlásí magic-linkem na e-mail z objednávky. Role (`attendee`/`speaker`/`staff`/`partner`/`admin`) v `profiles.role`, vynucené přes RLS. | MUST · M |
| **File storage** | Supabase Storage (S3-kompatibilní, EU) | Buckety: `speaker-uploads` (slidy, bio, foto — privátní, jen speaker+admin), `event-photos` (galerie, veřejné po opt-in), `tickets-qr` (privátní). Slidy po session publikovat read-only. | SHOULD · M |
| **E-mail (transakční)** | **Resend** nebo **Postmark** (oba EU-friendly) přes Supabase Edge Function | Magic-link, potvrzení schůzky, „slidy jsou k dispozici". Self-hosted SMTP nedoporučuji (deliverability). Ověřit EU data residency, uzavřít DPA. SPF/DKIM/DMARC na `byzon.cz`. | MUST · M |
| **Push** | Web Push (VAPID) přes service worker, odesílané ze Supabase Edge Function | „Workshop začíná za 10 min", změny programu, „máš novou žádost o schůzku". **Opt-in (GDPR).** Plán 2–3 cílené pushe/den, ne spam. iOS jen u nainstalované PWA. | SHOULD · M |
| **QR check-in** | Token (UUID) v DB → QR v app/e-mailu; scanner = kamera v PWA (`BarcodeDetector`/`html5-qrcode`) | Po platbě SimpleShop → vygeneruj token → zobraz jako QR v `/ticket`. U vchodu `/scan` ověří token proti DB, označí příchod (real-time dashboard). Partner skenuje leady (souhlas účastníka). Offline režim scanneru: cache validních tokenů. | SHOULD · L |

**Napojení na SimpleShop (kritická závislost pro identitu účastníků):**
- **Primár:** webhook „po platbě" (per produkt / globálně) → Supabase Edge Function → dotáhne detail objednávky přes SimpleShop REST API v2 (Basic Auth, API klíč **jen v Edge Function secrets, nikdy v klientu**) → upsert účastníka. Párování `e-mail + kód objednávky`. **MUST · M.**
- **Fallback:** manuální/cron import CSV/JSON exportu „Kdo koupil" → seed účastníků. Spolehlivá záloha, pokud tým webhook nezapojí včas. **MUST · S.**

---

### 6. Build vs Buy + hybridní varianta

**Doporučení: hybrid — postav jádro custom, kup interakční vrstvu.**

| Doména | Build / Buy | Zdůvodnění | Priorita |
|---|---|---|---|
| Agenda, řečníci, profil, networking, schůzky, check-in, push, ICS | **BUILD** (Supabase + SvelteKit) | Sdílí brand a data s webem, opakuje se ročně, lock-in generických platforem je drahý a nebrandovatelný. Rozsah je zvládnutelný. | MUST/SHOULD |
| **Q&A + živé ankety** | **BUY — Slido** (embed do PWA) | Best-in-class (upvoting, anonymita, moderace, projekce na velkou obrazovku, word cloud). Vlastní realtime Q&A by byl L a horší. Embed jako iframe v `/agenda` per session — stejný vzor jako SimpleShop. | SHOULD · S (embed) |
| Ticketing / platba | **BUY — SimpleShop** (beze změny) | `form_id 0MnNQ` je zaběhnutý, integrujeme přes API/webhook. Neměnit. | — |
| Matchmaking (AI) | **BUILD lite**, NE kupovat dedikovaný (Grip) | Pro první ročník stačí filtry + „hledám/nabízím" intent + manuální/managed schůzky. AI matchmaking jako COULD v dalším ročníku. | SHOULD (lite) |

**Proč ne koupit celou platformu (Whova/Swapcard):** generická, nebrandovatelná do `#f5218e`/Khand, data v jejich silu, drahé per-event, a každý rok znovu. Custom jádro na Supabase je malý rozsah, sdílí brand i data s webem a je opakovatelné. **Slido kupujeme cíleně** právě tam, kde je vlastní vývoj nejdražší a nejrizikovější (realtime moderovaný Q&A live na pódiu).

---

### 7. Prostředí, CI/CD, monitoring, zálohy, náklady

**Prostředí:**

| Prostředí | Frontend | Backend | Účel |
|---|---|---|---|
| **dev** | lokálně (`vite dev`) | Supabase CLI lokálně (Docker) | vývoj, žádná produkční data |
| **staging** | Cloudflare Pages preview (per PR) | samostatný Supabase projekt `byzon-staging` | testy, QA, seed z anonymizovaného `content.json` |
| **prod** | `app.byzon.cz` (Cloudflare Pages) | Supabase projekt `byzon-prod` (EU) | ostrá akce |

**CI/CD (GitHub, k dispozici v prostředí):**
- Repo: app jako samostatný adresář `/app` v `martymax/byzon-2026` (monorepo) nebo separátní repo — doporučuji **monorepo** kvůli sdíleným design tokens a `content.json`.
- **GitHub Actions:** na PR → lint + typecheck + build + Cloudflare Pages preview deploy + DB migrace na staging (Supabase CLI `db push`). Merge do `main` → deploy na prod + migrace na prod (s manuálním approval gatem). **MUST · M.**
- DB migrace verzované v repu (`supabase/migrations/`), nikdy ruční změny v prod konzoli.
- Secrets (SimpleShop API klíč, VAPID, Resend) v GitHub Actions secrets + Supabase Edge Function secrets, **nikdy v klientu/repu**.

**Monitoring:**
- **Sentry** (frontend + Edge Functions) — chyby, zvlášť důležité v event-day, kdy nelze ladit za pochodu. Free tier stačí.
- **Cloudflare Web Analytics** (cookieless, GDPR-friendly) — návštěvnost app.
- **Supabase dashboard** — DB metriky, realtime spojení, kapacita.
- **Uptime check** (UptimeRobot / Cron) na `/login` před a během akce.

**Zálohy:**
- Supabase Pro: automatické denní zálohy (PITR). Před akcí navíc ruční `pg_dump` do offline úložiště.
- `content.json` je v gitu → obsah je vždy reprodukovatelný seedem.

**Odhad měsíčních nákladů provozu:**

| Položka | Mimo sezónu | Měsíc akce (špička) |
|---|---|---|
| Supabase | Free / 0 Kč (lze pauznout) | **Pro ~25 USD** (~580 Kč) — kvůli zálohám, kapacitě, žádné pauze |
| Cloudflare Pages | Free / 0 Kč | Free (případně Pro 20 USD jen pokud potřeba) |
| E-mail (Resend) | Free (3k/měs) | Free–20 USD dle objemu magic-linků |
| Slido | dle plánu, per-event | ~Business plán cca 50–100+ USD/měs (jen měsíc akce) |
| Sentry | Free | Free |
| Doména/DNS | v rámci stávající | — |
| **Celkem** | **~0–10 USD/měs** | **~100–200 USD jen v měsíci akce** |

**Závěr nákladů:** mimo sezónu provoz blízko nuly (free tiery, případně pauza Supabase). Reálný náklad se koncentruje do 1–2 měsíců kolem akce (~2 500–5 000 Kč), drtivě nejlevnější varianta oproti per-attendee licencím komerčních platforem (Whova/Swapcard jdou do tisíců USD per event).

---

### Doporučený rollout (shrnutí priorit)

1. **MVP (MUST):** subdoména + PWA (SvelteKit) + Supabase (EU), import agendy/řečníků z `content.json`, offline cache, ICS export, magic-link login, párování se SimpleShop (webhook + CSV fallback). *(M–L)*
2. **V2 (SHOULD):** osobní agenda, Web Push, QR check-in + scanner, networking lite (intent profil + opt-in), schůzky, Slido embed pro Q&A. *(L)*
3. **V3 (COULD):** AI matchmaking, partner lead retrieval scoring, presence, gala „Výjimečný Jihočech" hlasování, post-event feedback + napojení na ClickUp/CRM. *(M)*

**Klíčové architektonické riziko a jeho mitigace:** udržet `content.json` jako single source of truth — app data **jen importuje**, `build.py` zůstává nedotčený, takže marketing web nikdy nerozbijeme. Druhé riziko — adopce app — řešit promem 2 měsíce předem, magic-linkem v potvrzení vstupenky a onboardingem vedoucím k akci („Naplánuj si den"), ne k výčtu funkcí.
