# Roadmapa a implementační plán

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Otevřené otázky a rizika »](./07-otevrene-otazky-a-rizika.md)

---

## Roadmapa a implementační plán

### 1. Manažerské shrnutí

BYZON 2026 dnes stojí na stabilním, čistě statickém marketingovém webu (`build.py` → `data/content.json` → FTP), který chceme **zachovat beze změny** jako neměnné jádro. Nad něj postavíme samostatnou **PWA aplikaci na `app.byzon.cz`** se **Supabase** (Postgres + Auth + Realtime + RLS + Storage, EU region Frankfurt) jako backendem a **SvelteKit na Cloudflare Pages** jako frontendem — tj. doporučení je **buy managed backend, build vlastní frontend**, s jednou výjimkou: živé Q&A a ankety v MVP **embednout přes Slido** (build-vs-buy řez, abychom do září nestavěli moderaci a anti-abuse od nuly). `content.json` zůstává jediným zdrojem pravdy pro program a řečníky; aplikace ho importuje seed skriptem, takže marketing web nikdy nerozbijeme. Klíčové architektonické zásady: **bez hesel** (magic-link/OTP), **privacy-by-default** (networking opt-in defaultně vypnutý, GDPR čl. 25) a **RLS místo "trust the client"**. Přínos je trojí: účastník dostane personalizovanou agendu, řízený networking a živou interakci ("Lidskost jako konkurenční výhoda" se stane funkční, ne jen claimem); pořadatel získá check-in, jediný kanál pravdy při změnách a měřitelný engagement; partner dostane lead retrieval. **Hlavní doporučení vzhledem k termínu (akce za ~12 týdnů):** jet **redukovaný MVP pro 2026** (registrace + agenda + check-in + oznámení + Slido), a plný rozsah (vlastní Q&A, pokročilý matchmaking, gamifikace) odložit na ročník 2027, kdy bude čas i data z prvního běhu.

### 2. MoSCoW přehled funkcí napříč doménami

Legenda složitosti: **S** = hodiny–1 den · **M** = dny · **L** = 1–2 týdny · **XL** = 2+ týdny / externí závislost.

