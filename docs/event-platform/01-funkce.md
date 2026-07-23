# Katalog funkcí event platformy

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Architektura »](./02-architektura.md)

---

Tento dokument je **katalog funkcí** navrhované platformy — odpověď na „co by v tom mělo být“. Funkce jsou rozdělené do sedmi domén; každá nese prioritu (MUST/SHOULD/COULD) a hrubý odhad složitosti (S/M/L/XL). Souhrnné zařazení do fází a do MVP najdeš v [roadmapě](./06-roadmapa.md).

## Obsah domén

1. **Registrace, účty, profily a onboarding**
2. **Personalizovaná agenda a kalendář**
3. **Networking a domlouvání schůzek**
4. **Live engagement: Q&A, ankety, hodnocení, gamifikace**
5. **Speaker portál a sběr podkladů**
6. **Admin / event-management backoffice**
7. **Další funkce (brainstorm) a quick winy**



---

## Doména: Registrace účastníků, účty, profily a onboarding

Tato sekce navrhuje stavovou doménu, která propojuje zaběhnutý prodej přes SimpleShop (form_id `0MnNQ`) s aplikací `app.byzon.cz` (Supabase). Klíčový princip: **vstupenka = oprávnění, účet = identita, profil = volitelný stav pro networking**. Tyto tři vrstvy záměrně oddělujeme, aby účastník mohl koupit lístek pro koho chce, aktivovat účet bez tření a do networkingu vstoupit jen vědomým opt-inem (GDPR čl. 25, privacy-by-default).

### 1. Datový model (Supabase / Postgres)

Tabulky drží stavovou vrstvu; `content.json` zůstává single source of truth pro statický obsah (řečníci, agenda). Profil řečníka v app **referencuje** `speaker.slug`, needuplikuje bio.

| Tabulka | Klíčová pole | Poznámka |
|---|---|---|
| `orders` | `id`, `simpleshop_order_code`, `email`, `buyer_name`, `ticket_type`, `quantity`, `paid_at`, `coupon`, `custom_fields jsonb`, `raw jsonb` | Zrcadlo objednávky ze SimpleShopu (webhook + API dotaz). `quantity > 1` = firemní/hromadná. |
| `tickets` | `id (uuid)`, `order_id`, `attendee_email` (nullable do přiřazení), `holder_name`, `status` (`unassigned`/`assigned`/`checked_in`/`void`), `qr_token (uuid)` | Jedna vstupenka = jeden řádek. Z `order.quantity` se generuje N ticketů. QR token pro check-in. |
| `accounts` | `id`, `email (unique, citext)`, `auth_user_id` (FK Supabase Auth), `locale` (`cs`/`en`), `created_at` | Identita. Nezávislá na tom, zda má profil nebo lístek. |
| `profiles` | `account_id (PK/FK)`, `display_name`, `company`, `job_role`, `bio`, `interests text[]`, `seeking`, `offering`, `links jsonb` (linkedin/web/instagram/youtube), `photo_path`, `networking_opt_in bool`, `visibility` (`hidden`/`attendees`/`public`), `updated_at` | Profil = volitelný. `networking_opt_in=false` defaultně. |
| `roles` | `account_id`, `role` (`attendee`/`speaker`/`partner`/`organizer`/`staff`), `scope jsonb` | Více rolí na účet (řečník je i účastník). Přiřazuje organizátor nebo párovací logika. |
| `consents` | `id`, `account_id`, `purpose` (`tos`/`privacy`/`networking`/`marketing`/`photo`), `granted bool`, `text_version`, `ip`, `user_agent`, `created_at` | Append-only log. Každý opt-in/opt-out = nový řádek (prokazatelnost čl. 7). |
| `invitations` | `id`, `ticket_id`, `inviter_account_id`, `email`, `token`, `status` (`sent`/`accepted`/`expired`), `expires_at` | Pozvánka doprovodu / firemního týmu na konkrétní ticket. |

**RLS (Row Level Security) – nutné od začátku:**
- `profiles`: SELECT povolen ostatním účastníkům jen když `networking_opt_in=true AND visibility IN ('attendees','public')`. Vlastník vidí vždy svůj.
- `consents`, `orders`, `tickets`: čte jen vlastník + role `organizer`/`staff` (service role v Edge Functions).
- Zápis do `roles` jen service role (nikdy klient).

---

### 2. Aktivace účtu po koupi vstupenky (párování se SimpleShop)

**Funkce:** Po zaplacení objednávky v SimpleShopu se automaticky vytvoří ticket(y) a účastník dostane výzvu k aktivaci účtu magic-linkem.
**Hodnota:** Účastník nemusí zakládat heslo ani nic přepisovat; pořadatel má v DB napárované platby na identity (podklad pro check-in, networking, partnerské leady).
**Priorita:** MUST · **Závislosti:** SimpleShop webhook + API v2, Supabase Auth + Edge Function, transakční e-mail (EU SMTP). · **Odhad:** M–L.

**Tok párování (primární cesta – webhook):**

```
SimpleShop "webhook po platbě"  →  Edge Function /webhooks/simpleshop
  1. ověř podpis/secret v query (shared token), jinak 401
  2. GET detail objednávky přes API v2 (Basic Auth: email + API key)  ── párovací klíč = order_code
  3. UPSERT orders (idempotentně dle simpleshop_order_code)
  4. vygeneruj `quantity` × tickets (status=unassigned, qr_token=uuid)
  5. ticket #1 přiřaď e-mailu kupujícího → attendee_email, status=assigned
  6. UPSERT accounts dle e-mailu (bez hesla)
  7. pošli "Aktivuj svůj BYZON účet" e-mail (magic-link na app.byzon.cz)
```

- **Idempotence:** webhook chodí i při editaci dokladu / re-sendu → vždy UPSERT podle `simpleshop_order_code`, nikdy slepý INSERT. Hlídat duplicitní generování ticketů (unique constraint `order_id + sequence`).
- **Tenký payload:** webhook nese minimum → vždy dotáhnout detail přes API (limit 100 záznamů/request neřešíme, jde o jednu objednávku).
- **Custom fields:** dotazníková pole z formuláře (firma, IČ, dieta, GDPR pre-opt-in) mapovat do `orders.custom_fields` a předvyplnit profil při onboardingu.

**Fallbacky (MUST mít aspoň jeden):**

| Fallback | Kdy | Složitost |
|---|---|---|
| **Cron import "Kdo koupil"** (CSV/JSON export přes API, paginace po 100) každých 15 min | Webhook nezapojen/spadl; záloha vždy | S–M |
| **Ruční CSV upload** v admin UI | API výpadek, ad-hoc oprava | S |
| **On-site aktivace kódem objednávky** | Účastník nedostal e-mail | S |

**Verifikace identity (anti-fraud, lightweight):** magic-link jde na **e-mail z objednávky**. Pokud se chce přihlásit jiný e-mail, vyžádej **kód objednávky** jako verifikační token (z potvrzovacího e-mailu SimpleShopu) → tím se ticket převede na nový účet. Žádná hesla = ladí s "žádné účty" filozofií webu.

---

### 3. Přihlášení

**Funkce:** Bezheslové primárně, s rozšiřitelností.
**Priorita:** MUST (magic-link) · SHOULD (social) · COULD (heslo) · **Závislosti:** Supabase Auth. · **Odhad:** S (magic-link) / S (social přes Supabase providery).

| Metoda | Verdikt | Důvod |
|---|---|---|
| **E-mail magic-link / OTP** | **MUST, primární** | Bez hesla, párovatelné na objednávkový e-mail, nejnižší tření, ladí s GDPR i UX webu |
| **LinkedIn OAuth** | **SHOULD** | B2B publikum, umožní import jméno/firma/role/foto do profilu → rychlejší networking onboarding |
| **Google OAuth** | COULD | Pohodlí; pozor na data residency (EU) |
| **E-mail + heslo** | COULD | Jen pokud uživatelé hlasitě chtějí; přidává reset-flow a bezpečnostní režii |

- **Session scope:** cookie na `.byzon.cz` (sdílení mezi `app.` a marketingem pro budoucí "přihlášen jako"). Pro MVP stačí session jen na subdoméně.
- **Vazba social ↔ ticket:** social login může vytvořit účet **bez** ticketu (host/zájemce). Ticket se připojí, až e-mail social účtu odpovídá objednávce, nebo přes zadání kódu objednávky. **Networking je dostupný i bez ticketu? Ne** – feature-gate dle vlastnictví ticketu (jinak ghost profily).

---

### 4. Onboarding flow (krok za krokem)

Cíl: dovést k **akci** (vyplň minimální profil / nastav opt-in), ne k seznamu featur. Maximálně 4 obrazovky, "outcome" copy ("Naplánuj si den, najdi ty správné lidi").

| Krok | Obrazovka | Co se děje | Povinné? |
|---|---|---|---|
| 0 | **Klik na magic-link** | Ověření e-mailu, vytvoření session, detekce `locale` (z prohlížeče / custom field) | – |
| 1 | **Vítej + jazyk** | Potvrď CS/EN, zobraz na jakou objednávku/ticket jsi napárován | Jazyk: ano |
| 2 | **Právní souhlasy** | TOS + Zásady OÚ (nutné pro účet, `6(1)(b)`). Samostatné, NEzaškrtnuté toggly: networking opt-in, marketing, foto. Ukládá se `consents` (verze textu, IP, UA, ts) | TOS+Privacy: ano; ostatní: ne |
| 3 | **Základní profil** | Předvyplněno z objednávky/LinkedIn: jméno, firma, role. Možnost foto. | Jméno: ano; zbytek: ne |
| 4 | **Networking intent** *(jen když opt-in v kroku 2)* | "O mně", zájmy (chip select), **Hledám / Nabízím**, LinkedIn. Nastavení `visibility`. | Vše volitelné |
| 5 | **Hotovo → CTA** | "Otevři agendu" / "Projdi účastníky". Žádný feature dump. | – |

- **Progressive disclosure:** krok 4 přeskočí, kdo nechce networking; lze doplnit kdykoli později z profilu. **Profile completeness meter** (jemný nudge, ne blokující) – zvyšuje kvalitu matchmakingu.
- **Anti-pattern guard:** žádný povinný účet pro čtení agendy/mapy (read-only zůstává veřejné v PWA). Účet je nutný až pro stavové akce (osobní agenda, networking, check-in QR).

---

### 5. Správa profilu, viditelnost a networking opt-in

**Funkce:** Editace profilu + granulární řízení, kdo mě vidí.
**Hodnota:** Účastník má kontrolu (GDPR čl. 25), pořadatel splní privacy-by-default, matchmaking pracuje jen s vyplněnými profily (řeší "ghost town" anti-pattern).
**Priorita:** MUST (profil + opt-in toggle) · **Odhad:** M.

| Pole | Typ | Použití |
|---|---|---|
| `display_name`, `company`, `job_role` | text | Karta v seznamu účastníků |
| `bio` | text (limit ~280) | Detail profilu |
| `interests` | tag[] (řízený číselník + free) | Filtry, matchmaking |
| `seeking` / `offering` | text/tag | Core "řízený networking" intent |
| `links` | linkedin/web/ig/yt | B2B kontakt |
| `photo` | upload → Supabase Storage | Validace typu/velikosti, EXIF strip, resize |

**Viditelnost (stavový flag, ne implicitní):**

| `visibility` | Kdo vidí | Default |
|---|---|---|
| `hidden` | jen já + organizátor | ✔ dokud opt-in |
| `attendees` | přihlášení účastníci s ticketem | po opt-in |
| `public` | i bez loginu (sdílení) | volitelné |

- `networking_opt_in=false` → profil se **nikdy** nezobrazí v seznamu/matchmakingu, i kdyby byl vyplněný. Vynuceno RLS, ne jen UI.
- Odvolání opt-inu = okamžité skrytí + log do `consents` (`granted=false`). Zprávy/schůzky historie řeší networking doména.

---

### 6. Role uživatelů

**Funkce:** Více rolí na účet, řídí oprávnění a UI.
**Priorita:** MUST (attendee/organizer/staff) · SHOULD (speaker/partner) · **Odhad:** M.

| Role | Jak se přiřadí | Speciální schopnosti |
|---|---|---|
| `attendee` | automaticky při přiřazení ticketu | Osobní agenda, networking, QR vstupenka |
| `speaker` | organizátor napáruje `speaker.slug` ↔ account | Speaker portál (upload bio/foto/slidů), označení "řečník" v profilu, Q&A moderace své session |
| `partner` | organizátor (dle partnerského balíčku) | Lead retrieval (skenování), partner profil, případně více staff seatů |
| `organizer` | seed / ruční | Admin: import objednávek, přiřazení rolí, GDPR výmaz/export, broadcast push |
| `staff`/`host` | pozvánka od organizátora | Check-in skener, omezené admin čtení; host = bez ticketu, přístup ke kuratovanému obsahu |

- Role v `roles` tabulce (M:N), zápis jen service role. UI se větví dle nejvyšší relevantní role.
- **Speaker je vždy i attendee** (může networkovat). **Partner seat ≠ profil partnera** – firemní karta partnera je samostatná entita (řeší partner doména), zde jen role na osobní účet.

---

### 7. Pozvánky pro doprovod / firemní tým

**Funkce:** Držitel objednávky s `quantity > 1` rozešle nepřiřazené tickety kolegům/doprovodu.
**Hodnota:** Firma koupí 5 lístků jednou platbou a self-service je rozdělí; pořadatel nemusí ručně přepisovat jména.
**Priorita:** SHOULD · **Závislosti:** `tickets` + `invitations`, transakční e-mail. · **Odhad:** M.

**Tok:**
```
Kupující (org. holder) → "Spravovat vstupenky" → vidí N ticketů (1 přiřazen jemu, N-1 unassigned)
  → zadá e-mail kolegy → invitations(token, expires_at 14 dní) → pozvánka e-mailem
  → kolega klikne → magic-link → ticket.attendee_email = jeho e-mail, status=assigned
  → vznikne/napáruje účet + onboarding
```
- **Reassignment:** dokud `status != checked_in`, může holder ticket odebrat a přiřadit jinému (změna účastníka). Po check-inu zamčeno (anti-fraud).
- **Hromadný import:** admin/holder nahraje CSV jméno+e-mail → bulk invitations (COULD, S).

---

### 8. Jazyk (lokalizace)

**Funkce:** CS výchozí, EN volitelně.
**Priorita:** SHOULD (EN) · **Odhad:** S–M.
- `accounts.locale` řídí UI i jazyk transakčních e-mailů. Detekce: custom field z objednávky → `Accept-Language` → default `cs`.
- i18n přes JSON slovníky (sdílet styl s `content.json`). Profilová pole zůstávají tak, jak je uživatel napíše (nepřekládat).

---

### 9. GDPR souhlasy a práva (shrnutí pro tuto doménu)

| Účel | Právní titul | Kdy se sbírá |
|---|---|---|
| Účet, doručení vstupenky | 6(1)(b) | implicitně koupí + TOS v kroku 2 |
| Networking profil sdílený ostatním | **6(1)(a) souhlas** | explicitní opt-in, krok 2/4 |
| Marketing (příští ročník) | 6(1)(a) / zák. 480/2004 | nezaškrtnutý toggle, krok 2 |
| Foto z akce | 6(1)(f) + info předem | toggle/oznámení, krok 2 |

- **Admin funkce (MUST):** "Smazat účastníka" (čl. 17) + "Export dat účastníka" (čl. 15/20, JSON). Mažou se profil/zprávy ~30–90 dní po akci; transakční doklady drží účetní retence (10 let) – mazat anonymizací PII, ne řádku dokladu.
- **DPA:** SimpleShop/Redbit, Supabase (volit EU region!), SMTP provider – uzavřít zpracovatelské smlouvy, ověřit EU data residency.

---

### 10. Edge-cases

| Případ | Řešení |
|---|---|
| **Vstupenka koupena pro někoho jiného** (dárek/asistentka kupuje šéfovi) | Ticket #1 default přiřazen kupujícímu, ale onboarding nabídne "Tato vstupenka je pro někoho jiného → přiřaď e-mail". Vznikne `invitation`. Kupující ≠ účastník je první-class scénář, ne výjimka. |
| **Hromadné firemní vstupenky** (`quantity > 1`) | Viz §7. Holder dostane "manažer vstupenek" UI; nepřiřazené tickety jsou `unassigned` a neblokují kapacitu jmenovitě, jen početně. |
| **Změna účastníka** | Reassign do `checked_in`. Po check-inu jen přes organizátora (audit log). |
| **Účastník koupil 2× (duplicitní e-mail / 2 objednávky)** | Účet je per e-mail unikátní; více ticketů se napojí na jeden účet. Při check-inu se použije konkrétní `qr_token`. |
| **Jiný e-mail při loginu než na objednávce** | Verifikace kódem objednávky → převod/merge ticketu na zvolený účet. |
| **Refund / storno v SimpleShopu** | Webhook/stav → `ticket.status=void`, účet zůstává, networking se feature-gate uzavře (ztráta ticketu = ztráta přístupu k networkingu). |
| **Změna e-mailu objednávky po prodeji** | Admin edit objednávky → re-pair přes `simpleshop_order_code` (stabilní klíč, ne e-mail). |
| **Social login e-mailem, který neodpovídá žádné objednávce** | Účet vznikne jako "host bez ticketu"; networking zamčen do napárování ticketu/kódu. |
| **Žádný e-mail nedorazil** (spam, překlep) | On-site aktivace kódem objednávky na recepci + ruční resend z adminu. |
| **Více účastníků sdílí jeden e-mail** (firemní inbox) | Nepodporováno cleanly → doporučit unikátní e-maily; fallback: holder přiřadí přes jméno + on-site kód, identita = `qr_token` ticketu. |
| **Řečník/partner je zároveň účastník** | Více rolí na jeden účet (§6); profil zobrazuje badge dle role. |
| **Odvolání networking souhlasu uprostřed akce** | Okamžité skrytí profilu (RLS), `consents` log; existující schůzky řeší networking doména (notifikace protistraně). |

---

### Doporučený rollout této domény

1. **MVP (MUST):** SimpleShop webhook + cron fallback → tickety/účty, magic-link login, onboarding 4 kroky, právní souhlasy + log, základní profil, role attendee/organizer/staff, admin výmaz/export.
2. **V2 (SHOULD):** networking opt-in + viditelnost + intent profil, LinkedIn login/import, firemní pozvánky, speaker/partner role, EN lokalizace.
3. **V3 (COULD):** heslový login, bulk CSV pozvánky, public profily, profile completeness gamifikace.

**Klíčové riziko/zásada:** `simpleshop_order_code` je stabilní párovací klíč (ne e-mail), všechny webhooky idempotentní (UPSERT), networking výhradně přes vynucený opt-in na úrovni RLS — tím se eliminuje jak duplicitní zpracování plateb, tak nechtěné sdílení osobních údajů.


---

## Personalizovaná agenda a kalendář

Tato doména pokrývá vše, co účastník dělá s *programem*: výběr sessions, řešení kolizí mezi paralelními stagy, rezervace míst na workshopech, osobní timeline, export do kalendáře, připomenutí a sledování řečníků. Je to nejvýznamnější "appová" funkce před akcí i během ní a zároveň první kandidát na inkrementální nasazení — read-only jádro (procházení a filtrování programu) zvládne stávající statický web hned, stavové funkce (zaklikání, kapacity, push) přidá Supabase vrstva. Klíčová zásada: **`content.json` zůstává single source of truth pro obsah programu**, app k němu jen přidává *stav uživatele* a *runtime atributy* (kapacita, změny).

### 1. Rozšíření datového modelu

Stávající model je `program.days[] -> stages[] -> events[]{time,title,type,meta,span}`. Pro personalizaci je nutné, aby každá session měla **stabilní `id`**, **strojově čitelný čas** a **vazbu na řečníky a tagy**. Dnešní `time` je zřejmě display string (např. "10:00 – 10:45") a `events` nejsou globálně identifikovatelné — to je první věc k nápravě.

#### 1.1 Rozšířený `event` (session)

```jsonc
{
  "id": "d1-byzon-0900-otevreni",        // stabilní, unikátní napříč celým programem (slug-like)
  "title": "Slavnostní zahájení",
  "type": "shared",                       // shared|talk|workshop|discussion|break|meal|networking|gala
  "start": "2026-09-18T09:00:00+02:00",   // ISO 8601 vč. TZ (Europe/Prague, CEST = +02:00)
  "end":   "2026-09-18T09:45:00+02:00",
  "timeDisplay": "9:00 – 9:45",           // zachová stávající render, generuje build.py z start/end
  "stageId": "byzon-stage",               // FK na stage (viz níže)
  "speakerSlugs": ["jan-novak", "eva-mala"], // vazba na řečníky (pole, kvůli panelům)
  "tags": ["leadership", "kultura", "case-study"], // témata pro filtr a doporučení
  "track": "leadership",                  // volitelná vyšší kategorie (barevné odlišení)
  "capacity": null,                       // null = neomezeno (hlavní sál); číslo = workshop/limit
  "registration": "open",                 // open|waitlist|full|closed|not-required
  "level": "intro",                       // intro|advanced|all — pro doporučení
  "lang": "cs",                           // cs|en — filtr jazyka
  "meta": "Hlavní sál",                   // ponecháno (zpětná kompatibilita)
  "span": 2,                              // ponecháno (layout grid)
  "bookable": true,                       // lze přidat do Mojí agendy? (break/meal typicky false)
  "description": "Krátký abstrakt pro detail session a doporučení.",
  "materialsUrl": null                    // odkaz na slidy/handout (post-event)
}
```

Pravidla:
- **`id`** generuje build.py deterministicky (`d{den}-{stage}-{HHMM}-{slug(title)}`), aby přežilo re-buildy a bookmarky v localStorage/DB zůstaly platné. Změna `id` = ztráta uloženého výběru, proto se nikdy nemění zpětně.
- **`start`/`end`** jsou nový kanonický zdroj času; `timeDisplay` se z nich odvozuje. Tím získáme detekci kolizí, ICS a "začíná za 10 min" zdarma.
- **`capacity`** je pouze deklarativní limit; *aktuální obsazenost* je runtime stav v Supabase (`reservations`), ne v `content.json`.

#### 1.2 Rozšířená `stage`

```jsonc
{
  "id": "byzon-stage",
  "name": "BYZON Stage",
  "room": "Congress Hall",       // navázání na mapu Clarionu
  "color": "#f5218e",            // barevné odlišení v timeline a filtru
  "capacityHint": 400            // orientační, pro UI; tvrdý limit je per-event
}
```

#### 1.3 Vazba na řečníky

Řečníci už mají `slug` — používáme ho jako FK. Žádná duplikace dat: session drží jen `speakerSlugs[]`, jméno/foto/role se dotahuje z `speakers[]` při renderu. Naopak na detailu řečníka lze odvodit jeho sessions filtrem `events.speakerSlugs.includes(slug)` — vznikne sekce "Kde uvidíte tohoto řečníka".

#### 1.4 Stavové tabulky v Supabase (mimo `content.json`)

| Tabulka | Klíčové sloupce | Účel |
|---|---|---|
| `agenda_items` | `user_id`, `session_id`, `created_at` | "Moje agenda" — bookmarknuté sessions |
| `reservations` | `user_id`, `session_id`, `status (confirmed/waitlist)`, `position`, `created_at` | Rezervace míst na workshopech + pořadí waitlistu |
| `session_capacity` (view/materializovaný count) | `session_id`, `confirmed_count`, `waitlist_count` | Realtime obsazenost pro UI |
| `speaker_follows` | `user_id`, `speaker_slug` | Sledování oblíbených řečníků |
| `notification_prefs` | `user_id`, `channel (push/email)`, `lead_minutes`, opt-iny | Nastavení připomenutí |
| `session_overrides` | `session_id`, `field`, `new_value`, `changed_at`, `note` | Runtime změny programu (přesun, zrušení) bez re-buildu webu |

**Před launchem účtů:** "Moje agenda" a "oblíbení řečníci" mohou žít čistě v `localStorage` (anonymně, bez backendu) — funkční MUST varianta pro statický web. Po zavedení magic-link účtů se localStorage jednorázově zmigruje do Supabase (merge dle `session_id`), takže účastník o výběr nepřijde.

### 2. Funkce domény

#### 2.1 Moje agenda (bookmark sessions)
**Co:** U každé session tlačítko "Přidat do mé agendy" (hvězdička/srdce). Výběr se ukládá a tvoří personalizovaný pohled.
**Proč:** Účastník si naplánuje den napříč stagy; pořadatel získá data o očekávané návštěvnosti (kapacitní plánování sálů). Řečník vidí zájem.
**Priorita:** MUST. **Závislosti:** `event.id`, localStorage (fáze 1) → Supabase `agenda_items` (fáze 2). **Složitost:** S (localStorage) / M (sync s účty).

#### 2.2 Detekce kolizí paralelních stagů
**Co:** Při přidání session do agendy se porovná interval `[start,end)` s ostatními položkami. Překryv → nenásilné upozornění: *"Tato přednáška se kryje s 'X' na Leadership Stage (10:00–10:45). Přidat přesto?"* Kolize se vizuálně značí i v timeline (červený okraj, ikona).
**Proč:** Více stagů = paralelní program; bez detekce si účastník naplánuje nemožné. Snižuje frustraci, zvyšuje důvěru v app.
**Priorita:** MUST. **Závislosti:** strojový čas (`start`/`end`), 2.1. **Složitost:** S (interval overlap je triviální: `a.start < b.end && b.start < a.end`).
**Detail:** kolize nezakazujeme (účastník může chtít chodit napůl), jen varujeme. Breaky/meals (`bookable:false`) se do kolizí nepočítají.

#### 2.3 Kapacity workshopů, rezervace a waitlist
**Co:** Session s `capacity != null` má místo "přidat do agendy" tlačítko **"Rezervovat místo"**. Po naplnění (`confirmed_count >= capacity`) přepne na **"Přidat se na waitlist"** s pozicí (*"jste 4. v pořadí"*). Uvolní-li se místo (zrušení rezervace), první z waitlistu se automaticky povýší na `confirmed` a dostane push/e-mail. Účastník vidí stavový badge: `Volno (12 míst)` / `Téměř plno (3)` / `Plno – waitlist`.
**Proč:** Workshopy mají fyzický limit místnosti; bez rezervací vzniká chaos u dveří a přeplnění. Pořadatel získá přesné počty pro catering/room setup. Hodnota i pro řečníka workshopu (ví, kolik lidí přijde).
**Priorita:** SHOULD (vyžaduje backend; bez něj nelze garantovat konzistenci). **Závislosti:** Supabase `reservations` + `session_capacity`, atomické navýšení (transakce / Postgres `SELECT ... FOR UPDATE` nebo RPC s `check capacity`), Realtime pro živý počet, identita účastníka (účet). **Složitost:** L.
**Anti-race-condition:** rezervaci řešit jedinou Postgres funkcí (RPC), která v transakci ověří kapacitu a vloží řádek — ne dvěma klientskými dotazy. Idempotence dle `(user_id, session_id)` unikátního klíče.

| Stav rezervace | UI badge | Akce účastníka |
|---|---|---|
| `confirmed_count < capacity` | Volno (N míst) | Rezervovat |
| `capacity - confirmed_count <= 3` | Téměř plno (N) | Rezervovat (urgentně) |
| `confirmed_count >= capacity` | Plno | Na waitlist |
| účastník `confirmed` | Máte rezervováno ✓ | Zrušit |
| účastník `waitlist` | Waitlist – pozice K | Opustit waitlist |

#### 2.4 Pohled "Můj den / Moje agenda" (timeline)
**Co:** Dva režimy: (a) **plný program** jako grid (stage × čas, dnešní layout), (b) **Moje agenda** = chronologická vertikální timeline jen z vybraných položek, s mezerami (volné bloky), barevně dle stage, s indikací místnosti. Přepínač Den 1 / Den 2. Na mobilu default timeline (vertikální), na desktopu grid.
**Proč:** Účastník chce "kam teď jdu"; timeline je čitelnější než grid. Během akce je to hlavní obrazovka event-day appky (viz doména event-day).
**Priorita:** MUST. **Závislosti:** 2.1, strojový čas. **Složitost:** M.

#### 2.5 Export do kalendáře (ICS + Add-to-Calendar)
**Co:** Tři úrovně exportu:
1. **ICS per session** — "Přidat do kalendáře" u každé session (jeden `VEVENT`).
2. **ICS celé Mojí agendy** — jeden soubor `byzon-moje-agenda.ics` se všemi vybranými `VEVENT`y.
3. **Add-to-Calendar tlačítka** — přímé odkazy Google / Outlook (web render URL) + stažení `.ics` pro Apple.

**Proč:** Účastník má program ve svém kalendáři i mimo app; připomenutí pak řeší jeho vlastní kalendář (fallback k push). Quick win s vysokou vnímanou hodnotou.
**Priorita:** SHOULD. **Závislosti:** `start`/`end` + `TZID=Europe/Prague`. ICS per session a celý program lze generovat **už v build.py** (bez backendu); "celá *Moje* agenda" buď klientsky z localStorage (data URI `.ics`), nebo z backendu. **Složitost:** S (statické ICS) / M (dynamická osobní agenda).