| Funkce | Doména | Priorita | Složitost | Fáze |
|---|---|---|---|---|
| Sdílené design tokeny (brand) marketing↔app | architektura | MUST | S | 0 |
| PWA skeleton + routing + EU Supabase projekt | architektura | MUST | M | 0 |
| Seed `content.json` → DB (program, řečníci) | architektura/data | MUST | M | 0 |
| Magic-link / OTP login (bez hesel) | registrace/bezpečnost | MUST | S | 0 |
| Párování SimpleShop objednávky → účet (webhook + API v2) | registrace/integrace | MUST | M–L | 0 |
| CSV/JSON import objednávek (fallback k webhooku) | registrace/integrace | MUST | S | 0 |
| Ticket model + role (attendee/speaker/partner/staff) | data/bezpečnost | MUST | M | 0 |
| Read-only program & řečníci v app | agenda | MUST | S | 0 |
| RLS policies na všech tabulkách s osobními daty | bezpečnost | MUST | M | 0 |
| Onboarding + minimální profil | registrace | MUST | M | 1 |
| Stabilní `id` + ISO `start/end` u events (rozšíření modelu) | agenda/admin | MUST | M | 1 |
| Personalizovaná agenda ("Moje agenda", bookmark) | agenda | MUST | M | 1 |
| Detekce kolizí paralelních sessions | agenda | SHOULD | S | 1 |
| Rezervace workshopů + waitlist (kapacity) | agenda | SHOULD | M | 1 |
| ICS / Add-to-Calendar | agenda/integrace | SHOULD | S | 1 |
| Sledování řečníků | agenda | SHOULD | S | 1 |
| Networking profil + opt-in toggle | networking | MUST | M | 1 |
| Adresář účastníků (filtry, fulltext) | networking | MUST | M | 1 |
| Rule-based matchmaking (doporučení kontaktů) | networking | SHOULD | M | 1 |
| Speaker portal: magic-link + self-service profil | speaker | MUST | M | 1 |
| Sběr podkladů (bio/foto/slidy) se stavem a deadliny | speaker | MUST | M | 1 |
| Automatické připomínky deadlinů řečníkům | speaker | MUST | S–M | 1 |
| Schvalovací workflow podkladů organizátorem | speaker | MUST | M | 1 |
| Consent log (záznam, GDPR, foto, sdílení slidů) | speaker/bezpečnost | MUST | M | 1 |
| Admin: CRUD program (CMS nad days/stages/events) | admin | MUST | M | 1 |
| Admin: publikace = commit `content.json` přes GitHub API | admin/integrace | MUST | L | 1 |
| Admin: správa řečníků, účastníků, rolí | admin | MUST | M | 1 |
| Praktické info "Než přijedeš" | další | MUST | S | 1 |
| FAQ s vyhledáváním + FAQPage schema | další | MUST | S | 1 |
| Transakční e-mail (Postmark/EU SMTP) | integrace | MUST | M | 1 |
| Check-in / QR sken na recepci | live/data/integrace | MUST | L | 2 |
| QR vstupenka v aplikaci | další/integrace | MUST | M | 2 |
| Live agenda + "co běží teď" | agenda/live | MUST | M | 2 |
| Oznámení / news feed + Web Push | další/live/integrace | MUST | M | 2 |
| Q&A na sessions (Slido embed) | live | MUST | S | 2 |
| Q&A na sessions (vlastní, Supabase Realtime) | live | SHOULD | L | 2/3 |
| Živé ankety a hlasování (Slido embed) | live | SHOULD | S | 2 |
| Networking: žádost o spojení + 1:1 schůzky + sloty | networking | SHOULD | L | 2 |
| Meeting pointy / stolky | networking | SHOULD | M | 2 |
| Interaktivní mapa Clarionu / wayfinding | další | SHOULD | M | 2 |
| Lead retrieval pro partnery (sken QR) | další/networking | SHOULD | M–L | 2 |
| Digitální vstupenka do Wallet | další | COULD | M | 2/3 |
| Dietní preference / catering sběr | další | SHOULD | M | 1/2 |
| Sdílení prezentací účastníkům (po akci) | speaker | SHOULD | L | 3 |
| Materiály/handouty per session | speaker/další | SHOULD | S–M | 2/3 |
| Hodnocení sessions + NPS celé akce | další | SHOULD | M | 3 |
| Záznamy a sestřihy (on-demand knihovna) | další | COULD | S | 3 |
| Certifikát účasti (PDF) | další | COULD | S–M | 3 |
| Fotogalerie / social wall (moderovaná) | další | COULD | M | 3 |
| Gamifikace / leaderboard / tombola | další | COULD | M | 3 |
| "Výjimečný Jihočech 2026" — kandidáti/hlasování | další | COULD | M | 2/3 |
| Vícejazyčnost CZ/EN | další/infra | COULD | M–L | 3 |
| Pokročilý matchmaking (embeddings re-ranking) | networking | COULD | L | 3 |
| Analytika (Plausible) + CRM webhook | integrace | SHOULD | S | 2/3 |
| Reakce / emoji během sessions | live | COULD | M | 3 |
| AI asistent / chatbot pro dotazy | další | COULD | M–L | 3 |
| Live titulky / přepis | další | COULD | L–XL | 3 |

### 3. Fáze dodávky

#### Fáze 0 — Základy (architektura, identita, párování)
**Cíl:** Postavit nedotknutelné jádro — samostatnou app vrstvu, identitu bez hesel a spolehlivé párování zaplacené vstupenky na účet — aniž bychom se dotkli marketingu. Po Fázi 0 existuje "prázdná, ale funkční" appka, do které se umí přihlásit zaplacený účastník.