Implementační detaily ICS:
```ics
BEGIN:VEVENT
UID:d1-byzon-0900-otevreni@byzon.cz      // stabilní UID = re-import přepíše, neduplikuje
DTSTAMP:20260626T120000Z
DTSTART;TZID=Europe/Prague:20260918T090000
DTEND;TZID=Europe/Prague:20260918T094500
SUMMARY:Slavnostní zahájení – BYZON 2026
LOCATION:Congress Hall, Clarion Congress Hotel, České Budějovice
DESCRIPTION:Řečník: Jan Novák\nViac: https://byzon.cz/program/
URL:https://byzon.cz/program/
END:VEVENT
```
- `UID` = `session_id@byzon.cz` (stabilní) → re-export po změně programu aktualizuje událost místo duplikace.
- Pro re-import po přesunu session zvyšovat `SEQUENCE`.
- Google odkaz: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=20260918T070000Z/20260918T074500Z&details=...&location=...` (časy v UTC).
- Apple/Outlook desktop = stažení `.ics`; "Outlook web" má vlastní `outlook.live.com/calendar/0/deeplink/compose?...`.

#### 2.6 Připomenutí před sessions (push / e-mail)
**Co:** Pro položky v Mojí agendě připomenutí *"Workshop X začíná za 10 minut, místnost Salonek B"*. Účastník si volí lead-time (5/10/15 min) a kanál (push primárně, e-mail fallback). Plánuje se serverově (Supabase Edge Function + cron / `pg_cron`), vyhodnocuje proti `start` a `session_overrides`.
**Proč:** Snižuje zmeškání sessions a zpoždění mezi stagy; aktivně řídí pohyb publika (pořadatelský benefit). Klíčový retenční prvek appky (viz anti-pattern "app na jedno otevření").
**Priorita:** SHOULD. **Závislosti:** PWA + Web Push (VAPID), opt-in souhlas (GDPR), Supabase scheduler, `notification_prefs`, identita. **Složitost:** M.
**Pozn.:** iOS Web Push jen u PWA přidané na plochu (Safari 16.4+) → e-mail fallback je nutný, ne volitelný. Pro účastníky, kteří app neinstalují, plní roli připomenutí ICS v jejich kalendáři (viz 2.5).

#### 2.7 Oblíbení řečníci a sledování
**Co:** Na detailu/kartě řečníka tlačítko "Sledovat". Sledovaní řečníci: (a) jejich sessions se v programu zvýrazní, (b) lze jedním klikem přidat všechny jejich sessions do agendy, (c) notifikace "Tvůj sledovaný řečník Jan Novák začíná za 10 min" / "změna sálu".
**Proč:** Lidé chodí na akci kvůli konkrétním jménům; sledování zjednoduší plánování a zvýší relevanci notifikací. Řečník/pořadatel získá metriku zájmu o jednotlivá jména (podklad pro dramaturgii příštího ročníku).
**Priorita:** SHOULD. **Závislosti:** `speakerSlugs` ve `event`, `speaker_follows`, localStorage (anonymně) → Supabase. **Složitost:** S.

#### 2.8 Doporučení sessions dle zájmů
**Co:** Při onboardingu účastník zvolí 2–4 témata (`tags`/`track`) a/nebo level. App pak v programu označí "Doporučeno pro tebe" a nabídne sekci "Mohlo by tě zajímat" (sessions s překryvem tagů, nesoucí se s vybranými, mimo už zařazené). Žádné ML — pravidlové skóre: `shoda tagů × 2 + shoda tracku + (sledovaný řečník ? +3)`, vyloučit kolize s pevně danými body.
**Proč:** Snižuje paralýzu z bohatého programu (více stagů, 14 řečníků), zvyšuje vnímanou personalizaci. Pomáhá naplnit méně viditelné sessions/stage (pořadatelský benefit).
**Priorita:** COULD. **Závislosti:** `tags`/`track`/`level` v datech, onboarding profil zájmů (lze i anonymně v localStorage). **Složitost:** M.

#### 2.9 Real-time změny programu a notifikace o přesunech
**Co:** Pořadatel v admin rozhraní (nebo úpravou `session_overrides`) změní čas/sál/zrušení session. Klienti dostanou přes Supabase Realtime živou aktualizaci programu i timeline; účastníci, kteří mají dotčenou session v agendě, dostanou push/e-mail *"Pozor: 'X' se přesouvá na 14:30, sál Leadership Stage"*. V programu se změněná session označí badgem "Změna" / "Zrušeno".
**Proč:** Změny programu jsou na vícestageové akci nevyhnutelné; bez kanálu pro jejich doručení vzniká chaos a IT podpora na místě. Toto je zásadní pořadatelský nástroj během akce.
**Priorita:** SHOULD. **Závislosti:** Supabase Realtime + `session_overrides`, push z 2.6, admin zápis. **Důležité:** změny řešit jako **override vrstvu nad `content.json`**, ne přepisem statického buildu — web se za běhu akce nepřebuilduje. App skládá zobrazený program jako `content.json` ⊕ `session_overrides`. **Složitost:** M–L.

#### 2.10 Filtrování a hledání v programu
**Co:** Filtry: **stage**, **typ** (talk/workshop/discussion/networking…), **téma/tag**, **track**, **řečník**, **jazyk**, **den**, a rychlé přepínače "Jen moje agenda" / "Jen volné workshopy" / "Doporučené". Plus fulltext (title, řečník, tag). Filtry kombinovatelné, stav v URL query (sdílitelný odkaz, deep-link).
**Proč:** Bohatý vícestageový program je bez filtrů nepřehledný; rychlé nalezení "workshopů o prodeji" nebo "všeho s Janem Novákem" výrazně zlepší UX. Funguje i read-only na statickém webu (klientský filtr nad `content.json`).
**Priorita:** MUST (základní filtr stage/typ/řečník) + SHOULD (tagy, fulltext, uložené filtry v URL). **Závislosti:** `tags`, `track`, `speakerSlugs`, `lang` v datech. **Složitost:** S (statický klientský filtr) / M (s fulltextem a URL stavem).

### 3. Vztah ke statické architektuře a fázování

| Funkce | Stav dat | Statický web (fáze 1) | App + Supabase (fáze 2) |
|---|---|---|---|
| Filtrování/hledání programu (2.10) | read-only | ✅ klientský filtr nad `content.json` | beze změny |
| ICS per session / celý program (2.5) | read-only | ✅ generuje build.py | + osobní ICS z agendy |
| Moje agenda (2.1), kolize (2.2) | uživatelský stav | ✅ localStorage (anonymně) | sync přes účet |
| Oblíbení řečníci (2.7) | uživatelský stav | ✅ localStorage | sync přes účet |
| Doporučení (2.8) | uživatelský stav | ✅ localStorage profil | + cross-device |
| Timeline "Můj den" (2.4) | read+stav | ✅ z localStorage | beze změny |
| Rezervace/waitlist (2.3) | sdílený stav | ❌ (nutná konzistence) | ✅ Supabase RPC |
| Push připomenutí (2.6) | server-driven | ❌ | ✅ Edge Function |
| Real-time změny (2.9) | server-driven | ⚠️ jen statická aktualizace re-buildem | ✅ Realtime + override |

**Doporučené pořadí dodávky:** (1) rozšířit `content.json` o `id`/`start`/`end`/`speakerSlugs`/`tags`/`capacity` + upravit build.py tak, aby `timeDisplay` odvozoval ze `start`/`end` a generoval statické ICS → odemkne filtry, kolize i Moji agendu *bez backendu*. (2) Přidat Supabase + magic-link → rezervace, push, cross-device sync. (3) Realtime změny + doporučení.

### 4. Dopady na build.py a `content.json` (konkrétní úkoly)

- **Migrace času:** zavést `start`/`end` (ISO+TZ) jako zdroj; `timeDisplay` derivovat v build.py (formát "9:00 – 9:45"). Validace v buildu: `end > start`, žádná session bez `id`.
- **Generování `id`:** deterministický slug v build.py + kontrola unikátnosti (build selže při kolizi `id`).
- **Validace vazeb:** každý `speakerSlug` musí existovat v `speakers[]`; build selže při dangling reference. Každý `stageId` musí existovat v `stages[]`.
- **Statické ICS:** build.py vygeneruje `/program/byzon-2026.ics` (celý program) a volitelně `/program/<session_id>.ics` per session do statického výstupu na FTP.
- **Zpětná kompatibilita:** ponechat `meta`/`span`, aby stávající grid render fungoval beze změny; nové atributy jsou aditivní.
- **Capacity v datech vs. runtime:** do `content.json` jen `capacity` (deklarace) a `bookable`; *obsazenost* nikdy do statiky — je to runtime stav v Supabase.

Relevantní soubory pro navázání implementace: `/home/user/byzon-2026/build.py`, `/home/user/byzon-2026/data/content.json`.


---

## Doména: Networking a domlouvání schůzek

Tato doména je jádrem pozicování BYZON ("řízený networking", "Lidskost jako konkurenční výhoda"). Na rozdíl od agendy nebo profilů řečníků jde o **silně stavovou doménu** (účty, zápis, realtime) — patří do app vrstvy (`app.byzon.cz` + Supabase), nikoli do statického buildu. Klíčový designový princip pro 2denní fyzickou akci ve stovkách lidí: **aplikace jen iniciuje a domlouvá; samotné setkání se odehrává offline.** Vše níže optimalizuje cestu "objev kontakt → požádej → domluv slot a místo → potkej se naživo → vyměň kontakt".

### 0. Architektonické předpoklady a datový model

Networking nelze postavit nad `content.json` (read-only statika). Vyžaduje:

| Tabulka (Supabase/Postgres) | Klíčová pole | Poznámka |
|---|---|---|
| `attendee` | id, order_code (SimpleShop), name, company, role_title, photo_url, bio, **visible** (bool, default false), consent_networking_at | `visible` = privacy-by-default, GDPR čl. 25 |
| `attendee_intent` | attendee_id, type (`offer`/`seek`), text, tags[] | "hledám / nabízím" jako strukturovaná data |
| `tag` / `industry` | id, label, kind (obor/zájem/téma) | řízený číselník pro filtry a matchmaking |
| `connection` | from_id, to_id, status (`pending`/`accepted`/`declined`/`blocked`), created_at | žádost o spojení |
| `meeting` | id, organizer_id, guest_id, slot_id, table_id, status (`proposed`/`confirmed`/`declined`/`cancelled`), note | 1:1 schůzka |
| `meeting_slot` | id, day, start, end, block_type (`break`/`networking`/`lunch`) | sloty odvozené z programu (přestávky/networking bloky) |
| `meeting_point` / `table` | id, label ("Stolek 7"), zone, capacity | fyzická místa setkání |
| `message` | conversation_id, sender_id, body, created_at, read_at | 1:1 chat |
| `meetup` | id, title, topic_tag, host_id, slot_id, table_id, capacity, status | skupinové roundtably |
| `meetup_rsvp` | meetup_id, attendee_id, status | účast na meetupu |
| `report` | reporter_id, target_id, reason, context, status | nahlašování / moderace |
| `qr_scan` | scanner_id, scanned_id, created_at | výměna kontaktu přes QR |

Identita se zakládá párováním se SimpleShop objednávkou (e-mail + `order_code`, magic-link — viz doména registrace). Sloty (`meeting_slot`) se **generují ze stejných dat jako program** (`program.days[].stages[].events[]` typu `break`/`networking`/`meal`) — single source of truth zůstává obsah akce.

---

### 1. Adresář účastníků (Attendee Directory)

**Co dělá:** prohledávatelný seznam účastníků, kteří aktivovali networking (`visible=true`). Karta = foto, jméno, firma, pozice, tagy oboru/zájmů, "hledám/nabízím". Detail s tlačítky "Spojit se", "Navrhnout schůzku", "Zpráva".

**Filtry a vyhledávání:**

| Filtr | Zdroj dat | UX |
|---|---|---|
| Fulltext (jméno, firma) | `attendee` | debounced search, server-side `ilike` / `pg_trgm` |
| Obor / odvětví | `tag.kind='obor'` | multi-select chips |
| Zájmy / témata | `tag.kind='zájem'` | multi-select chips |
| "Hledám" / "Nabízím" | `attendee_intent.type` | toggle + fulltext v intentu |
| Typ vstupenky / role (speaker, partner, VIP) | `attendee.segment` | badge filtr — partneři chtějí vidět VIP |
| Pouze s volnými sloty | join na `meeting_slot` | "kdo je teď k dispozici" |

**Hodnota:** účastník (cílené hledání místo náhody), pořadatel (naplňuje "řízený networking", měřitelný engagement), partner (sám si najde leady). **Priorita: MUST. Závislosti: účty + `attendee` + tagy číselník. Odhad: M.**

> Anti-pattern (z rešerše): prázdný adresář = "ghost town". Vynutit minimální profil (foto/firma/aspoň 1 tag) při onboardingu, jinak se účet nezobrazí jako "kompletní" a tlačí ho to dovyplnit.

---

### 2. Matchmaking a doporučení kontaktů

Plnohodnotný "AI matchmaking" (Grip, 16 algoritmů) je pro jednorázovou akci overkill. Doporučuji **pravidlový (rule-based) scoring v Postgresu** jako MVP, s volitelným embeddings re-rankingem ve V3.

**Skórovací model (MVP, rule-based):**

| Signál | Logika | Váha (příklad) |
|---|---|---|
| Komplementarita intentu | můj `seek` tag ∩ jeho `offer` tag (a naopak) | +5 / shoda |
| Shoda oboru | stejný/příbuzný obor | +2 |
| Shoda zájmů/témat | průnik `zájem` tagů | +1 / tag |
| Segment | partner ↔ rozhodovatel, speaker ↔ fanoušek tématu | +3 |
| Reciprocita aktivity | oba mají `visible=true` a vyplněný intent | gate (jinak nedoporučit) |
| Penalizace | už propojeni / už zamítnuto / nablokováno | vyřadit |

**Co dělá:** sekce "Doporučení pro tebe" (top 5–10) + **vždy zobrazit důvod** ("Hledáš investora · on nabízí seed kapitál", "Společný zájem: AI ve výrobě"). Vysvětlitelnost je klíčová — zvyšuje konverzi žádostí a důvěru.

**V3 rozšíření:** embeddings (`pgvector`) nad volným textem bio + intentu, cosine similarity jako jemný re-ranking nad rule-based skóre. Generování ledoborců ("o čem začít konverzaci") přes LLM — opt-in, levné, jeden batch před akcí.

**Hodnota:** účastník (méně paralýzy z výběru, relevantní kontakty), pořadatel (diferenciátor, naplnění networking slotů), partner (kvalifikované leady). **Priorita: SHOULD (rule-based). Závislosti: vyplněné intent profily, číselník tagů. Odhad: M (rule-based) / L (embeddings V3).**

> Anti-pattern: matchmaking bez vyplněných profilů nedoporučí nic. Proto je intent profil součástí onboardingu a doporučení se počítají až nad "kompletními" profily.

---

### 3. Žádost o spojení (Connection Request)

**Co dělá:** "Spojit se" → vytvoří `connection` (status `pending`) + push/notifikaci druhé straně + volitelnou úvodní zprávu (max 300 znaků). Přijetí → `accepted`, odemkne plný chat a sdílení kontaktu. Zamítnutí → tiché `declined` (bez notifikace odmítnutému, aby se předešlo trapnosti).

**Stavový automat:**

```
(none) --žádost--> pending --přijmout--> accepted
                      |--zamítnout--> declined
accepted/pending --blokovat--> blocked (skryje obě strany navzájem)
```

**Anti-spam limity (viz též sekce 9):**
- max **N otevřených `pending` žádostí** současně (např. 15) — nutí kvalitu před kvantitou,
- rate-limit (např. max 30 žádostí/den),
- nelze opakovat žádost po `declined` dříve než za 24 h,
- `blocked` je oboustranně absolutní.

**Hodnota:** strukturovaný, ne-obtěžující první kontakt; partner získá kvalifikovaný zájem. **Priorita: MUST. Závislosti: účty, push. Odhad: M.**

---

### 4. 1:1 chat / zprávy

**Co dělá:** textový chat mezi `accepted` spojeními (realtime přes Supabase Realtime). Read receipts, typing indikátor je COULD. **Záměrně minimalistický** — cílem je domluvit offline setkání, ne chatovat hodiny.

**Designová rozhodnutí:**
- Chat **jen mezi `accepted`** kontakty (žádost o spojení je gate proti spamu).
- Před schůzkou: tlačítko "Navrhnout schůzku" přímo v chatu.
- Žádné skupinové DM v MVP (jen meetupy mají vlastní vlákno) — méně moderace.
- Šifrování at-rest (GDPR), retence zpráv ~30–90 dní po akci, pak smazat.

**Hodnota:** doladění detailů setkání ("jsem u stolku 7", "přijdu o 5 min později"). **Priorita: SHOULD. Závislosti: Realtime, connections, moderace. Odhad: M.**

> Pozn.: pokud realtime kód nestihne tým dodat, fallback = asynchronní zprávy bez "live" (polling), stále použitelné. Plnohodnotný chat je SHOULD, ne MUST — offline akce snese i "domluv termín, zbytek doříešte naživo".

---

### 5. Domlouvání 1:1 schůzek (Meeting Booking) — jádro domény

Toto je nejhodnotnější a nejnáročnější funkce. Inspirace Brella (3 modely: free / managed / hosted).

**Co dělá:** návrh konkrétního **slotu** (z přestávek a networking bloků programu) + **místa** (meeting point / stolek) → druhá strana potvrdí/odmítne/navrhne jiný → potvrzená schůzka se zobrazí v "Moje schůzky" a lze ji exportovat do kalendáře (ICS / Google).

**Tok:**

```
Návrh: vyber kontakt → app nabídne VOLNÉ společné sloty
        (kolizní kontrola obou kalendářů) → vyber slot + meeting point
   --> meeting(proposed) + push druhé straně
Druhá strana: Potvrdit --> confirmed (oběma blok v kalendáři, rezervace stolku)
              Odmítnout --> declined
              Navrhnout jiný --> nový proposed (counter-offer)