**Klíčové dodávky:**
- Supabase projekt (EU/Frankfurt), SvelteKit PWA skeleton na Cloudflare Pages, subdoména `app.byzon.cz`.
- `design-tokens.css`/`tokens.json` (růžová `#f5218e`, švestková `#140610`, navy `#0f172a`, Khand+Inter) sdílené oběma projekty.
- Seed skript `scripts/seed_from_content.py`: import `program.days[]` a `speakers.list[]` (12 řečníků) do DB.
- Datový model jádra: `Edition`, `User/Account`, `UserRole`, `Order`, `Ticket`, `consents`. RLS na všech tabulkách s osobními daty od první migrace.
- Magic-link / 6místný OTP login.
- SimpleShop integrace: Edge Function `/hooks/simpleshop` (webhook po platbě → GET detailu přes API v2, idempotentní UPSERT dle `order_code`, generování N ticketů) **+ CSV/JSON import jako fallback** (MUST — záloha, pokud webhook nestihneme nasadit).
- Read-only zrcadlo programu a řečníků v app.

**Vstupní kritéria:** přístup do Supabase, GitHub repo (máme), SimpleShop API klíč + možnost nastavit webhook, DNS pro subdoménu.
**Výstupní kritéria:** zaplacený účastník se přihlásí magic-linkem, vidí svůj ticket a statický program; objednávka z testovacího nákupu se objeví v DB do 60 s; žádná regrese na `byzon.cz`; CSV import zvládne plný seznam objednávek za < 5 min.

#### Fáze 1 — Pre-event MVP (před akcí)
**Cíl:** Funkce, které žijí **týdny před akcí** — onboarding, personalizace agendy, networking profily, sběr podkladů od řečníků a admin pro tým. Tohle je největší blok hodnoty pro pořadatele (přestane honit podklady e-mailem) i účastníka (plánuje si účast).

**Klíčové dodávky:**
- Onboarding s minimálním profilem (foto/firma/aspoň 1 tag), předvyplnění z `order.custom_fields`.
- Rozšíření event modelu: stabilní `id` (`d{den}-{stage}-{HHMM}-{slug}`), ISO `start`/`end`, `speakerSlugs[]`, `tags[]`, `capacity`, `bookable`; `timeDisplay` generuje `build.py`.
- Personalizovaná agenda: bookmark "Moje agenda", detekce kolizí, ICS export, sledování řečníků; rezervace workshopů s waitlistem (SHOULD).
- Networking: profil + opt-in toggle, adresář s filtry (obor, zájmy, hledám/nabízím), rule-based matchmaking (doporučení).
- Speaker portal: magic-link, self-service profil mapovaný 1:1 na `content.json` model, upload bio/foto/slidů s verzováním, stavový model podkladů + deadliny + automatické připomínky, schvalovací workflow, consent log.
- Admin základ: CRUD program v DB, **publikace = commit `content.json` přes GitHub API** (spustí `build.py`/deploy), správa řečníků/účastníků/rolí, audit log.
- Read-only quick wins do `content.json`: "Než přijedeš", FAQ + FAQPage schema, transakční e-mail.

**Vstupní kritéria:** hotová Fáze 0; freeze datového modelu eventů; e-mail provider ověřený (SPF/DKIM).
**Výstupní kritéria:** otevřená registrace/onboarding pro reálné kupce; ≥ 60 % řečníků dodalo schválené podklady přes portál; tým publikuje změnu programu z adminu bez programátora a web se korektně přebuilduje; adresář není "ghost town" (vynucený minimální profil).

#### Fáze 2 — Event-day (během akce)
**Cíl:** Vše, co běží **18.–19. září na místě** — vstup, živá interakce, oznámení, schůzky. Důraz na odolnost vůči hotelové WiFi (degradace, ne pád) a na nízkou bariéru zapojení.

**Klíčové dodávky:**
- Check-in: scanner route `/scan` (role staff), QR `qr_token` (UUID) → zápis `checked_in_at`; QR vstupenka v aplikaci.
- Live agenda "co běží teď" (čas + override moderátora), oznámení/news feed + Web Push (VAPID), 2–3 cílené pushe/den.
- Q&A a ankety: **Slido embed** v MVP (per session), brandovaný rámec; vlastní Supabase varianta připravena jako SHOULD/3.
- Networking během akce: žádost o spojení, 1:1 schůzky se sloty odvozenými z programu (`break`/`networking`/`meal`), meeting pointy/stolky.
- Interaktivní mapa Clarionu, lead retrieval pro partnery (sken QR s opt-inem účastníka).