Před schůzkou: push "Schůzka s X za 10 min · Stolek 7"
Po schůzce: "Proběhlo?" → volitelně výměna kontaktu / poznámka
```

**Klíčové mechanismy:**

| Mechanismus | Detail implementace |
|---|---|
| **Sloty z programu** | `meeting_slot` generované z events typu `break`/`networking`/`meal`. Nikdy se neplánuje přes přednášku — chrání to program. |
| **Kolizní kontrola** | při návrhu slotu se filtrují sloty, kde má kdokoli z dvojice už `confirmed` schůzku, meetup nebo (volitelně) workshop z osobní agendy. |
| **Rezervace místa** | `confirmed` schůzka zabere `table` na daný slot (kapacita stolků = počet paralelních schůzek). Při vyčerpání kapacity slot zmizí z nabídky. |
| **Atomicita** | potvrzení = transakce (slot+stolek se rezervují společně), ochrana proti double-bookingu při souběhu. |
| **Detekce zrušení + náhrada** | `cancelled` uvolní slot+stolek a pošle oběma push; pořadatel vidí "uvolněné sloty" pro re-matching. |
| **Limit schůzek** | max X potvrzených schůzek/účastník/den (např. 6), ať se to dá fyzicky stihnout. |

**"Moje schůzky":** chronologický seznam na den, stav, místo, tlačítko navigace ke stolku (mapa Clarionu), export do kalendáře. Offline cache (PWA) — funguje i bez signálu v sále.

**Hodnota:** účastník (měřitelné ROI, plný diář), pořadatel (naplněné networking bloky = důkaz pozicování), partner (garantované schůzky v balíčku). **Priorita: SHOULD (core diferenciátor). Závislosti: sloty z programu, meeting points číselník, kolizní logika, push, ICS. Odhad: L–XL.**

> Implementační poznámka: pokud tým nestihne vlastní řešení, je to **kandidát na embed třetí strany** (Brella/Swapcard) stejným vzorem jako SimpleShop — ale za cenu ztráty brandu a dat. Doporučuji vlastní MVP "free model" (účastníci si plánují sami) a managed prvky (sekce 8) řešit poloručně přes admin.

---

### 6. Meeting points / stolky a mapa

**Co dělá:** číselník fyzických míst setkání v Clarionu (`table`: "Stolek 1–20", zóna foyer/lounge/partner zone) s kapacitou. Schůzka vždy dostane konkrétní stolek → eliminuje "kde se sejdeme?" chaos.

- Mapa Clarionu se zvýrazněným stolkem (reuse mapy z PWA agendy — viz doména event-day app).
- Partner zóny: vyhrazené stolky u stánků partnerů (hodnota balíčku).
- Tisk čísel na stolky fyzicky (offline kotva — i bez appky se lidé najdou).

**Hodnota:** odstraňuje největší tření offline networkingu (logistika setkání). **Priorita: SHOULD. Závislosti: mapa, `table` číselník. Odhad: S–M.**

---

### 7. Skupinové meetupy a roundtably (téma-based)

**Co dělá:** pořadatel nebo (schválený) účastník/řečník založí **tematický meetup** ("Roundtable: AI ve výrobě", "Snídaně CEO", "Ženy v leadershipu") s tématem, slotem, stolkem/zónou a kapacitou. Ostatní dělají RSVP. Meetup má vlastní krátké vlákno a check-in.

| Vlastnost | Detail |
|---|---|
| Zakládání | pořadatel vždy; účastník/řečník přes schválení (anti-spam) |
| Kapacita | `meetup.capacity`, po naplnění waitlist |
| Vazba na program | meetupy běží v networking blocích — nekolidují s přednáškami |
| Moderace | host meetupu + pořadatel mohou odebrat účastníka / zrušit |
| Discovery | v adresáři filtr "Meetupy", doporučení dle tagů (reuse matchmaking) |

**Hodnota:** efektivní many-to-many networking (1 host : N účastníků), využití témat z `discussion` eventů v programu, nízká bariéra vstupu pro introverty (přijdu k tématu, ne k cizímu člověku). **Priorita: SHOULD. Závislosti: sloty, meeting points, RSVP, moderace. Odhad: M.**

---

### 8. Facilitated networking formáty pro organizátora

Toto je **konkurenční výhoda BYZON** — pořadatel networking aktivně řídí, nenechává náhodě. App k tomu dodává data a nástroje.

| Formát | Co to je | Co musí app umět | Priorita |
|---|---|---|---|
| **Managed 1:1 (matchmade meetings)** | Pořadatel/algoritmus předem napáruje VIP ↔ partner, vytvoří `proposed` schůzky, účastník jen potvrdí | Admin "vytvoř schůzku za uživatele", bulk match dle skóre | SHOULD · M |
| **Hosted buyer / VIP program** | Vybraní "kupující" mají garantovaný počet schůzek s partnery | Segment `VIP`, kvóta schůzek, prioritní sloty | COULD · M |
| **Speed networking** | Řízené kolo: timer, rotace, "další partner za 4 min" | Kola, párování per kolo, push/timer na velkou obrazovku | COULD · L |
| **Roundtables (řízené)** | Pořadatel kuruje témata a hosty (sekce 7) | Meetup admin, přiřazení hostů | SHOULD · M |
| **Icebreaker / "Find someone who…"** | Onboarding hra, scan 3 lidí → odměna | QR scan log + jednoduchý gamifikační počet | COULD · S |
| **"Networking objectives" dashboard** | Pořadatel vidí, kolik schůzek se domluvilo, kolik slotů volných, kde re-matchovat | Admin analytika: schůzky/segment/čas, volné sloty | SHOULD · M |
| **Gala "Výjimečný Jihočech" facilitace** | Předání cen jako networking moment (kdo s kým za stolem) | Volitelné — seating/skupiny | COULD · S |

**Hodnota:** pořadatel doručí slíbený "řízený networking" měřitelně; partner dostane garantované schůzky (prodejní argument balíčků); účastník se nemusí o nic starat (managed). **Priorita: SHOULD (managed 1:1 + objectives dashboard jako MVP facilitace). Závislosti: admin UI, matchmaking skóre, meeting booking. Odhad: M–L.**

---

### 9. Moderace, nahlašování a anti-spam

Sociální vrstva = nutná governance (GDPR + reputace akce).

| Funkce | Co dělá | Priorita |
|---|---|---|
| **Nahlásit profil/zprávu** | tlačítko "Nahlásit" (důvod: spam, obtěžování, nevhodný obsah) → `report` → admin fronta | MUST · S |
| **Blokovat uživatele** | oboustranně skryje profily i zprávy, zruší žádosti | MUST · S |
| **Admin moderační fronta** | pořadatel vidí reporty, může skrýt profil / zamknout účet / smazat obsah | SHOULD · M |
| **Rate-limity** | žádosti o spojení (30/den), zprávy (burst limit), zakládání meetupů (schválení) | MUST · S |
| **Limit otevřených pending** | max 15 nevyřízených žádostí — kvalita > kvantita | SHOULD · S |
| **Profanity/spam filtr** | jednoduchý blocklist na zprávy a intent texty | COULD · S |
| **Audit log** | kdo koho nahlásil/blokoval (důkazní pro GDPR/incidenty) | SHOULD · S |

**GDPR vazba:** networking profil = **opt-in souhlas** (granulární, odvolatelný, prokazatelný — `consent_networking_at`). Odvolání souhlasu → `visible=false` + smazání profilu z adresáře. Zprávy/schůzky šifrovat at-rest, retence 30–90 dní. Admin musí umět "smazat účastníka" (právo na výmaz, čl. 17) i export jeho dat (čl. 15–20).

**Hodnota:** ochrana účastníků a značky, právní soulad. **Priorita: MUST (report+block+rate-limit), SHOULD (admin fronta). Odhad: S–M.**

---

### 10. Networking přes QR — výměna kontaktu naživo

**Co dělá:** každý účastník má v app **osobní QR** (profil token). Sken cizího QR (kamera v PWA, `BarcodeDetector`/`html5-qrcode`) → okamžitě otevře jeho profil a nabídne **"Vyměnit kontakt"** (vytvoří `accepted` connection bez schvalování — fyzická přítomnost = souhlas) + uloží do "Moje kontakty".

| Vlastnost | Detail |
|---|---|
| Osobní QR | obsahuje opaque token, ne osobní data (GDPR — sken jen odemkne profil v DB) |
| Offline tolerance | sken uloží token, kontakt se spáruje při obnovení signálu (`qr_scan` queue) |
| Náhrada papírové vizitky | po akci export "Moje kontakty" do vCard/CSV — hmatatelná hodnota |
| Partner lead retrieval | tatáž mechanika: partner skenuje účastníky → leady do exportu (viz doména partneři/lead retrieval) |
| Fyzický fallback | QR vytištěný na jmenovce/badge → sken funguje i bez otevřené appky protistrany |

**Hodnota:** přemosťuje offline↔digital (klíčové — lidé jsou fyzicky na místě), nahrazuje vizitky, dává partnerům leady. **Priorita: SHOULD. Závislosti: účty, QR token, kamera/scanner, offline queue. Odhad: M.**

> Pozn.: QR na jmenovce sjednocuje tři use-casy jedním tokenem — check-in (event-day app), výměna kontaktu (tato doména), lead retrieval (partneři). Doporučuji společný `attendee.token`.

---

### 11. Offline realita — průřezové principy

Akce je fyzická, hotelová WiFi nespolehlivá, lidé jsou v sále/foyer. Proto:

- **PWA + offline cache:** adresář (alespoň naposledy načtený), "Moje schůzky" a "Moje kontakty" musí jít otevřít bez signálu (service worker, IndexedDB).
- **QR scany a akce ve frontě:** zápisy (sken, RSVP) se bufferují a sync-nou později (background sync).
- **Fyzické kotvy:** čísla stolků vytištěná, QR na jmenovkách, program na tabuli — appka je nadstavba, ne jediná cesta.
- **Push s předstihem:** "schůzka za 10 min · Stolek 7" počítá s tím, že člověk se musí přesunout.
- **Minimum kroků k akci:** z notifikace/QR rovnou na profil/schůzku, ne přes hlubokou navigaci (anti-pattern "moc kliků k tomu dobrému").
- **Desktop/web fallback:** vše dostupné i v mobilním webu bez instalace (ne native-only).

---

### Doporučený rollout domény (priorita)

1. **MVP (MUST):** adresář s filtry, intent profil ("hledám/nabízím"), žádost o spojení, block/report + rate-limity. *(M–L)*
2. **V2 (SHOULD):** meeting booking (sloty z programu, meeting points, kolizní kontrola, ICS), rule-based matchmaking s vysvětlením, QR výměna kontaktu, meetupy, managed 1:1 + objectives dashboard, async/realtime chat. *(L–XL)*
3. **V3 (COULD):** embeddings re-ranking + LLM ledoborce, speed networking, hosted-buyer/VIP program, gamifikace icebreakerů. *(M–L)*

**Klíčové riziko a mitigace:** "ghost town" — bez vyplněných profilů a slotů networking nefunguje. Mitigace: (a) intent profil povinný v onboardingu, (b) **managed schůzky** od pořadatele naplní sloty od začátku, (c) QR výměna funguje i bez předvyplněného matchmakingu, (d) promovat networking 2 měsíce předem (link už v potvrzení vstupenky ze SimpleShopu).


---

## Doména LIVE ENGAGEMENT (během akce)

Tato doména pokrývá vše, co se na BYZON 2026 děje v reálném čase mezi pódiem, plátnem, moderátorem a telefony v rukou účastníků. Je to nejviditelnější "stavová" část aplikace (zápis, realtime, moderace) a zároveň nejnáchylnější na chaos a zneužití — proto klade největší důraz na **moderaci**, **presenter view** a **anti-abuse**.

Architektonicky vše sedí na vzoru z technické rešerše: **Supabase** (Postgres + Realtime + RLS + Edge Functions) jako backend, **PWA** jako klientský frontend pro účastníka, **presenter view** jako oddělená route pro velkoplošné zobrazení. Identita účastníka přichází z domény registrace/check-in (magic-link + kód objednávky). Q&A a ankety lze v krajním případě nahradit **Slido embedem** (fallback, viz níže).

### 0. Společné principy domény

- **Realtime jako základ:** Q&A, ankety, reakce, oznámení = `INSERT`/`UPDATE` do Postgresu, klienti dostávají změny přes Supabase Realtime (logical replication + broadcast). Žádný polling.
- **Session-scoped stav:** každý interaktivní prvek je vázán na konkrétní `event` (session z modelu `program.days[].stages[].events[]`). Aktivní session se odvozuje z času + ručního override moderátora ("teď běží X").
- **Tři role, tři pohledy:** účastník (PWA, telefon), moderátor (moderation console, tablet/notebook za pódiem), plátno (presenter view, read-only, fullscreen, žádné ovládací prvky). Každý pohled je samostatná autorizační vrstva.
- **Privacy-by-default & GDPR:** anonymní příspěvky default, podpis jen na opt-in; všechna engagement data mají retenci (smazat ~30–90 dní po akci, agregáty lze archivovat). Soulad se souhlasovým modelem z domény registrace.
- **Degradace, ne pád:** při výpadku hotelové WiFi musí PWA zobrazit aspoň poslední cachovanou agendu a "co běží teď"; interaktivní zápis se zařadí do fronty a odešle po obnovení spojení (optimistic UI + retry).

### 1. Q&A na sessions

**Co dělá:** Účastník u běžící session pokládá dotazy z telefonu, ostatní je upvotují, moderátor je třídí a posílá na plátno / na monitor řečníka. Nejžádanější dotazy bublají nahoru.

| Prvek | Chování | Priorita |
|---|---|---|
| Pokládání dotazu | Textové pole vázané na aktivní session, limit ~280 znaků, rate-limit (1 dotaz / 20 s / uživatel) | MUST |
| Upvote | 1 hlas/uživatel/dotaz, toggle, řazení dle počtu hlasů; nelze hlasovat pro vlastní | MUST |
| Anonymní vs. podepsané | Default anonymní; přepínač "položit jménem" (vezme jméno z profilu). Anonymita je vůči ostatním účastníkům, **ne vůči moderátorovi** (ten vidí autora kvůli abuse) | MUST |
| Moderace | Stavy dotazu: `pending` → `approved` / `rejected` / `answered` / `archived`. Default režim moderace = **pre-moderation** pro hlavní stage (dotaz se ostatním zobrazí až po schválení), **post-moderation** pro menší/workshop stage (zobrazí se hned, moderátor stahuje) | MUST |
| Zobrazení na plátně | Moderátor "pinne" dotaz → objeví se ve presenter view velkým písmem; "mark as answered" ho odbarví/odsune | MUST |
| Pohled řečníka | Volitelně samostatná read-only route na řečníkův telefon/tablet: schválené dotazy seřazené dle hlasů, bez moderačních tlačítek | SHOULD |
| Více stagů paralelně | Q&A je per-session, takže BYZON Stage a Leadership Stage běží nezávisle; každý stage má svého moderátora / moderační frontu | MUST |
| Sloučení duplicit | Moderátor označí 2 podobné dotazy → sloučí (hlasy se sečtou) | COULD |

- **Proč:** Účastník se zapojí i beze slova nahlas (nízká bariéra → víc dotazů, lepší sessions). Řečník dostane relevantní, předtříděné dotazy. Pořadatel získá data, co publikum opravdu zajímá (vstup pro příští ročník).
- **Závislosti:** identita účastníka (check-in), aktivní session, Supabase Realtime, presenter view, moderation console.
- **Odhad:** **L** (vlastní), **S** (Slido embed jako fallback — ztrácíte ale brand, jednotná data a gamifikační napojení).

**Datový náčrt (Postgres):**
```
qa_questions(id, session_id, author_id, body, is_anonymous,
             status, upvotes_count, pinned_at, answered_at, created_at)
qa_votes(question_id, voter_id, created_at)  -- PK (question_id, voter_id)
```
RLS: čtení `approved`/`answered` všem přihlášeným; `pending` jen autor + moderátoři; zápis votu jen vlastní řádek; změna `status` jen role `moderator`.

### 2. Živé ankety a hlasování

**Co dělá:** Moderátor/řečník spustí připravenou (nebo ad-hoc) anketu, plátno ukáže QR/výzvu "hlasuj v aplikaci", účastníci hlasují z telefonu, výsledky se plní živě na plátně.

| Typ ankety | Použití na BYZON | Vizualizace na plátně |
|---|---|---|
| Single choice | "Co je dnes vaše největší výzva v leadershipu?" | Horizontální bar, % + počty |
| Multiple choice | "Které nástroje AI používáte?" (vyber max 3) | Bar s limitem výběru |
| Škála / rating (1–5, Likert) | "Souhlasím s tezí řečníka" | Průměr + distribuce |
| Open text → **word cloud** | "Jedním slovem: lidskost ve firmě je…" | Word cloud, velikost dle frekvence (po normalizaci/lowercase, stop-list na sprostá slova) |
| Kvíz (správná odpověď, čas, body) | Energizer mezi bloky, soutěž o ceny | Leaderboard po otázce + celkově |

- **Stavový model ankety:** `draft` → `active` (přijímá hlasy) → `closed` (zobrazí finální výsledek) → `revealed` (u kvízu ukáže správnou odpověď). Ovládá moderátor. **Výsledky se na plátno pouští řízeně** — moderátor rozhodne, kdy "reveal", aby hlasování neovlivnil průběžný stav (anti-bandwagon).
- **Proč:** Aktivace publika, vizuální "wow" moment na plátně, okamžitá zpětná vazba pro řečníka, data pro pořadatele. Kvíz + leaderboard napojí na gamifikaci (body).
- **Závislosti:** presenter view, moderation console, Realtime (agregace server-side, viz pozn. o výkonu), gamifikace (kvízové body).
- **Priorita:** single/multi/škála **SHOULD**, word cloud **SHOULD**, kvíz s leaderboardem **COULD**.
- **Odhad:** single/multi/škála **M**, word cloud **M**, kvíz **L**.
- **Výkon u stovek hlasujících:** neposílat každý hlas všem klientům. Hlas = `INSERT`; presenter view čte **agregát** (materializovaný počet, aktualizovaný triggerem nebo periodicky á 1–2 s). Tím se vyhnete realtime bouři u burst hlasování.

**Datový náčrt:**
```
polls(id, session_id, type, question, options jsonb, status,
      correct_option, opened_at, closed_at)
poll_votes(poll_id, voter_id, choice jsonb, answer_ms, created_at) -- PK (poll_id, voter_id)
poll_results_agg(poll_id, option_key, votes_count) -- materializovaný agregát pro plátno
```

### 3. Sentiment / reakce ("live reactions")

**Co dělá:** Lehká, neverbální zpětná vazba během vystoupení — floating emoji reakce (👏 ❤️ 🔥 🤔), které "probublají" na plátně, případně agregovaný sentiment meter.

- **Proč:** Vytváří atmosféru a pocit živého sálu i u méně asertivního publika; řečník vidí energii v reálném čase. Pro pořadatele indikátor "tahounů" programu.
- **Pozor na výkon:** reakce neposílat 1:1 (stovky lidí × klepání = tisíce eventů). Agregovat do **bucketů á 1–2 s** ("za poslední 2 s přišlo 47×👏") a na plátno posílat jen souhrn/animaci. Realtime broadcast, ne DB insert na každý tap.
- **Priorita:** **COULD.** Je to "cherry on top", ne core. Nasadit jen pokud zbude kapacita a presenter view je hotové.
- **Závislosti:** presenter view, Realtime broadcast.
- **Odhad:** **M.**

### 4. Hodnocení a feedback sessions / řečníků + NPS akce

**Co dělá:** Po skončení session (trigger: čas konce + push) účastník ohodnotí session a řečníka. Na konci dne/akce krátký NPS dotazník.

| Prvek | Detail | Priorita |
|---|---|---|
| Rating session | Hvězdy 1–5, volitelný komentář; jen pro účastníky, kteří byli check-in / měli session v "mé agendě" (filtr proti hodnocení "od stolu") | SHOULD |
| Rating řečníka | Agregováno k profilu řečníka (interní, **nezveřejňovat veřejně** — chrání řečníky před výkyvy) | SHOULD |
| Komentáře | Moderovatelné, viditelné jen pořadateli (ne ostatním účastníkům) | SHOULD |
| **NPS akce** | "Doporučil/a byste BYZON kolegovi? 0–10" + 1 otevřená otázka, na konci dne 2 a po akci e-mailem | SHOULD |
| Anti-spam | 1 hodnocení / session / uživatel, editovatelné do uzávěrky (konec dne) | MUST (pokud feedback existuje) |
| Trigger | Push "Jak se ti líbila session X?" cca 5 min po konci; nenásilné, max 1 připomenutí | SHOULD |

- **Proč:** Pořadatel dostane tvrdá data pro výběr řečníků příští rok a pro reporting partnerům ("průměrné hodnocení 4,6/5"). Řečník dostane konkrétní zpětnou vazbu. NPS = headline metrika úspěchu akce.
- **Závislosti:** model sessions a řečníků (už existuje v content.json), check-in pro filtr oprávněných, Web Push pro trigger, admin export.
- **Odhad:** **M** (rating sessions/řečníků), **S** (NPS dotazník).

### 5. Gamifikace (body, žebříček, odznaky, tombola)

**Co dělá:** Účastník sbírá body za žádoucí chování; žebříček a odznaky motivují, závěrečná tombola losuje ceny mezi aktivními (nebo mezi všemi check-in účastníky — viz fairness níže).

| Akce | Body (návrh) | Anti-abuse |
|---|---|---|
| Check-in na akci | 50 | 1× per den, vázáno na QR z check-inu |
| Vyplnění profilu (foto+bio+zájmy) | 30 | jednorázově, ověřit kompletnost |
| Položení dotazu v Q&A | 10 (jen po schválení moderátorem) | cap 3× bodované / session → nelze farmit spamem |
| Hlasování v anketě | 5 | 1× per anketa |
| Networking — schůzka potvrzena oběma | 25 | obě strany check-in, ne self-match |
| Návštěva sessions (check-in do sálu) | 15 / session | cap na realný počet paralelních slotů |
| Navštívení stánku partnera (scan) | 20 | 1× per partner |

- **Žebříček (leaderboard):** Top 20 + "moje pozice". **Veřejná viditelnost jen na opt-in** (přezdívka/jméno) — jinak GDPR a privacy problém; kdo nechce, je v žebříčku anonymně/skryt. Reset denně i celkově.
- **Odznaky (badges):** "Ranní ptáče" (check-in první hodinu), "Networker" (5 schůzek), "Zvídavý" (3 schválené dotazy), "Kompletní profil", "Maratonec" (návštěva ≥6 sessions). Vizuálně v profilu.
- **Tombola / slosování:** Na gala / konci dne. **Důležité fairness rozhodnutí:** losovat buď (a) **vážené body** (víc bodů = víc losů, odměna za aktivitu), nebo (b) **prostá účast** (každý check-in = 1 los, férové). Doporučení: **hybrid** — vstup do tomboly za splnění min. prahu (např. check-in + vyplněný profil), pak rovná šance. Tím se vyhnete tomu, že vyhrávají jen "profíci na appky". Losování musí být **transparentní a auditovatelné** (seed, čas, seznam oprávněných zobrazený na plátně).
- **Proč:** Zvyšuje adopci aplikace a žádoucí chování (networking, vyplněné profily → lepší matchmaking, dotazy → živější sessions). Pro partnery: motivace navštívit stánky. Pozor — gamifikace je prostředek, ne cíl; nesmí přebít obsah.
- **Závislosti:** identita/check-in, Q&A, ankety, networking, partner-scan; centrální `points_ledger` (append-only) jako single source.
- **Priorita:** body + žebříček + tombola **COULD** (silný "nice-to-have", ale netriviální a snadno zneužitelný — nasadit jen když je zbytek stabilní), odznaky **COULD**.
- **Odhad:** **L** (celý systém), **M** (jen body + tombola bez odznaků/žebříčku).

**Datový náčrt:**
```
points_ledger(id, user_id, action_type, points, ref_id, created_at) -- append-only, audit
badges(user_id, badge_key, awarded_at)
raffle_entries(user_id, eligible bool, weight, drawn bool, draw_id)
```
Body se **nikdy nemažou ani nepřepisují** — jen přičítají řádky do ledgeru; aktuální skóre = `SUM`. To umožní audit a zpětné dohledání podvodu.

### 6. Hlasování "Výjimečný Jihočech 2026"

**Co dělá:** Speciální, oddělený hlasovací modul pro cenu předávanou na gala koktejlu. Profily nominovaných (foto, jméno, medailonek), hlasování účastníků, řízený reveal vítěze na plátně.

| Aspekt | Rozhodnutí / návrh | Pozn. |
|---|---|---|
| Kdo hlasuje | Pouze check-in účastníci akce (1 hlas / osoba) | brání hromadnému online stuffingu |
| Mechanika | Single choice z nominovaných; volitelně shortlist → finálové kolo | dle pravidel ceny |
| Okno hlasování | Časově omezené (např. 1. den 14:00 – 2. den 18:00), pak `closed` | jasný cut-off |
| Anti-fraud | 1 hlas vázán na ověřenou identitu; rate/duplication check; audit log; **výsledky skryté do reveal** | viz anti-patterny |
| Reveal | Moderovaný moment na gala — presenter view odhalí pořadí/vítěze živě | dramaturgie ceny |
| Kombinace s porotou | Možnost hybridu: X % hlas publika + Y % porota → vážený výsledek | časté u "cen"; nutno definovat předem a transparentně |

- **Proč:** Unikátní brandový prvek BYZONu, vrchol gala večera, silný PR moment ("Výjimečný Jihočech vzešel z hlasování sálu"). Zapojí celé publikum do emočního vrcholu akce.
- **Závislosti:** check-in identita, presenter view, samostatná moderace (oddělit od běžného Q&A), rozšíření content.json o nominované.
- **Priorita:** **SHOULD** (je to deklarovaný gala highlight; pokud se nestihne app modul, fallback = papírové/SMS hlasování, ale app verze má vyšší hodnotu a auditovatelnost).
- **Odhad:** **M.**

### 7. Live oznámení / announcements + "co se děje teď / co bude dál"

**Co dělá:** Kanál organizátora pro broadcast zpráv do všech (nebo segmentu) účastníků — v aplikaci jako feed + volitelně Web Push; na plátně jako "now/next" ticker.

| Funkce | Detail | Priorita |
|---|---|---|
| Announcement feed | Časová osa zpráv od organizátora ("Oběd se přesouvá na 12:30", "Workshop AI přesunut do sálu B") | MUST |
| Web Push | Pro urgentní/cílené zprávy; segmentace (všichni / dle stage / dle workshopu) | SHOULD |
| "Co běží teď" (now) | Auto-odvozeno z času + ručního override moderátora; karta na home obrazovce PWA i na plátně | MUST |
| "Co bude dál" (next) | Následující sloty napříč stagy s časem do startu ("Leadership Stage začíná za 8 min") | MUST |
| Cílení | Segmenty: celá akce / konkrétní stage / účastníci s daným workshopem v agendě | SHOULD |
| Throttling | Doporučený strop 2–3 pushe/den (anti-pattern z rešerše — přehlcení = odinstalace) | MUST (pravidlo, ne kód) |
| Presenter ticker | Spodní lišta na plátně s now/next a posledním oznámením | SHOULD |

- **Proč:** Snižuje chaos vícestagové akce (lidé vědí, kam jít a kdy), řeší změny programu v reálném čase bez běhání s cedulemi, drží pozornost na aplikaci (důvod ji otevřít vícekrát denně — proti anti-patternu "appka na jedno otevření").
- **Závislosti:** model agendy (content.json → import do DB), Web Push (PWA + opt-in), moderation console pro publikování, presenter view.
- **Odhad:** feed + now/next **S–M**, Web Push segmentace **M.**

### 8. Role MODERÁTORA (moderation console)

Samostatná, autentizovaná aplikace/route (`app.byzon.cz/mod`) pro tým a moderátory stagů. **Toto je nejdůležitější součást celé domény** — bez dobrého moderačního nástroje se Q&A i ankety zvrhnou.

| Schopnost | Detail |
|---|---|
| Přepínání aktivní session | Override "teď běží X na stage Y" (zdroj pravdy pro now/next a pro to, kam míří Q&A) |
| Q&A fronta | Approve / reject / pin-to-screen / mark answered / merge / ban autora; klávesové zkratky pro rychlost |
| Ovládání anket/kvízů | Open / close / reveal; spuštění připravené ankety jedním klikem |
| Ovládání plátna | Co je právě na presenter view (Q&A pinned / poll / word cloud / oznámení / now-next) — moderátor je "režisér plátna" |
| Publikování oznámení | Vč. volby segmentu a "push i do telefonů" |
| Reveal cen | Spuštění odhalení "Výjimečný Jihočech" / tomboly |
| Audit & ban | Log akcí, blokace zneužívajícího uživatele (skryje jeho příspěvky, zablokuje zápis) |
| Multi-moderátor | Více moderátorů paralelně (každý stage svůj), bez kolizí (optimistic lock na stav session) |

- **Priorita:** **MUST** (Q&A/ankety bez konzole nenasazujte). **Odhad: L.**
- **Praktické:** moderátor potřebuje stabilní zařízení (tablet/notebook) na kabelu/dedikované WiFi, ne sdílenou hotelovou síť. Připravit i offline/degradovaný režim (alespoň reject/ban funguje lokálně).

### 9. Velkoplošné zobrazení (presenter view)

Read-only fullscreen route (`app.byzon.cz/screen/<stage>`) pouštěná na projektor/LED u každého stagu. Žádné ovládací prvky — řídí ji výhradně moderátor přes Realtime.

| Režim plátna | Obsah | Kdy |
|---|---|---|
| Q&A board | Pinnutý dotaz velkým písmem + top dotazy / QR "polož dotaz" | během diskuzí, panelů |
| Poll live | Bary/škála/word cloud, plní se živě; "reveal" finále | spuštěná anketa |
| Kvíz | Otázka → odpočet → správná odpověď → leaderboard | energizery, soutěž |
| Now / Next ticker | Co běží + co bude, čas do dalšího bloku | mezi vystoupeními, pauzy |
| Oznámení | Velké organizační hlášení | dle potřeby |
| Reveal | "Výjimečný Jihočech 2026" / tombola — dramatický odhal | gala |
| Idle / brand | Logo BYZON, partneři, hashtag, QR do aplikace | mezičas, přestávky |

- **Design:** vysoký kontrast, velký font (čitelnost z 30 m), brand barvy (#f5218e na #140610/#0f172a), Khand pro nadpisy. Žádné jemné animace závislé na výkonu; respektovat čitelnost, ne efekty.
- **Robustnost:** plátno přežije reconnect (auto-reload route, držet poslední stav v cache), aby výpadek WiFi neukázal prázdnou obrazovku před sálem. Idle/brand screen jako default fallback.
- **Per-stage:** každý stage má vlastní screen route a vlastní moderátorský kanál → BYZON Stage a Leadership Stage běží nezávisle.
- **Priorita:** **MUST** (je to výkladní skříň celé domény). **Odhad: M–L.**

### 10. Anti-patterny a obrana

| Riziko | Projev | Obrana (konkrétně) |
|---|---|---|
| **Trollové / urážky v Q&A** | Vulgarity, útoky, spam na plátno | Pre-moderation pro hlavní stage; profanity filtr (CZ wordlist) jako asistent moderátora; moderátor vždy vidí autora i u "anonymních"; ban autora skryje vše jeho |
| **Q&A jako reklama** | Pitchování vlastní firmy místo dotazu | Moderace + pravidlo "dotazy, ne pitche" v UI hintu; merge duplicit |
| **Manipulace anket / ballot stuffing** | Opakované hlasy, boti, multi-účty | 1 hlas = 1 ověřená identita (check-in/magic-link); rate-limit; server-side dedup na `(poll_id, voter_id)`; u kritických hlasování (cena) audit log + skryté výsledky |
| **Bandwagon / ovlivnění průběžným stavem** | Lidé hlasují podle vedoucí možnosti | Výsledky **skryté do moderátorova reveal**; u ceny zveřejnit až po uzavření |
| **Brigádování ceny zvenčí** | Sdílení odkazu, hlasování ne-účastníků | Hlasovat smí jen check-in účastník na místě; okno hlasování časově i identitně omezené |
| **Gamifikace = farmení bodů** | Spam dotazů/anket jen kvůli bodům | Body za Q&A jen po schválení; capy per session; append-only ledger pro audit; tombola s prahem účasti, ne čistě dle bodů |
| **Žebříček jako privacy únik** | Zveřejnění jmen bez souhlasu | Veřejný leaderboard jen opt-in; jinak skryté/anonymní |
| **Notifikační spam** | Příliš pushů → odinstalace | Strop 2–3/den, segmentace, urgentní vs. běžné odděleně |
| **Realtime bouře** | Stovky hlasů/reakcí zahltí klienty | Agregace server-side (buckety, materializované počty), broadcast souhrnů, ne event-per-tap |
| **Prázdné plátno při výpadku** | WiFi spadne, projektor ukáže error | Presenter cache posledního stavu + idle/brand fallback + auto-reconnect |
| **Mrtvé Q&A ("ghost town")** | Nikdo se neptá první | Moderátor/řečník nasadí 1–2 "seed" dotazy; QR a výzva na plátně; body za první dotazy |

### Shrnutí priorit domény

| Funkce | Priorita | Odhad |
|---|---|---|
| Q&A na sessions (s moderací) | **MUST** | L |
| Moderation console | **MUST** | L |
| Presenter view (velkoplošné) | **MUST** | M–L |
| Announcements + now/next | **MUST** | S–M |
| Live ankety (single/multi/škála) | **SHOULD** | M |
| Word cloud | **SHOULD** | M |
| Feedback sessions/řečníků + NPS | **SHOULD** | M / S |
| Web Push segmentace | **SHOULD** | M |
| Hlasování "Výjimečný Jihočech" | **SHOULD** | M |
| Live reactions / sentiment | **COULD** | M |
| Kvíz s leaderboardem | **COULD** | L |
| Gamifikace (body/žebříček/odznaky/tombola) | **COULD** | L (M bez žebříčku) |

**Doporučená sekvence nasazení:** nejdřív "režisérská osa" (presenter view + moderation console + now/next + announcements) → na ní postavit Q&A → pak ankety/word cloud → feedback/NPS a hlasování o cenu → až nakonec gamifikace a reactions jako bonus. Pro každou **MUST** funkci mít připravený **Slido embed fallback** (Q&A + ankety), aby marketingově kritická interaktivita nepadla na vlastním realtime kódu.


---

## Speaker Portal a správa podkladů od řečníků

Doména řeší celý životní cyklus spolupráce s ~14 řečníky: od přijetí pozvánky, přes self-service profil a sběr povinných podkladů s deadliny, po schvalovací workflow, brief/itinerář a post-event sdílení prezentací účastníkům. Cílem je eliminovat e-mailové honění podkladů (typický anti-pattern u malého týmu) a zároveň dát řečníkovi plnou kontrolu nad tím, co a jak se zveřejní.

Architektonicky doména navazuje na existující datový model řečníků v `content.json` (`{slug,name,photo,role,bio[],links{...}}`). **Read-only část** (publikované profily, publikované slidy) zůstává ve statickém světě — generuje ji `build.py` a slouží na `byzon.cz`. **Stavová část** (login řečníka, upload, verzování, schvalování) žije v Supabase na `app.byzon.cz`. Po schválení teče publikovaný obsah zpět do `content.json` (seed/export skript), aby marketing web zůstal single source of truth a nikdy se nerozbil.

### 1. Přehled funkcí domény

| # | Funkce | Hodnota | Priorita | Závislosti | Odhad |
|---|---|---|---|---|---|
| 1 | Pozvánka + onboarding řečníka (magic-link) | Řečník vstoupí bez hesla; tým nezakládá účty ručně | MUST | Supabase Auth, e-mail/SMTP | S |
| 2 | Self-service profil (bio, foto, role, sítě) | Aktuální data bez e-mailového ping-pongu; řečník vlastní svůj obsah | MUST | Mapování na `content.json` model, Storage (foto) | M |
| 3 | Sběr podkladů s typovými požadavky a deadliny | Tým vidí, co chybí; řečník ví, co a kdy dodat | MUST | Stavový model podkladu, Storage | M |
| 4 | Automatické připomínky deadlinů | Snižuje skluz; tým nehoní ručně | MUST | Cron/Edge Function, e-mail | S–M |
| 5 | Upload prezentací + verzování | Bezpečný příjem slidů, historie verzí, žádný "final_v3_real.pptx" chaos | MUST | Storage s verzemi | M |
| 6 | Schvalovací workflow organizátorem | Kontrola kvality/práv před publikací; auditní stopa | MUST | Stavový model, role admin | M |
| 7 | Souhlasy (záznam, GDPR, sdílení slidů) | Právní krytí publikace a záznamu; granulární a odvolatelné | MUST | Consent log (timestamp, znění, verze) | M |
| 8 | Brief / itinerář pro řečníka | Řečník ví kdy/kde/jak dlouho/koho volat; míň dotazů na produkci | SHOULD | Napojení na program (`days/stages/events`) | M |
| 9 | Sdílení prezentací účastníkům (po akci / dle nastavení) | Hodnota pro účastníka; respektuje přání řečníka | SHOULD | Účty účastníků nebo gate, viditelnostní pravidla | L |
| 10 | Handouty/materiály k session | Doplňkový obsah, lead-gen pro řečníka | SHOULD | Storage, vazba na session | S–M |
| 11 | Q&A přehled pro řečníka | Řečník vidí dotazy z publika (i nezodpovězené) | SHOULD | Q&A doména (Sli.do embed nebo Supabase Realtime) | M |
| 12 | Zpětná vazba / hodnocení řečníka | Řečník dostane rating a komentáře; podklad pro výběr příště | COULD | Post-event feedback doména | M |
| 13 | Vodoznak / omezení stahování slidů | Splní přání řečníka chránit IP | COULD | PDF watermark pipeline, view-only renderer | L |

### 2. Datový model

#### 2.1 Rozšíření modelu řečníka

Zachovává stávající strukturu, přidává portálová a stavová pole. Read-only podmnožina (níže označená *publish*) se exportuje do `content.json`.

```jsonc
{
  "slug": "jan-novak",            // publish — stabilní identifikátor, neměnit
  "name": "Jan Novák",            // publish
  "photo": "/img/speakers/...",   // publish — až po schválení fotky
  "role": "CEO, Firma s.r.o.",    // publish
  "bio": ["odstavec 1", "..."],   // publish — pole odstavců (beze změny)
  "links": {                       // publish
    "linkedin": "", "web": "", "instagram": "", "youtube": ""
  },

  // --- portálová pole (NEexportují se do content.json) ---
  "speaker_id": "uuid",
  "email": "jan@firma.cz",        // párovací klíč pro magic-link
  "invite_status": "accepted",    // invited | accepted | declined
  "profile_status": "approved",   // draft | submitted | approved | published
  "session_ids": ["s-12","s-31"], // vazba na events v programu
  "internal_note": "VIP, řeší produkci osobně Petra",
  "consents": { /* viz 2.3 */ },
  "assets": [ /* viz 2.2 */ ]
}
```

#### 2.2 Model podkladu (asset)

Jednotná entita pro všechny typy podkladů — řízená stavovým modelem a deadlinem. Typy se liší jen metadaty a tím, zda je povinný.

```jsonc
{
  "asset_id": "uuid",
  "speaker_id": "uuid",
  "session_id": "s-12",           // null = obecný podklad k osobě
  "type": "presentation",         // viz tabulka typů níže
  "required": true,
  "status": "approved",           // viz stavový model v sekci 3
  "deadline": "2026-09-05",
  "current_version": 3,
  "versions": [
    {
      "v": 3,
      "file_url": "storage://...",
      "filename": "novak_byzon_v3.pdf",
      "mime": "application/pdf",
      "size_bytes": 8412345,
      "uploaded_by": "speaker",   // speaker | organizer
      "uploaded_at": "2026-09-04T10:11:00+02:00",
      "checksum": "sha256:...",
      "note": "opravený graf na s. 12"
    }
  ],
  "review": {
    "reviewer_id": "uuid",
    "decision": "approved",       // approved | changes_requested | rejected
    "comment": "OK, jen prosím loga partnerů na poslední slide",
    "reviewed_at": "2026-09-04T14:00:00+02:00"
  },
  "publish": {                     // jen pokud type je sdílitelný účastníkům
    "share_mode": "after_event",  // never | after_event | immediately | scheduled
    "share_at": "2026-09-20T09:00:00+02:00",
    "download_allowed": false,    // přání řečníka
    "watermark": true
  }
}
```

#### 2.3 Typy podkladů (asset types)

| `type` | Povinný | Formát | Účel | Sdílitelný účastníkům |
|---|---|---|---|---|
| `bio` | MUST | text (pole odstavců) | Profil na web | Ano (publikuje se jako profil) |
| `photo` | MUST | JPG/PNG, min. 1200px, 1:1 | Profil, badge, projekce | Ano |
| `presentation` | MUST | PDF (preferováno) / PPTX | Promítání + sdílení | Volitelně dle `share_mode` |
| `abstract` | MUST | text, max ~600 zn. | Anotace session na webu/v app | Ano |
| `av_requirements` | SHOULD | strukturovaný form | AV/technika (klikr, mikroport, poměr stran, zvuk z NB, online host) | Ne (interní) |
| `tech_rider` | COULD | PDF/text | Rozšířený rider (hudba, světla, scéna) | Ne |
| `handout` | SHOULD | PDF/odkaz | Doplňkový materiál k session | Ano (dle nastavení) |
| `consent_recording` | MUST | podpis/checkbox + verze | Souhlas se záznamem a jeho užitím | Ne (právní) |
| `consent_gdpr` | MUST | checkbox + verze | Zpracování OÚ řečníka, publikace profilu | Ne (právní) |
| `headshot_hires` | COULD | TIFF/PNG hi-res | Tisk, PR | Ne |

**AV requirements** stojí za strukturovaný formulář, ne volný text — produkce z něj dělá technický scénář. Příklad polí: poměr stran (16:9 / 4:3), zdroj prezentace (náš NB / vlastní NB + adaptér), potřeba zvuku z notebooku, mikrofon (headset / handheld / klopový), klikr, potřeba konfidence monitoru, online vstup (vzdálený host přes video), demo/live ukázka, speciální font/kodek videa.

### 3. Stavový model podkladu

Jádro domény. Každý povinný asset prochází tímto cyklem; stav řídí, kdo co vidí a jaké připomínky se posílají.

```
  REQUESTED ──upload──► UPLOADED ──submit──► IN_REVIEW
     ▲                     │                    │
     │                     │                    ├─ approve ─► APPROVED ─publish─► PUBLISHED
  (vyžádáno)        (nahráno, draft)            │                                    │
     │                     ▲                    └─ request_changes ─► CHANGES_       │
     │                     │                                          REQUESTED      │
     │                     └──────── nový upload (verze++) ───────────────┘          │
     │                                                                               │
     └──────────────── unpublish / withdraw (zpět dle role) ◄────────────────────────┘

  Vedlejší stavy: WAIVED (organizátor zrušil povinnost), OVERDUE (po deadlinu, libovolný stav < APPROVED)