**Vstupní kritéria:** hotová Fáze 1; provedený check-in dry-run; presenter view/Slido otestováno na velkoplošné projekci; staff zaškolen.
**Výstupní kritéria:** check-in zvládne špičku příchodu (sken < 3 s/osoba, offline-tolerantní fronta); push doručen; ≥ 1 dotaz/anketa proběhne živě bez výpadku; nulový incident s podvrženou vstupenkou.

#### Fáze 3 — Post-event & pokročilé
**Cíl:** Zhodnotit data z prvního běhu, doručit odloženou hodnotu a připravit ročník 2027.

**Klíčové dodávky:** sdílení schválených prezentací účastníkům, hodnocení sessions + NPS, on-demand záznamy, certifikáty účasti (PDF), "Potkali jsme se" / výměna kontaktů, gamifikace/leaderboard, fotogalerie, analytika + CRM webhook, vlastní Q&A (náhrada Slida), pokročilý matchmaking (embeddings), vícejazyčnost CZ/EN.
**Vstupní kritéria:** akce proběhla, retenční pravidla aktivní (engagement data smazat 30–90 dní po akci).
**Výstupní kritéria:** NPS a feedback report pro tým; export "co fungovalo" jako vstup do plánu 2027; GDPR retence vykonána.

### 4. Doporučený MVP pro ročník 2026

Vzhledem k ~12 týdnům do akce doporučuji **řez na "MVP 2026"** = celá Fáze 0 + redukovaná Fáze 1 + redukovaná Fáze 2:

**Co je v MVP 2026 (MUST):**
1. Architektura + identita + párování vstupenek (celá Fáze 0).
2. Onboarding + personalizovaná agenda (bookmark, kolize, ICS) — největší samostatná hodnota, funguje i jako "jen lepší program".
3. Networking profily + adresář s filtry + opt-in (matchmaking jako rule-based "nice to have", schůzkový engine **odložit**).
4. Speaker portal pro sběr podkladů — protože **deadliny řečníků jsou už teď** a ruční honění e-mailem je největší provozní bolest.
5. Admin: program CMS + publikace přes GitHub, správa řečníků/účastníků.
6. Event-day: **check-in/QR**, live agenda + **oznámení/Web Push**, **Q&A/ankety přes Slido embed**.
7. Read-only quick wins: "Než přijedeš", FAQ, mapa.

**Co se řeže ven (do 2027):** vlastní Q&A engine (→ Slido), schůzkový/meeting-slot engine (jen profily + "spoj se"), pokročilý matchmaking, gamifikace, certifikáty, NPS automatizace, Wallet, vícejazyčnost, social wall.

**Odůvodnění řezu:** Slido eliminuje nejrizikovější vlastní vývoj (realtime moderace + anti-abuse) za cenu brandu a jednotných dat — přijatelný kompromis pod časovým tlakem. Schůzkový engine je hodnotný, ale závisí na kritickém množství aktivních profilů, které u prvního ročníku nezaručíme; profily + adresář + "spoj se" dají 80 % hodnoty za 30 % práce. Speaker portal naopak **nelze** odložit, protože jeho deadliny běží nezávisle na appce. Pokud by se i tento rozsah ukázal jako neúnosný, **minimální obhajitelný řez** je: párování vstupenek + agenda + check-in + Slido + oznámení (vše ostatní 2027).

### 5. Milníky a časová osa (zpětně od 18. 9. 2026)