```

| Stav | Význam | Kdo nastaví | Co spouští |
|---|---|---|---|
| `REQUESTED` | Tým podklad vyžádal, čeká se na řečníka | systém (při onboardingu) | Připomínky dle harmonogramu |
| `UPLOADED` | Soubor nahrán, ještě nepodán ke schválení (draft) | speaker | Nic (řečník může dál upravovat) |
| `IN_REVIEW` | Řečník podal; čeká na organizátora | speaker (submit) | Notifikace adminovi |
| `CHANGES_REQUESTED` | Organizátor vrátil s komentářem | organizer | Notifikace řečníkovi, návrat k uploadu |
| `APPROVED` | Schváleno, technicky OK, právně kryto | organizer | Odemkne publikaci / promítání |
| `PUBLISHED` | Zveřejněno (web/app/účastníkům) dle `share_mode` | organizer / scheduler | Export do `content.json` / app feed |
| `WAIVED` | Povinnost zrušena (např. řečník bez slidů) | organizer | Vyřadí z checklistu i připomínek |
| `OVERDUE` | Příznak: po deadlinu a < APPROVED | systém | Eskalace (intenzivnější připomínky, alert týmu) |

**Pravidla přechodů:**
- Publikovat lze jen z `APPROVED`. `consent_recording` a `consent_gdpr` musí být `APPROVED`, jinak je publikace profilu i sdílení slidů zablokováno (hard gate).
- Každý nový upload v `CHANGES_REQUESTED` vytvoří novou verzi a vrátí asset do `UPLOADED` (řečník znovu submitne).
- `OVERDUE` je ortogonální flag, ne samostatný stav v lineární cestě — počítá se z `deadline` a aktuálního stavu.
- Audit: každý přechod loguje aktér, čas, předchozí/nový stav (potřeba pro GDPR i provozní dohled).

### 4. Workflow a obrazovky

#### 4.1 Onboarding řečníka
1. Tým založí řečníka (jméno + e-mail) nebo importuje. Stav `invited`.
2. Systém pošle pozvánku s magic-linkem ("Potvrďte účast a vyplňte profil do BYZON 2026").
3. Řečník klikne → přihlášen → vidí **dashboard** s checklistem podkladů, deadliny a stavy (semafor).
4. Přijetí/odmítnutí pozvánky (`accepted` / `declined`). Při declined → alert týmu.

#### 4.2 Profil + podklady (pohled řečníka)
- **Profil:** předvyplněný stávajícími daty (pokud řečník opakuje), editace bio/role/sítí, upload fotky s ořezem na 1:1 a kontrolou min. rozlišení. Live náhled "takto budete vypadat na webu".
- **Checklist podkladů:** karty per asset (typ, deadline, stav, akce). Barevný semafor (zelená APPROVED/PUBLISHED, žlutá IN_REVIEW/UPLOADED, červená REQUESTED/OVERDUE/CHANGES_REQUESTED).
- **Upload:** drag&drop, validace formátu/velikosti, automatická verze. U prezentace doporučit PDF (stabilní promítání).
- **Souhlasy:** samostatná sekce, granulární checkboxy s plným zněním a verzí, uloží se timestamp/IP (consent log). Odvolatelné.

#### 4.3 Pohled organizátora (admin)
- **Matice řečník × podklad:** přehledová tabulka 14 řečníků × typy podkladů, buňka = stav. Okamžitě vidí, co chybí a co je po termínu. Filtr "jen chybějící", "po deadlinu", "čeká na schválení".
- **Review fronta:** assety v `IN_REVIEW`, náhled souboru, tlačítka Schválit / Vrátit s komentářem / Zamítnout.
- **Hromadné akce:** poslat připomínku všem s nedodaným podkladem; prodloužit deadline; waive.

### 5. Brief / itinerář pro řečníka

Generuje se z dat programu (`days/stages/events` přes `session_ids`) + produkčních polí. Řečník ho vidí v portálu a dostane jako PDF/ICS.

| Sekce briefu | Obsah | Zdroj |
|---|---|---|
| Kdy a kde | Datum, čas začátku/konce, stage/sál, délka slotu | `event.time`, `event.span`, stage |
| Příchod / soundcheck | Doporučený příchod (např. −60 min), místo soundchecku | produkční pole |
| Formát | Typ session (přednáška/panel/workshop), Q&A blok ano/ne, moderátor | `event.type`, `event.meta` |
| Technika | Potvrzené AV (z `av_requirements`), poměr stran, klikr | asset `av_requirements` |
| Kontakty | Produkce on-site (jméno, telefon), backstage manažer | produkční pole |
| Logistika | Parkování, šatna/green room, catering pro řečníky, wifi | produkční pole |
| Co s sebou | Adaptér, záložní PDF na USB, dress code | šablona |
| Mapa | Sál + backstage v Clarionu | rozšířený `content.json` (rooms) |

- **"Přidat do kalendáře":** ICS s `TZID=Europe/Prague` a stabilním `UID` (lze generovat i staticky v `build.py`). **SHOULD, S.**
- Brief se aktualizuje automaticky při změně programu; řečníkovi přijde notifikace "změna v itineráři".

### 6. Sdílení prezentací účastníkům

Respektuje přání řečníka přes `publish.share_mode`. Klíčové: řečník při uploadu/souhlasu nastaví, **zda a jak** se slidy sdílejí.

| `share_mode` | Chování | Typický případ |
|---|---|---|
| `never` | Pouze promítání, nikdy ke sdílení | Citlivý/IP obsah |
| `after_event` | Zpřístupní se po skončení akce (default) | Standard |
| `immediately` | Hned po schválení (i během akce) | Workshop s handouty |
| `scheduled` | K datu `share_at` | Embargo do tiskovky |

**Kontrola přístupu (kdo a kdy vidí):**
- Sdílení gateováno přihlášením účastníka (magic-link na e-mail z objednávky — viz párovací model se SimpleShopem) NEBO veřejně po akci, dle nastavení akce.
- `download_allowed=false` → view-only renderer (PDF.js, bez tlačítka stáhnout, znesnadnění přímého odkazu na soubor přes signed URL s krátkou expirací).
- `watermark=true` → server-side přidá do PDF patičku ("BYZON 2026 — Jan Novák — nešířit") nebo dynamický watermark s e-mailem přihlášeného účastníka (silnější odrazení od přeposílání). **COULD, L** (watermark pipeline je netriviální).
- Audit přístupů (kdo/kdy otevřel) pro řečníky, kteří to vyžadují.

**Implementační poznámka:** plně veřejné slidy (`after_event` + `download_allowed`) lze publikovat staticky přes `build.py` (nejlevnější). Gateované/view-only/watermarkované vyžadují backend se signed URL — proto **SHOULD/L** pro řízené sdílení vs. **S** pro prosté veřejné.

### 7. Q&A přehled a zpětná vazba pro řečníka

- **Q&A přehled (SHOULD, M):** řečník po session vidí v portálu všechny dotazy z publika (zodpovězené i ne), seřazené dle upvotů. Hodnota: follow-up s publikem, podklad pro článek/LinkedIn. Zdroj = Q&A doména (Sli.do embed → export, nebo nativní Supabase Realtime tabulka filtrovaná na `session_id`).
- **Zpětná vazba / hodnocení (COULD, M):** po akci se účastníkům pošle micro-feedback per session (rating 1–5 + volitelný komentář). Řečník vidí agregát (průměr, počet, NPS-like) a anonymizované komentáře. Tým vidí žebříček napříč řečníky → podklad pro výběr příští ročník. Důležité: komentáře moderovat/anonymizovat před zobrazením řečníkovi.

### 8. Produkční checklist (operativa týmu)

Mapuje deadliny na konkrétní akce. Doporučené milníky relativně k akci 18.–19. 9. 2026.

| Termín | Milník | Akce týmu | Gate |
|---|---|---|---|
| T−10 týdnů | Pozvánky | Rozeslat magic-linky, potvrdit účast | `invite_status=accepted` u všech |
| T−8 týdnů | Profil | Bio, foto, role, sítě dodány | `profile_status≥submitted` |
| T−6 týdnů | Souhlasy | `consent_recording` + `consent_gdpr` podepsány | hard gate pro publikaci |
| T−5 týdnů | Abstrakt | Anotace session na web/app | `abstract=APPROVED` |
| T−3 týdny | AV requirements | Strukturovaný AV form vyplněn | `av_requirements` kompletní |
| T−1 týden | Prezentace v1 | První verze slidů (PDF) | `presentation≥IN_REVIEW` |
| T−3 dny | Finální slidy | Schválená finální verze + záloha na USB | `presentation=APPROVED` |
| T−2 dny | Brief | Rozeslat finální itinerář + ICS | brief doručen |
| Den akce | On-site | Soundcheck, kontrola promítání, záložní PDF | technicky OK |
| T+2 dny | Sdílení | Publikovat slidy dle `share_mode`, otevřít Q&A přehled | `PUBLISHED` |
| T+1 týden | Feedback | Rozeslat hodnocení, předat řečníkům agregát | report řečníkům |

**Automatizace připomínek (MUST, S–M):** plánovač posílá řečníkovi e-mail při T−X dní před deadlinem každého nedodaného povinného assetu, eskalace při `OVERDUE` (intenzivnější + alert týmu). Tón přátelský, s přímým odkazem do portálu na konkrétní chybějící podklad (anti-pattern: neposílat "seznam featur", ale jednu jasnou akci).

### 9. Závislosti a fázování

| Fáze | Obsah | Priorita | Odhad |
|---|---|---|---|
| **V1** | Onboarding (magic-link), self-service profil, checklist + upload + verzování, stavový model, schvalování, souhlasy, připomínky | MUST | M–L |
| **V2** | Brief/itinerář + ICS, sdílení slidů (after_event, gateované), handouty | SHOULD | L |
| **V3** | Q&A přehled, feedback řečníkům, watermark/view-only, audit přístupů | COULD | M–L |

**Klíčové integrace:** Supabase (Auth + Postgres + Storage pro soubory + Edge Function pro připomínky a watermark), e-mail/SMTP v EU lokaci (GDPR), export skript `app → content.json` pro publikované profily a veřejné slidy (zachová `build.py` jako single source of truth). ClickUp lze využít jako interní zrcadlo produkčního checklistu (task per řečník × milník), pokud tým chce operativu řídit tam.

**Hlavní rizika:** (1) souhlasy jako hard gate — pohlídat, ať publikace nikdy neproběhne bez `consent_*=APPROVED`; (2) verzování slidů — vždy promítat `current_version`, ne náhodný soubor; (3) watermark/view-only je nejdražší a nejméně kritická část — nasadit až je jádro hotové.


---

## Doména ADMIN / Event-Management Backoffice

Tato sekce navrhuje administrátorské zázemí pro pořadatelský tým BYZON 2026. Vychází z reality projektu: malý tým, čistě statický marketing web (`build.py` → `content.json` → FTP) a plánovaná aplikační vrstva na `app.byzon.cz` (Supabase + PWA). **Vůdčí princip: jeden backoffice nad jedním Supabase Postgresem, ne deset rozhraní.** Tým spravuje vše z jednoho admin webu; marketing web zůstává needotčený a `content.json` zůstává single source of truth pro program.

### 0. Architektonický rámec backoffice

| Vrstva | Volba | Zdůvodnění |
|---|---|---|
| Admin frontend | Samostatná SPA na `admin.byzon.cz` (React/Vite, sdílí brand tokeny s webem) | Oddělené od veřejné PWA i marketingu; vlastní auth s vyšší ochranou (2FA) |
| Backend / data | Supabase (Postgres + Auth + RLS + Storage + Edge Functions) | Stejný backend jako event-day app — jedna pravda o datech |
| Identita admina | Supabase Auth, role v tabulce `team_members`, povinné 2FA (TOTP) | Malý tým = malý okruh účtů, ale citlivá data (GDPR) |
| Audit | Append-only tabulka `audit_log` + Postgres triggery | Prokazatelnost změn, GDPR accountability |
| Integrace | Edge Functions volající ClickUp / Google Calendar / Canva / Microsoft 365 API | Tým nemusí přepínat nástroje |

**Klíčové rozhodnutí o programu (CMS vs. content.json):** Admin needituje `content.json` přímo. Program se edituje v DB tabulkách, a **publikace generuje nový `content.json` + commit do GitHubu** (přes GitHub API), což spustí `build.py` a deploy. Tím zůstává statický web zachován, ale tým má pohodlné UI a verzování zdarma (git historie). Detail v sekci 1.

```
Admin SPA  ──►  Supabase (Postgres: program_draft, speakers, attendees, ...)
                   │
                   ├─ Publish program ─► Edge Function ─► GitHub API (commit content.json) ─► build.py ─► FTP deploy
                   ├─ Realtime ────────► event-day PWA (agenda, Q&A, push)
                   └─ Edge Functions ─► ClickUp / Google Calendar / Canva / M365 / SimpleShop API