| Termín | Milník | Co musí být hotové |
|---|---|---|
| **konec června** (T‑12 týdnů) | Kickoff + Fáze 0 start | Supabase EU projekt, PWA skeleton, design tokeny, GitHub workflow; rozhodnutí Slido vs. vlastní (= Slido). |
| **mid červenec** (T‑10) | Fáze 0 hotová | Magic-link login, SimpleShop webhook **i** CSV fallback ověřeny, seed `content.json`→DB, RLS. **Freeze event datového modelu.** |
| **konec července** (T‑8) | **Otevření registrace/onboardingu** + Speaker portal live | Účastníci se přihlašují; **rozeslány magic-linky všem 12 řečníkům**; spuštěny deadliny podkladů. |
| **začátek srpna** (T‑7) | **Deadline pro podklady řečníků** (bio/foto) | Automatické připomínky běží; schvalovací workflow v provozu. |
| **mid srpen** (T‑5) | Pre-event MVP feature-complete | Agenda, networking profily/adresář, admin CMS hotové; **deadline slidů řečníků** (T‑5 až T‑3). |
| **konec srpna** (T‑3) | **Freeze programu** (obsahový) | Program zamčen v adminu; jen drobné změny přes publikaci. Event-day funkce code-complete. |
| **začátek září** (T‑2) | Event-day hardening + **check-in dry-run** | Sken na vzorku ticketů, Slido test na projekci, Web Push test, zátěžový test adresáře. |
| **týden před** (T‑1) | Go/No-Go + zaškolení staffu | Poslední CSV reconciliation objednávek; tisk záložních seznamů; runbook pro výpadek WiFi. |
| **15.–17. 9.** | Freeze kódu + on-site příprava | Žádné deploye den před; jen obsahové změny programu. |
| **18.–19. 9.** | **AKCE** | Check-in, live agenda, push, Slido, networking profily v provozu; on-call. |
| **+1 týden** | Post-event spuštěn | Sdílení slidů, feedback/NPS, poděkování; **start retence** (smazání engagement dat 30–90 dní). |

### 6. Hrubé odhady úsilí po fázích

Předpoklad týmu: **1 full-stack dev (Supabase+SvelteKit) na hlavní vývoj + 0,5 FTE na frontend/PWA/design + 1 člověk z org týmu na obsah/admin/řečníky** (part-time). Bez dedikovaného DevOps (proto managed Supabase + Cloudflare).

| Fáze | Rozsah (MVP 2026) | Odhad (člověko-dny) | Kalendářně |
|---|---|---|---|
| Fáze 0 | architektura, identita, párování, seed, RLS | **15–20 čd** | ~2–3 týdny |
| Fáze 1 (redukovaná) | onboarding, agenda, networking profily, speaker portal, admin CMS, quick wins | **30–40 čd** | ~4–5 týdnů |
| Fáze 2 (redukovaná) | check-in/QR, live agenda, push/oznámení, Slido, mapa | **15–20 čd** | ~2–3 týdny |
| **Σ MVP 2026** | | **~60–80 čd** | **~10–12 týdnů** s 1,5 FTE |
| Fáze 1 plná (navíc 2027) | rezervace+waitlist, matchmaking plně, consent granularita | +10–15 čd | — |
| Fáze 2 plná (2027) | vlastní Q&A engine, schůzkový engine, lead retrieval, Wallet | +25–35 čd | — |
| Fáze 3 (2027) | NPS, certifikáty, gamifikace, embeddings, CZ/EN, social wall | +30–40 čd | — |

**Realita:** MVP 2026 (~60–80 čd) je na hraně proveditelnosti pro 1,5 FTE za 12 týdnů. Buď posílit na **2 FTE devs**, nebo dále řezat (viz minimální řez v §4). Konzervativní doporučení: rozpočtovat 2 devs a držet Slido.

### 7. Rizika a mitigace (top 8) + závislosti

| # | Riziko | Dopad | Mitigace |
|---|---|---|---|
| 1 | **Krátký čas do akce** — plný rozsah se nestihne | vysoký | Tvrdý MVP řez (§4), Slido místo vlastního Q&A, schůzkový engine na 2027, 2 FTE devs. |
| 2 | **SimpleShop webhook se nezprovozní / je tenký/nekonzistentní** | vysoký | CSV/JSON import jako rovnocenný MUST fallback; webhook vždy potvrdit GET na API v2 + retry s backoffem; idempotence dle `order_code`. |
| 3 | **Prázdný adresář ("ghost town")** | střední | Vynutit minimální profil při onboardingu; předvyplnit z `custom_fields`; rule-based doporučení; org tým "naseeduje" VIP profily. |
| 4 | **Řečníci nedodají podklady včas** | vysoký | Speaker portal + deadliny + automatické připomínky live už v T‑8; eskalace na org člena; deadliny dříve než freeze programu. |
| 5 | **Hotelová WiFi padá během akce** | vysoký | PWA offline cache agendy a "co běží teď"; optimistic UI + retry fronta; OTP fallback k magic-linku; tištěné záložní check-in seznamy. |
| 6 | **GDPR/privacy incident** (sdílení profilů, foto, leady) | vysoký | Privacy-by-default, RLS na všem, append-only consent log, opt-in explicitní pole; správce ENJOiT s.r.o.; retence 30–90 dní; re-auth pro export/výmaz. |
| 7 | **Drift dvou zdrojů pravdy** (DB vs. `content.json`) | střední | `content.json` zůstává kanonický; admin generuje commit přes GitHub API; `build.py` se nemění; nikdy ne paralelní ruční edit. |
| 8 | **Check-in nezvládne špičku příchodu** | střední | Dry-run T‑2 na vzorku; více scannerů/staff; UUID token (rychlé ověření); offline-tolerantní zápis; záložní papírový seznam. |

**Klíčové závislosti:** SimpleShop API v2 + možnost nastavit webhook · GitHub API token (Edge Function secret) · transakční e-mail provider (SPF/DKIM, EU) · VAPID klíče pro Web Push · DNS pro `app.byzon.cz` · Slido účet/embed · dostupnost řečníků pro dodání podkladů · mapa/plánek Clarionu od hotelu.

### 8. KPI / metriky úspěchu aplikace

| Oblast | Metrika | Cílová hodnota (1. ročník) |
|---|---|---|
| Aktivace | % zaplacených, kteří aktivovali účet | ≥ 60 % |
| Agenda | % účastníků s ≥ 1 sessionem v "Moje agenda" | ≥ 50 % |
| Networking | % účastníků s opt-in a kompletním profilem | ≥ 35 % |
| Networking | počet navázaných spojení / aktivní účet | ≥ 2 |
| Check-in | průměrná doba skenu / nulové podvržení | < 3 s / 0 incidentů |
| Live | počet dotazů a hlasů přes Q&A/ankety | ≥ 1 dotaz na 5 účastníků |
| Oznámení | doručitelnost Web Push | ≥ 80 % opt-in zařízení |
| Řečníci | % podkladů dodaných přes portál do deadlinu | ≥ 80 % |
| Partner | leady zachycené přes lead retrieval | ≥ 10 / partner |
| Provoz | uptime app během akce / chybovost párování | ≥ 99 % / < 1 % |
| Post-event | response rate NPS/feedback | ≥ 30 % |
| Spokojenost | NPS celé akce | ≥ +40 |

### 9. Doporučení a další krok

**Doporučení:** Jet **MVP 2026** dle §4 se **2 FTE devs**, držet **Supabase + SvelteKit + Cloudflare Pages**, **Slido** pro živou interakci a **CSV import jako rovnocennou zálohu** k SimpleShop webhooku. Vše ostatní (vlastní Q&A, schůzkový engine, gamifikace, matchmaking, CZ/EN) je explicitně **2027 scope**. Nedotknout se `build.py`/`content.json` jako kanonického zdroje.

**Konkrétní první krok (tento týden):**
1. Založit Supabase projekt v EU regionu (Frankfurt) a Cloudflare Pages projekt; zarezervovat subdoménu `app.byzon.cz` (DNS).
2. Vytvořit `scripts/seed_from_content.py` a naimportovat stávajících 12 řečníků a program z `data/content.json` do DB — tím se okamžitě ověří datový model a foreign keys.
3. V SimpleShopu (form `0MnNQ`, kampaň 44467) zapnout "Webhook po platbě" na Edge Function a paralelně otestovat CSV export objednávek jako fallback.
4. Rozhodnout a potvrdit Slido účet, aby se Q&A/ankety daly v září jen embednout.
5. Připravit a v T‑8 rozeslat magic-link pozvánky všem řečníkům do speaker portálu — deadliny podkladů jsou nejbližší tvrdý termín a nesmí čekat na zbytek appky.

Relevantní soubory v repu: `/home/user/byzon-2026/build.py` (generátor, beze změny), `/home/user/byzon-2026/data/content.json` (kanonický obsah — 12 řečníků v `speakers.list`, program v `program.days[]`), nový `/home/user/byzon-2026/scripts/seed_from_content.py` (k vytvoření).