```

---

### 1. Správa programu (CMS nad days/stages/events)

**Co dělá:** Vizuální editor programu místo ručního zásahu do `content.json`. Tým edituje dny, stagy a eventy ve formulářích a drag-and-drop timetable; výsledek se publikuje na web.

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| CRUD program v DB | Tabulky `program_days`, `stages`, `events` zrcadlí dnešní model (time, title, type, meta, span) | MUST | M |
| Timetable editor | Grid stage × čas, drag-and-drop přesun eventů, kolizní kontrola (překryv slotů na stejné stage) | SHOULD | L |
| Draft vs. live | Sloupec `status` (draft/published) + `published_snapshot`; tým edituje draft, live se nemění do publikace | MUST | M |
| Publikace = build | Tlačítko "Publikovat" → Edge Function vygeneruje `content.json`, commitne přes GitHub API, spustí Actions/deploy | MUST | L |
| Náhled (preview) | Vygenerování `content.json` do preview větve / staging URL před ostrou publikací | SHOULD | M |
| Diff & rollback | Zobrazit změny oproti live verzi; rollback = revert commitu | SHOULD | M |
| Validace | Kontrola povinných polí, formátu času, návaznost `type` (shared/break/meal/discussion) | MUST | S |
| Vazba event ↔ speaker | Přiřazení řečníků k eventu (relace, ne jen text) → automaticky propojí detail session a profil | SHOULD | M |

**Hodnota:** pořadatel mění program i hodinu před akcí bez programátora a bez rizika rozbití buildu; řečník vidí svůj slot správně; účastník dostane vždy aktuální agendu.
**Závislosti:** GitHub API token (Edge Function secret), zachování schématu `content.json` 1:1; `build.py` jako konzument beze změny.

> Pozn.: `content.json` zůstává **kanonický pro marketing web**. DB je editační vrstva, která ho generuje — ne paralelní pravda. Tím se eliminuje riziko rozjetí dvou zdrojů.

---

### 2. Správa řečníků a podkladů

**Co dělá:** Evidence 12–14 řečníků, jejich profilů (model `{slug,name,photo,role,bio[],links}`) a příjem podkladů (bio, foto, slidy) s deadliny.

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| CRUD řečníků | Editace profilu shodného s `content.json` (slug, foto, role, bio[], links) | MUST | S |
| Stav podkladů | Per řečník status: bio ✓/✗, foto ✓/✗ (rozlišení/poměr), slidy ✓/✗, souhlas se záznamem | MUST | S |
| Speaker self-service portál | Magic-link pro řečníka → upload foto/slidů, úprava bio, náhled karty; bez admin účtu | SHOULD | M |
| Deadliny + připomínky | Termíny na podklady; automatické e-mail/ClickUp připomínky při prodlení | SHOULD | M |
| Schvalování | Admin schválí nahrané bio/foto → teprve pak jde do publikace | SHOULD | S |
| Úložiště slidů | Supabase Storage, verzování, propojení na session pro post-event sdílení | COULD | M |

**Hodnota:** tým nehoní řečníky e-mailem (eliminuje největší časožrout), řečník má kontrolu nad svou prezentací, účastník vidí kvalitní jednotné karty.
**Závislosti:** Supabase Storage, magic-link auth, vazba na sekci 1 (publikace) a sekci 3 (komunikace).

---

### 3. Správa účastníků (CRM lite)

**Co dělá:** Centrální seznam účastníků se stavem vstupenky, importem ze SimpleShop, segmentací a ruční editací.

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| Import ze SimpleShop | Webhook "po platbě" → Edge Function dotáhne objednávku přes API → upsert do `attendees`. Párovací klíč **e-mail + kód objednávky** | MUST | M |
| Fallback CSV import | Manuální upload exportu "Kdo koupil" (JSON/CSV) s mapováním sloupců, deduplikace | MUST | S |
| Seznam + filtry | Tabulka: jméno, firma, e-mail, typ vstupenky (Early/Standard/Late), stav platby, check-in stav, networking opt-in | MUST | M |
| Custom/dotazníková pole | Zobrazení polí z formuláře (firma, IČ, dieta, GDPR opt-in pro networking) | SHOULD | S |
| Segmentace | Uložené segmenty dle typu vstupenky, firmy, opt-inu, účasti na workshopu → cílení komunikace | SHOULD | M |
| Ruční přidání/úprava | Přidat VIP / host / partner ticket bez nákupu; editace údajů; merge duplicit | MUST | S |
| Detail účastníka | 360° pohled: objednávka, check-in historie, schůzky, Q&A aktivita, souhlasy (timestamp/znění) | SHOULD | M |
| GDPR akce | Export dat účastníka (čl. 15–20) + "smazat účastníka" (right to erasure) z jednoho místa | MUST | M |

**Hodnota:** tým má jeden přehled "kdo přijde", podklad pro check-in, jmenovky, kapacity i komunikaci; účastník má korektní data a uplatnitelná GDPR práva.
**Závislosti:** SimpleShop API + webhook (Basic auth, API klíč jako secret); párovací logika e-mail+kód; GDPR retenční pravidla.

---

### 4. Check-in na místě

**Co dělá:** Rychlý vstup přes QR sken, tisk/příprava jmenovek, sledování front a statistik, check-in na workshopy s kapacitou.

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| QR sken vstupenky | Skener app (kamera v PWA, `BarcodeDetector`/`html5-qrcode`) ověří token/objednávku proti DB, označí příchod | MUST | L |
| Více check-in stanic | Souběžně více zařízení, realtime sync (Supabase Realtime), bez dvojího započtení | MUST | M |
| Offline režim | Lokální cache seznamu + fronta zápisů; sync po obnovení WiFi (hotel = nespolehlivá síť) | SHOULD | L |
| Manuální check-in | Vyhledat dle jména/firmy, odbavit bez QR (zapomenutá vstupenka) | MUST | S |
| Jmenovky / badge | Generování badge (jméno, firma, typ, QR) → tisk on-demand nebo dávkový předtisk; návrh přes Canva brand template | SHOULD | M |
| Check-in na workshopy | Session-level check-in u 2 workshopů → hlídá kapacitu, řeší waitlist (sekce 6) | SHOULD | M |
| Fronty & průtok | Live dashboard: příchody/min, vytíženost stanic, špičky → operativní řízení personálu | COULD | M |
| Statistiky příchodů | Reálně přítomní vs. prodaní, no-show rate, časový profil příchodů den 1 / den 2 | SHOULD | S |

**Hodnota:** žádné fronty u vstupu (první dojem), tým ví v reálném čase kolik lidí dorazilo, partneři dostanou data o návštěvnosti, kapacity workshopů pod kontrolou.
**Závislosti:** identita účastníka ze sekce 3, QR token (UUID v DB generovaný po platbě), tiskárna badge / Canva template, Supabase Realtime.

---

### 5. Komunikace (hromadná i cílená)

**Co dělá:** Odesílání transakčních a kampaňových e-mailů, push notifikací a in-app oznámení; šablony, segmentové cílení, plánování.

| Kanál | Použití | Priorita | Odhad |
|---|---|---|---|
| Transakční e-mail | Potvrzení (doplňuje SimpleShop), magic-link, vstupenka/QR, "podklady prosím" řečníkům | MUST | M |
| Kampaňový e-mail | Před akcí: praktické info, agenda, "naplánuj si den"; segmentově cílené | SHOULD | M |
| Web Push | "Tvůj workshop začíná za 10 min", změna programu, výzva k networkingu (2–3/den, ne spam) | SHOULD | M |
| In-app oznámení | Banner/feed v PWA pro ty bez povoleného push | SHOULD | S |

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| Šablony | Brandované e-mail šablony (růžová #f5218e, Khand/Inter), placeholdery (jméno, firma, slot) | MUST | S |
| Cílení dle segmentu | Napojení na segmenty ze sekce 3 (typ vstupenky, workshop, opt-in) | SHOULD | M |
| Plánování | Naplánovat odeslání (cron Edge Function), připravit sekvenci (T-7, T-1, ráno D-day) | SHOULD | M |
| Souhlas & odhlášení | Respekt zák. 480/2004, unsubscribe link, log souhlasu; push jen po opt-inu (GDPR) | MUST | S |
| Náhled & test send | Test na vlastní e-mail před hromadným odesláním | MUST | S |

**Hodnota:** tým zvládne komunikaci centrálně a cíleně; účastník dostane relevantní info ve správný čas (řeší anti-pattern "app na jedno otevření"); řečník dostane připomínky.
**Závislosti:** EU SMTP provider (DPA, EU residency — viz GDPR), VAPID klíče pro push, segmenty (sekce 3), opt-in evidence.
**Doporučení:** pro e-mail využít EU službu (SmartEmailing / Postmark EU / Mailjet); push řešit nativně přes Supabase Edge Function (VAPID), neplatit za další SaaS.

---

### 6. Kapacity a waitlisty

**Co dělá:** Hlídá omezené kapacity (workshopy, gala koktejl, řízený networking) a řeší pořadníky.

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| Kapacita per session | Limit míst u workshopů a kapacitních bloků; live obsazenost | SHOULD | M |
| Přihlášení v PWA | Účastník se přihlásí na workshop; po naplnění → waitlist | SHOULD | M |
| Automatický posun waitlistu | Uvolnění místa (odhláška/no-show) → notifikace dalšímu v pořadí | COULD | M |
| Admin override | Ruční přidání/odebrání, povýšení z waitlistu, navýšení limitu | SHOULD | S |
| Vazba na check-in | Session check-in (sekce 4) potvrdí reálnou účast vs. rezervaci | SHOULD | S |

**Hodnota:** workshopy se nepřeplní ani nezůstanou poloprázdné; účastník má jistotu místa; tým plánuje sály dle reálné poptávky.
**Závislosti:** model sessions (sekce 1), účty účastníků, Realtime pro live obsazenost.

---

### 7. Partneři / sponzoři a jejich leady

**Co dělá:** Evidence partnerů, jejich balíčků a plnění, a sběr/správa leadů z akce (lead retrieval).

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| CRM partnerů | Firma, kontakt, balíček, dohodnutá plnění (logo, stage, stánek), stav fakturace | SHOULD | M |
| Plnění balíčku checklist | Co partner dodal (logo, bio, banner) + deadliny → propojení na ClickUp úkoly | SHOULD | S |
| Lead retrieval | Partner skenuje QR jmenovky účastníků (jen ti s opt-inem) → seznam leadů s poznámkou/scoringem | SHOULD | L |
| Partner portál | Magic-link přístup partnera ke svým leadům + export (CSV) po akci | SHOULD | M |
| Reporting partnerovi | Počet skenů, návštěvnost jeho session, viditelnost → podklad pro renewal | COULD | M |

**Hodnota:** hmatatelné ROI pro partnery (měřitelné leady → snazší prodej dalšího ročníku); tým má přehled o plnění; účastník sdílí kontakt jen vědomě (GDPR opt-in).
**Závislosti:** identita účastníka + QR (sekce 4), GDPR opt-in pro sdílení kontaktu partnerovi (oddělený souhlas), Supabase Storage pro materiály.

---

### 8. Moderace (Q&A, networking, obsah)

**Co dělá:** Kontrola uživatelsky generovaného obsahu během akce.

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| Q&A moderace | Fronta dotazů per session, schválit/skrýt/odpovězeno, projekce vybraných na obrazovku | SHOULD | M |
| Pre-moderace toggle | U citlivých sessions vyžadovat schválení před zobrazením (RLS flag `approved`) | SHOULD | S |
| Networking moderace | Report/block uživatele, skrytí profilu porušujícího pravidla, řešení stížností | SHOULD | M |
| Obsah profilů | Kontrola nahraných fotek/bio (vulgarismy, nevhodný obsah) před zveřejněním | COULD | S |
| Moderátorský pohled | Odlehčené rozhraní pro moderátora u stage (mobil/tablet), rychlé akce | SHOULD | M |

**Hodnota:** kvalitní a bezpečný obsah na stagi i v networkingu; chrání brand i účastníky; řečník dostane relevantní dotazy.
**Závislosti:** Q&A data model + Realtime, role "moderátor" (sekce 10), projekční view pro velkou obrazovku.
**Doporučení:** pokud realtime Q&A tým nestihne vyvinout, embednout **Slido** do PWA a moderovat v něm (oddělení rizika; vlastní moderaci dodělat ve V3).

---

### 9. Analytika a reporting

**Co dělá:** Měření celého funnelu od registrace po post-event, exporty pro tým a partnery.

| Metrika / report | Obsah | Priorita | Odhad |
|---|---|---|---|
| Registrace funnel | Prodeje v čase, mix typů (Early/Standard/Late), tržby, tempo vůči cíli | MUST | S |
| No-show rate | Prodaní vs. checknutí, per den, per typ vstupenky | SHOULD | S |
| Návštěvnost sessions | Check-iny/rezervace per session, oblíbené vs. prázdné, vytížení stagů | SHOULD | M |
| Engagement | Aktivní v PWA, počet bookmarků, Q&A dotazy, hlasování — po segmentech a čase | COULD | M |
| Networking aktivita | Počet profilů s opt-inem, žádostí o schůzku, potvrzených schůzek, no-show schůzek | SHOULD | M |
| NPS / feedback | Post-event dotazník (NPS + otevřené), per session hodnocení řečníků | SHOULD | M |
| Exporty | CSV/XLSX všech přehledů; export do Microsoft 365 (Excel) / Google Sheets | SHOULD | S |
| Dashboard přehled | Jedna úvodní obrazovka admina s KPI (prodáno, dnes přítomno, NPS, leady) | SHOULD | M |

**Hodnota:** tým řídí akci daty (kde je volno, co rezonuje), získá podklad pro sponzory i příští ročník; řečníci dostanou zpětnou vazbu.
**Závislosti:** data ze sekcí 3, 4, 6, 7, 8; feedback engine (lze i jednoduchý formulář v PWA).

---

### 10. Role, oprávnění a audit log

**Co dělá:** Řízení přístupu malého týmu a prokazatelná stopa změn (GDPR accountability).

**Návrh rolí (RBAC, vynuceno přes Supabase RLS):**

| Role | Práva | Typický člen |
|---|---|---|
| **Owner / Admin** | Vše vč. správy účtů, GDPR mazání, publikace, integrace | Pořadatel (ENJOiT) |
| **Program manager** | Program, řečníci, podklady, publikace | Produkce |
| **Comms manager** | Komunikace, šablony, segmenty (bez GDPR mazání) | Marketing |
| **Check-in / hosteska** | Pouze check-in app, čtení seznamu, bez exportů | Brigádníci na místě |
| **Moderátor** | Q&A/networking moderace u přiřazených sessions | Moderátoři stage |
| **Partner** (externí) | Magic-link, jen vlastní leady a materiály | Sponzoři |
| **Read-only / investor** | Jen dashboard a reporty | Vedení |

| Funkce | Co dělá | Priorita | Odhad |
|---|---|---|---|
| RBAC | Role v `team_members`, RLS policies dle role; least-privilege | MUST | M |
| 2FA pro admin role | Povinné TOTP pro Owner/Admin/Comms (citlivá data) | SHOULD | S |
| Audit log | Append-only `audit_log`: kdo, co, kdy, před/po (publikace, GDPR mazání, export, změna účastníka) | MUST | M |
| Pozvánky do týmu | Magic-link onboarding člena s předdefinovanou rolí | SHOULD | S |
| Session přehled | Aktivní přihlášení adminů, možnost odhlásit | COULD | S |

**Hodnota:** brigádník na check-inu nevidí finanční data; každá citlivá akce má stopu; GDPR prokazatelnost; bezpečnost při malém týmu s rotujícími brigádníky.
**Závislosti:** Supabase Auth + RLS, triggery pro audit, šifrování citlivých polí.

---

### 11. Propojení s nástroji týmu (MCP integrace v prostředí)

Tým má k dispozici ClickUp, Google Calendar, Canva, Microsoft 365 a GitHub. Backoffice je využívá přes Edge Functions / MCP, aby tým nepřepínal kontext.

| Nástroj | Integrace | Hodnota | Priorita | Odhad |
|---|---|---|---|---|
| **GitHub** | Publikace programu = commit `content.json` přes GitHub API → trigger `build.py` + deploy; verzování a rollback zdarma | Bezpečná publikace bez programátora, git historie jako audit programu | MUST | M |
| **ClickUp** | Deadliny podkladů řečníků a plnění partnerů → automatické úkoly; připomínky; checklisty balíčků | Tým řídí provoz v jednom task systému, nehlídá termíny ručně | SHOULD | M |
| **Google Calendar** | Schůzky řízeného networkingu a interní harmonogram týmu → události v kalendáři; ICS export agendy pro účastníky | Tým i účastník mají sloty v kalendáři, sync schůzek | SHOULD | M |
| **Canva** | Badge/jmenovky a sociální grafika z brand template; generování karet řečníků; export přes Canva API | Jednotná grafika bez grafika u každé jmenovky/postu | COULD | M |
| **Microsoft 365** | Export reportů do Excelu, sdílení na SharePoint/OneDrive; případně Outlook jako SMTP/kalendář | Vedení a fakturace pracují v M365, data tečou bez přepisování | COULD | M |

**Hodnota celkově:** backoffice se chová jako orchestrátor existujícího toolingu — tým nepřechází na nový svět, jen získá centrální místo, které do jeho nástrojů posílá data.
**Závislosti:** API tokeny/MCP oprávnění jako Edge Function secrets; mapování polí (řečník → ClickUp task, schůzka → Calendar event).

---

### 12. Doporučený rollout backoffice (priorita pro malý tým)

| Fáze | Obsah | Cíl |
|---|---|---|
| **B1 — MUST jádro** | Program CMS + publikace přes GitHub, správa řečníků, import účastníků ze SimpleShop, RBAC + audit log, základní reporting registrací | Tým přestane editovat `content.json` ručně a má přehled o prodeji |
| **B2 — Před akcí** | Speaker self-service portál, komunikace (transakční + kampaně), segmentace, kapacity/waitlisty, ClickUp + Calendar integrace | Příprava akce běží z jednoho místa |
| **B3 — Na místě** | Check-in app (QR, offline, stanice), jmenovky/Canva, session check-in, live dashboard příchodů | Hladký průběh dnů akce |
| **B4 — Engagement & po akci** | Q&A moderace (nebo Slido embed), partner leady + portál, networking moderace, NPS/feedback, exporty do M365 | Měřitelná hodnota pro partnery, podklad pro 2027 |

**Souhrnné zásady:**
- **Jeden backoffice, jeden Postgres** — žádná tříšť nástrojů; integrace přes Edge Functions.
- **`content.json` zůstává single source of truth** pro marketing web; admin ho generuje, nerozbíjí.
- **Least-privilege + audit + 2FA** — citlivá osobní data malého týmu pod kontrolou (GDPR).
- **Buy kde to dává smysl** (Slido pro Q&A, EU SMTP pro e-mail) — vlastní vývoj jen tam, kde je brand a data kritická.
- **Ovladatelnost > úplnost** — raději méně funkcí, které tým reálně používá, než rozsáhlý nepoužívaný systém.

Relevantní cesty pro navázání implementace: `/home/user/byzon-2026/build.py`, `/home/user/byzon-2026/data/content.json`.


---

## Brainstorm dalších funkcí pro BYZON 2026

Funkce navržené nad rámec explicitně vyjmenovaného zadání, optimalizované pro 2denní byznys/leadership konferenci ve stovkách účastníků, s pozicováním "Lidskost jako konkurenční výhoda" a "řízený networking". Každá funkce respektuje architekturní rozdělení: **read-only** domény zůstávají ve statickém světě (rozšířený `content.json`, PWA, localStorage, generování v `build.py`), **stavové** domény vyžadují lehký backend (Supabase) nebo embed třetí strany.

Legenda složitosti: **S** = hodiny/1 den, **M** = dny, **L** = 1–2 týdny, **XL** = 2+ týdny / externí závislost. Quick win = vysoká hodnota / nízká složitost, zvládnutelné čistě staticky nebo s minimem backendu.

### 1. Souhrnná tabulka (seřazeno podle poměru hodnota/náklad)

| # | Funkce | Priorita | Složitost | Quick win | Doména |
|---|---|---|---|---|---|
| 1 | Praktické info / "Než přijedeš" (doprava, parking, Wi-Fi, dress code, kontakty) | MUST | S | ✅ | read-only |
| 2 | FAQ / nápověda s vyhledáváním | MUST | S | ✅ | read-only |
| 3 | Oznámení / news feed (před i během akce) | MUST | S–M | ✅ | hybrid |
| 4 | Interaktivní mapa Clarionu / wayfinding | MUST | M | ✅ | read-only |
| 5 | ICS / "Add to Calendar" pro sessions a celý program | SHOULD | S | ✅ | read-only |
| 6 | Materiály a handouty ke stažení (per session) | SHOULD | S | ✅ | read-only |
| 7 | Digitální vstupenka do Apple/Google Wallet | SHOULD | M | | hybrid |
| 8 | Partner/sponzor profily + nabídky/slevy pro účastníky | SHOULD | S–M | ✅ | read-only |
| 9 | Lead retrieval pro partnery (skenování QR) | SHOULD | M–L | | stavový |
| 10 | Doprovodný program / after-party / mapa večera | SHOULD | S | ✅ | read-only |
| 11 | Dietní preference a sběr požadavků na catering | SHOULD | M | | stavový |
| 12 | Hodnocení sessions + NPS celé akce (feedback) | SHOULD | M | | stavový |
| 13 | Certifikát účasti (PDF na vyžádání) | COULD | S–M | ✅ | hybrid |
| 14 | Fotogalerie / social wall (moderovaná zeď fotek) | COULD | M | | stavový |
| 15 | Záznamy a sestřihy po akci (on-demand knihovna) | COULD | S | ✅ | read-only |
| 16 | Vícejazyčnost CZ/EN | COULD | M–L | | infra |
| 17 | "Výjimečný Jihočech 2026" — kandidáti, hlasování, live moment | COULD | M | | hybrid |
| 18 | Tombola / soutěž / gamifikace s leaderboardem | COULD | M | | stavový |
| 19 | "Potkali jsme se" — výměna kontaktů / LinkedIn po akci | COULD | M | | stavový |
| 20 | AI asistent / chatbot pro dotazy účastníků | COULD | M–L | | stavový |
| 21 | Job board / nabídky spolupráce | COULD | S–M | | hybrid |
| 22 | Sustainability dashboard / paperless badge | COULD | S | ✅ | read-only |
| 23 | "Find my meeting / seat" navigace na schůzku | COULD | M | | stavový |
| 24 | Live titulky / přepis pro přístupnost | COULD | L–XL | | externí |
| 25 | Speaker green room / brief pro řečníky | SHOULD | S | ✅ | read-only |

---

### 2. Detail funkcí

#### A) Praktická informační vrstva (MUST, quick winy)

**1. Praktické info / "Než přijedeš"** — strukturovaná stránka s dopravou (vlak/auto na Clarion ČB), parkováním (kapacita, cena, alternativy), ubytováním (kód pro slevu v Clarionu), Wi-Fi (SSID + heslo), dress code (business/smart casual), bezbariérovostí a krizovými kontakty (organizační hotline, recepce).
- **Hodnota:** účastník — méně stresu a dotazů; pořadatel — dramaticky méně e-mailů a telefonátů den před akcí (klasický anti-pattern "celé ráno IT/org podpory").
- **Závislosti:** nová sekce v `content.json` (`practical{}`), generování v `build.py`. Žádný backend.
- **Složitost: S.**

**2. FAQ / nápověda** — rozbalovací Q&A (accordion) s vyhledáváním v prohlížeči (klientský filtr nad statickým JSON). Kategorie: vstupenky, program, místo, networking, faktury/VOP.
- **Hodnota:** deflektuje opakované dotazy; SEO bonus pro marketing web (FAQ schema.org).
- **Závislosti:** `content.json.faq[]`, malý JS filtr. Přidat JSON-LD `FAQPage` pro Google.
- **Složitost: S.**

**3. Oznámení / news feed** — chronologický feed novinek. **Před akcí** čistě staticky (oznámení nového řečníka, otevření workshopů) generované z `content.json`. **Během akce** stavová verze: pořadatel publikuje "Sál B se přesouvá", "Oběd se posouvá o 15 min", napojeno na Web Push.
- **Hodnota:** jediný kanál pravdy při změnách; snižuje chaos mezi stagy; naplňuje doporučení "2–3 cílené pushe/den".
- **Závislosti:** read-only část staticky; live část = Supabase tabulka `announcements` + Realtime + Web Push (VAPID). Moderace = jen admin role.
- **Složitost: S** (statická) / **M** (live + push).

#### B) Orientace v místě

**4. Interaktivní mapa Clarionu / wayfinding** — půdorys hotelu s vyznačenými sály (BYZON Stage, Leadership Stage), workshopovými místnostmi, networking zónou, cateringem, registrací, toaletami, šatnou. Klik na session v agendě → zvýraznění místnosti na mapě. Mobilní "kde právě jsem / kam mám jít".
- **Hodnota:** účastník se neztratí mezi více stagy (klíčové u multi-stage formátu); pořadatel méně navádí; podklad i pro tištěný program.
- **Závislosti:** SVG/obrázkový půdorys (dodá Clarion / vlastní vektorizace), mapování `room → souřadnice` v `content.json`. Rozšířit datový model `events[]` o `room`. Plně staticky řešitelné (SVG + interaktivní vrstva v PWA).
- **Složitost: M** (S pokud stačí statický obrázek s legendou bez interakce).
- **Pozn.:** GPS-based indoor nav je overkill; stačí klikací půdorys.

#### C) Program a kalendář (read-only, quick winy)

**5. ICS / "Add to Calendar"** — generování `.ics` per session i pro celý program přímo ve `build.py`; tlačítka "Přidat do Google/Outlook/Apple". `UID` stabilní (slug session) pro re-import po změně, `TZID=Europe/Prague`.
- **Hodnota:** účastník má agendu ve vlastním kalendáři a notifikace zdarma; využije i MCP Google Calendar pro tým.
- **Závislosti:** funkce v `build.py`, `event.time` → `DTSTART/DTEND` (nutné doplnit konec události / délku do `content.json`).
- **Složitost: S.**

**6. Materiály a handouty ke stažení** — per session sekce s odkazy na slidy (PDF), doplňkové materiály, knihy/odkazy doporučené řečníkem. Před akcí prázdné, plní se průběžně.
- **Hodnota:** účastník — hodnota i po akci; řečník — distribuce bez e-mailů; pořadatel — argument "obsah žije dál".
- **Závislosti:** `event.handouts[]` v `content.json`, soubory na FTP/Storage. Provázat se speaker upload portálem (viz podklady).
- **Složitost: S.**

#### D) Vstupenka a identita

**7. Digitální vstupenka do Apple/Google Wallet** — `.pkpass` (Apple Wallet) a Google Wallet objekt s QR/jménem/typem vstupenky, brandované (růžová #f5218e, logo). Generuje se po zaplacení (z dat SimpleShop objednávky).
- **Hodnota:** účastník má vstupenku po ruce v mobilu i offline; pořadatel — rychlejší check-in, prémiový dojem; podporuje paperless.
- **Závislosti:** podpis `.pkpass` (Apple certifikát — administrativní krok), Google Wallet API; zdroj dat = SimpleShop webhook/CSV. Backend pro generování (Supabase Edge Function).
- **Složitost: M** (plus jednorázová administrativa kolem Apple certifikátu).

#### E) Partneři (hodnota pro sponzory = peníze)

**8. Partner/sponzor profily + nabídky/slevy** — rozšířené profily partnerů (logo, popis, web, kontakt) na `/stante-se-partnerem/` i v PWA, plus sekce "Nabídky pro účastníky" (slevové kódy partnerů, demo, dárky).
- **Hodnota:** partner — viditelnost a leady; účastník — hmatatelný benefit; pořadatel — silnější prodejní argument pro balíčky.
- **Závislosti:** `content.json.partners[]` rozšířit o `tier`, `offer{}`. Read-only, staticky.
- **Složitost: S–M.**

**9. Lead retrieval pro partnery** — partner ve své části PWA naskenuje QR účastníka (se souhlasem účastníka — opt-in), uloží lead + poznámku/scoring, exportuje CSV po akci.
- **Hodnota:** partner — měřitelné ROI bez vlastního HW; účastník — kontrola sdílení; pořadatel — prodejní argument a retence partnerů.
- **Závislosti:** identita účastníka (QR token z ticketingu), Supabase (`leads`), kamera/`BarcodeDetector` v PWA, GDPR opt-in (sdílení kontaktu = souhlas, čl. 6(1)(a)).
- **Složitost: M–L.**

#### F) Program večera a catering

**10. Doprovodný program / after-party** — samostatná sekce: gala koktejl s předáváním "Výjimečný Jihočech", after-party (místo, čas, dress), neformální networking, doprovodný program (degustace, doprovodná hudba). Mapa večerních míst, pokud mimo hotel.
- **Hodnota:** účastník — neformální networking je často hlavní důvod účasti; pořadatel — komunikuje plnou hodnotu vstupenky.
- **Závislosti:** `content.json` sekce `social[]`. Staticky.
- **Složitost: S.**

**11. Dietní preference / sběr požadavků na catering** — formulář (vegetarián/vegan/bezlepek/alergie) navázaný na účet/objednávku, agregace pro catering Clarionu. Lze i jako custom pole přímo v SimpleShop formuláři (dle podkladů to SimpleShop umí v dotazníkových polích → vrací se v exportu).
- **Hodnota:** účastník — najedl se; pořadatel — přesný počet pro catering, méně plýtvání (i sustainability argument).
- **Závislosti:** buď SimpleShop custom pole (žádný backend, MUST-kompatibilní), nebo Supabase formulář. Doporučuji SimpleShop pole = nulová infra.
- **Složitost: M** (S přes SimpleShop pole).

#### G) Zpětná vazba a měření

**12. Hodnocení sessions + NPS celé akce** — po každé session jednoduchý rating (1–5 / emoji) a volitelný komentář; na konci akce NPS + krátký dotazník. Výsledky agregované pro pořadatele a řečníky.
- **Hodnota:** řečník — feedback; pořadatel — data pro příští ročník, podklad pro prodej partnerům ("spokojenost X %"); účastník — pocit, že ho slyší.
- **Závislosti:** Supabase (`ratings`), vazba na `event.slug`. Lehký push "Jak se ti líbila session?". Případně embed (Slido survey) jako fallback.
- **Složitost: M.**

#### H) Po akci

**13. Certifikát účasti (PDF)** — generovaný personalizovaný certifikát ("X se zúčastnil/a BYZON 2026") ke stažení po akci, brandovaný. Trigger = check-in (reálná účast), ne jen koupě.
- **Hodnota:** účastník — doklad pro zaměstnavatele / CPD; pořadatel — prestiž, důvod k re-engagementu po akci.
- **Závislosti:** šablona PDF + jméno z účtu/objednávky; podmínka check-in (Supabase). Lze i statický generátor jména do PDF přes serverless.
- **Složitost: S–M.**

**14. Fotogalerie / social wall** — moderovaná zeď fotek z akce; účastníci nahrávají nebo se agreguje hashtag; živá projekce v sálech mezi bloky.
- **Hodnota:** účastník — sdílení zážitku; pořadatel — UGC, social proof, brand. Pozor na GDPR (souhlas u portrétů, info cedule, opt-out).
- **Závislosti:** Supabase Storage + moderace (admin approve flag), live view. Bez moderace nenasazovat (riziko spamu/nevhodného obsahu).
- **Složitost: M.**

**15. Záznamy a sestřihy (on-demand)** — po akci knihovna videí (vimeo/youtube embed) per session, případně gated pro účastníky.
- **Hodnota:** účastník — dožene minuté stagy; pořadatel — obsah pro marketing příštího ročníku, hodnota vstupenky.
- **Závislosti:** `event.recording` URL v `content.json`, embed. Read-only.
- **Složitost: S** (gating = +M).

#### I) Inkluze, jazyk, udržitelnost

**16. Vícejazyčnost CZ/EN** — EN varianta klíčových stránek a PWA (program, řečníci, praktické info). Publikum je primárně české, ale zahraniční řečníci/partneři ocení EN.
- **Hodnota:** širší dosah, profesionální dojem, podpora zahraničních hostů.
- **Závislosti:** i18n vrstva v `content.json` (klíče `cs`/`en`), `build.py` generuje `/en/`. Netriviální u 12+ speaker stránek.
- **Složitost: M–L.** (COULD — jen pokud je reálná zahraniční účast.)

**22. Sustainability / paperless** — komunikace "BYZON paperless" (digitální vstupenka, program, badge místo papíru) + jednoduchý dashboard "ušetřili jsme X papíru". Ladí s hodnotovým pozicováním akce.
- **Hodnota:** brand a hodnoty, argument pro partnery a ESG-citlivé firmy; reálná úspora nákladů na tisk.
- **Závislosti:** staticky, vázané na digitální vstupenku (#7) a digitální program. Žádný backend.
- **Složitost: S.**

#### J) Brand-unikátní a engagement

**17. "Výjimečný Jihočech 2026"** — sekce s kandidáty (profily, příběh), volitelně veřejné/účastnické hlasování před akcí, live moment předávání během gala (timing v agendě, foto vítěze, oznámení do feedu).
- **Hodnota:** unikátní brandový prvek; PR a regionální dosah; emocionální vrchol akce (ladí s "Lidskost jako konkurenční výhoda").
- **Závislosti:** read-only profily staticky; hlasování = stavové (Supabase + ochrana proti více hlasům — e-mail/účet). Bez hlasování čistě staticky.
- **Složitost: M** (S bez hlasování).

**18. Tombola / soutěž / gamifikace** — bodování za aktivity (check-in na session, navázání kontaktu, vyplnění feedbacku) s leaderboardem; tombola pro přítomné na konci (QR slosování).
- **Hodnota:** zvyšuje engagement v PWA (řeší anti-pattern "app na jedno otevření"), motivuje k networkingu a feedbacku; partneři mohou věnovat ceny.
- **Závislosti:** Supabase (`points`, `actions`), pravidla. Pozor na přílišnou gamifikaci u B2B publika (decentní provedení).
- **Složitost: M.**

**19. "Potkali jsme se" / výměna kontaktů** — po schůzce nebo skenu QR si dva účastníci (oba opt-in) vymění vizitku v appce; po akci export kontaktů + odkaz na LinkedIn propojení ("lidé, které jsi potkal/a na BYZONu").
- **Hodnota:** účastník — networking žije dál po akci (hlavní ROI konference); pořadatel — měřitelný networking jako prodejní argument.
- **Závislosti:** stavové (Supabase `connections`), opt-in souhlas; LinkedIn jen deep-link (žádné API nutné).
- **Složitost: M.**

#### K) Asistence a navigace na místě

**20. AI asistent / chatbot** — konverzační dotazy "Kdy mluví X?", "Kde je oběd?", "Jaký je program odpoledne?" nad daty z `content.json`. Lze postavit na Claude API (knowledge cutoff není problém — odpovídá nad dodaným kontextem programu).
- **Hodnota:** účastník — okamžité odpovědi, deflektuje dotazy na org tým; moderní dojem.
- **Závislosti:** Claude API (Anthropic SDK) + `content.json` jako kontext (RAG nad malým korpusem stačí prompt-stuffing, žádná vektorová DB). Backend endpoint (Edge Function) drží API klíč. Rate-limit a fallback na FAQ.
- **Složitost: M–L.**
- **Pozn.:** vzhledem k velikosti `content.json` stačí celý program vložit do system promptu; není potřeba vektorové vyhledávání.

**23. "Find my meeting / seat"** — po naplánování schůzky (řízený networking) appka ukáže meeting point na mapě a navádí ("Stůl 7, networking zóna, 1. patro"). Volitelně místa na gala dle zasedacího pořádku.
- **Hodnota:** účastník — neztratí schůzku/místo; pořadatel — hladší networking bloky.
- **Závislosti:** závisí na meeting bookingu (stavový) + mapě (#4).
- **Složitost: M.**

**24. Live titulky / přepis** — real-time přepis hlavního stage (CZ), volitelně EN překlad, pro sluchově hendikepované i hlučné prostředí.
- **Hodnota:** přístupnost a inkluze (ladí s hodnotami akce), benefit pro zahraniční hosty.
- **Závislosti:** externí STT služba (např. Whisper/cloud), zvukový feed ze stage, projekce/stream do PWA. Provozně náročné.
- **Složitost: L–XL.** (COULD — jen s rozpočtem a A/V partnerem.)

#### L) Řečníci a tým (často opomíjené)

**25. Speaker green room / brief** — privátní sekce pro řečníky: jejich slot (čas, sál, délka), technické info (klikr, mikrofon, poměr stran slidů), kontakt na produkci, check-in "jsem tu", upload slidů (vazba na speaker portál z podkladů).
- **Hodnota:** řečník — jistota a méně dotazů; pořadatel — řečníci připravení a včas, méně chaosu za scénou.
- **Závislosti:** read-only brief staticky (per-speaker stránka s tokenem), upload = stavový (vazba na speaker upload portál).
- **Složitost: S** (brief) / **M** (s uploadem).

**21. Job board / nabídky spolupráce** — partneři a účastnické firmy inzerují pozice / poptávku po spolupráci; účastník projeví zájem.
- **Hodnota:** přidaná hodnota pro B2B publikum, další benefit pro partnery; ladí s byznys zaměřením.
- **Závislosti:** read-only inzeráty staticky (`content.json.jobs[]`); "projevit zájem" = stavové (e-mail/formulář).
- **Složitost: S** (statický) / **M** (s interakcí).

---

### 3. Doporučené quick winy (nasadit nejdřív)

Tyto funkce mají nejvyšší poměr hodnota/náklad, zvládnutelné **čistě staticky** (rozšíření `content.json` + `build.py`), bez nové infrastruktury — ideální první vlna ještě před spuštěním backendu:

1. **Praktické info "Než přijedeš"** (#1) — největší deflektor dotazů, S.
2. **FAQ s vyhledáváním + FAQ schema** (#2) — deflektor + SEO, S.
3. **ICS / Add to Calendar** (#5) — vysoká vnímaná hodnota, generuje `build.py`, S.
4. **Interaktivní/statická mapa místa** (#4) — kritické pro multi-stage, M (S bez interakce).
5. **Doprovodný program / after-party** (#10) — komunikuje plnou hodnotu vstupenky, S.
6. **Partner profily + nabídky** (#8) — přímý přínos pro prodej partnerství, S–M.
7. **Speaker brief** (#25) — méně chaosu za scénou, S.
8. **Materiály ke stažení** (#6) — obsah žije po akci, S.

### 4. Vazby a poznámky k prioritizaci

- **Závislostní řetězec:** identita účastníka (SimpleShop párování) je předpokladem pro #7 wallet, #9 lead retrieval, #11 catering na účet, #12 feedback gating, #13 certifikát (check-in), #18 gamifikace, #19 kontakty, #23 find-my-meeting. Tyto čekají na backend (V2/V3 dle rolloutu z podkladů).
- **GDPR-citlivé** (vyžadují explicitní opt-in a privacy-by-default): #9 lead retrieval, #14 social wall, #17 hlasování, #19 výměna kontaktů, #20 chatbot (logy konverzací). Sdílení dat mezi účastníky vždy jako stavový opt-in flag, nikdy implicitně.
- **Kandidáti na embed/buy místo buildu** (sníží riziko a čas): #12 feedback (Slido survey), #14 social wall (hotová UGC zeď), #24 live titulky (A/V partner). Stejný vzor jako stávající SimpleShop embed.
- **Pozor na anti-pattern "app na jedno otevření":** funkce #3 (push feed), #18 (gamifikace) a #19 (kontakty) jsou hlavní páky retence v PWA — nasadit je dříve než kosmetické featury.

Relevantní cesty v repu pro navázání implementace: `/home/user/byzon-2026/data/content.json` (rozšíření datového modelu o `practical`, `faq`, `partners[].offer`, `event.room/handouts/recording`, `social`, `jobs`), `/home/user/byzon-2026/build.py` (generování FAQ schema, ICS, mapy, nových sekcí).
