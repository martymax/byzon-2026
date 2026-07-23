# Příloha: rešerše a benchmark

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md)

---

Příloha shrnuje rešeršní podklady, ze kterých návrh vychází: benchmark eventových platforem, možnosti integrace se SimpleShopem, GDPR/CZ kontext a technické vzory pro přidání dynamické aplikace ke statickému webu.

---

## Rešerše: eventové platformy a standard funkcí

Tato rešerše mapuje funkční záběr 13 předních platforem (Swapcard, Brella, Whova, Cvent, Bizzabo, Hopin/RingCentral Events, Sli.do, Eventbrite, Konfeo, GoOut, Webex Events/Socio, Grip, Pine) a destiluje, co je dnes **table-stakes** (standard, jinak působí amatérsky) vs. **diferenciátor** (zvyšuje vnímanou hodnotu). Vše je optimalizováno pro 2denní byznys/leadership konferenci se stovkami účastníků, více stagy a pozicováním na řízený networking.

### 1. Taxonomie funkcí podle domén

| Doména | Table-stakes (musí být) | Diferenciátor (nice-to-have) | Lídři |
|---|---|---|---|
| **Registrace/ticketing** | Více typů vstupenek, slevové kódy, platba, unikátní QR na vstupence, potvrzovací e-mail | Skupinová registrace (firmy), promo dle segmentu, instant payout | Eventbrite, Cvent, Konfeo (CZ), GoOut (CZ) |
| **Attendee profily** | Jméno, role, firma, foto, bio, zájmy/tagy, opt-in viditelnost | Obohacený profil (LinkedIn import), "co hledám / co nabízím" intent | Bizzabo, Whova, Swapcard |
| **Networking & matchmaking** | Seznam účastníků s filtry, 1:1 chat, žádost o spojení | AI matchmaking dle intentu/zájmů ("70M data points", 16 algoritmů – Grip), vysvětlení proč match, ledoborce | Grip, Brella, Swapcard |
| **Schůzky / meeting booking** | 1:1 schůzky se sloty a meeting pointy, kalendářní sync | Managed/hosted-buyer modely, VIP schůzky řízené pořadatelem, detekce zrušení + náhrada | Brella (3 modely), Grip |
| **Personalizovaná agenda** | Bookmark sessions, "moje agenda", detail session + speaker | Doporučení sessions dle profilu, řízení kapacity workshopů | Swapcard, Whova, Sched |
| **Q&A / ankety / live polls** | Live Q&A s upvotingem, anonymní dotazy, moderace, multiple-choice poll | Word cloud, kvízy s leaderboardem, sentiment, projekce na velkou obrazovku | Sli.do (best-in-class), Whova |
| **Speaker management & sběr podkladů** | Profily řečníků, deadline na bio/foto, příjem slidů | Speaker portál (self-service upload), připomínky, schvalování | Cvent, Bizzabo |
| **Sdílení prezentací** | Stažení/zobrazení slidů po session | Záznamy, handouty, on-demand knihovna | Whova, Pine |
| **Mobilní app / PWA** | Agenda, mapa, oznámení, profil – front-and-center; web fallback | Branded native app, AI copilot ("Bizzy") | Bizzabo, Webex Events |
| **Push notifikace** | Změny programu, "začíná za 10 min", směrování na networking | 2–3 cílené pushe/den, segmentace dle stage | Whova, Cvent |
| **Check-in / QR / badge** | QR check-in app, offline režim, real-time dashboard, tisk badge | SmartBadge (Klik – kontaktní networking, heatmapy), session-level check-in | Bizzabo (Klik), Cvent (OnArrival) |
| **Sponzoři / lead retrieval** | Skenování QR/badge účastníka, export leadů, profil partnera | Kvalifikační dotazník, scoring + poznámky, bez HW navíc | Webex Events, Cvent LeadCapture, Whova |
| **Analytika** | Počty registrací, check-inů, návštěvnost sessions | Engagement po segmentech/čase, počet schůzek, heatmapy | Swapcard, Bizzabo |
| **Post-event** | E-mail s poděkováním, feedback dotazník, kontakty z networkingu | On-demand obsah, "vaše spojení", napojení na CRM | Pine, Brella |

### 2. Konkrétní nápady vhodné pro BYZON (s prioritou a odhadem)

Vzhledem k čistě statické architektuře (build.py → content.json → HTML na FTP) je klíčový **rozdíl mezi obsahem a stavem**. Statický web zvládne vše read-only; jakmile jde o účty/zápis (schůzky, Q&A, push), je nutná lehká backend/SaaS vrstva. Doporučení respektuje pozicování "řízený networking".

- **PWA "Můj BYZON" (offline agenda + mapa)** — co dělá: bookmark sessions, multi-stage timetable, mapa Clarionu, "začíná za 10 min". Hodnota: účastník plánuje den, pořadatel snižuje chaos mezi stagy. **MUST · závislosti: rozšířit content.json (rooms, stage map) · S–M** (lze čistě staticky + localStorage).
- **Speaker upload portál** — self-service příjem bio/foto/slidů s deadliny. Hodnota: tým nehoní 14 řečníků e-mailem; řečník má kontrolu. **SHOULD · závislost: lehký formulář + úložiště (ne FTP-only) · M.**
- **Řízený networking / meeting booking** — intent profil ("hledám/nabízím"), sloty v networking blocích, meeting pointy, schvalování VIP schůzek pořadatelem (Brella model). Hodnota: naplňuje core pozicování, měřitelné ROI pro účastníky i partnery. **SHOULD · závislost: účty + backend/SaaS · L–XL** (kandidát na embed třetí strany jako u SimpleShopu).
- **Sli.do-style Q&A & live polls per session** — anonymní dotazy, upvoting, projekce. Hodnota: oživení BYZON/Leadership Stage, data pro řečníky. **SHOULD · doporučení: integrovat hotové Sli.do (embed) místo vlastního · S** (embed) / **L** (vlastní).
- **QR check-in + badge + lead retrieval pro partnery** — QR na vstupence (už generuje ticketing), skener na recepci, partner skenuje leady. Hodnota: rychlý vstup, hmatatelná hodnota pro partnery balíčků. **SHOULD · závislost: registrační identita + skener app · M–L.**
- **Gala "Výjimečný Jihočech" hlasování/program** — kandidáti, live moment předávání, foto. Hodnota: unikátní brandový prvek. **COULD · S.**

### 3. Anti-patterny (časté chyby), kterým se vyhnout

1. **App jako "digitální agenda na jedno otevření"** — bez pushe v první hodině účastník na app zapomene. Naplánovat 2–3 cílené notifikace/den a onboarding, který vede k akci (otevři agendu), ne k seznamu featur.
2. **Třecí přihlášení a žádný desktop/web fallback** — povinné účty a native-only zabíjejí adopci. Preferovat magic-link a vždy mít mobilní web variantu.
3. **Pozdní launch a "feature" místo "outcome" komunikace** — app zveřejněná večer před akcí = celé ráno IT podpory. Promovat 2 měsíce předem, link už v potvrzení vstupenky, komunikovat přínos ("Naplánuj si den"), ne obsah.
4. **Prázdný networking / "ghost town"** — matchmaking bez vyplněných intent profilů nedoporučí nic. Vynutit minimální profil při onboardingu a nasadit pořadatelem řízené (managed) schůzky, ať se sloty naplní.
5. **Over-advertising a hluboká navigace** — příliš pop-upů a "moc kliků k tomu dobrému" vede k odinstalaci. Agenda/mapa/oznámení musí být na první obrazovce.

**Implementační závěr pro architekturu BYZON:** read-only domény (profily, agenda, speakeři, mapa, sponzoři) zůstanou ve statickém světě (rozšířený content.json, PWA, localStorage). Stavové domény (schůzky, Q&A, check-in, lead retrieval, push) vyžadují buď minimální backend (BaaS typu Supabase/Firebase), nebo embed osvědčené SaaS (Sli.do pro Q&A, dedikovaný matchmaking) — stejným vzorem jako stávající SimpleShop embed.

Sources:
- [Swapcard – Networking & Matchmaking](https://www.swapcard.com/features/event-networking)
- [Brella – Event Matchmaking](https://www.brella.io/event-matchmaking)
- [Whova – Features / Live Polling](https://whova.com/event-management-software/live-polling/)
- [Cvent – Onsite & LeadCapture](https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software)
- [Bizzabo – Onsite & SmartBadge](https://www.bizzabo.com/event-management-software/onsite-event-management-software)
- [Sli.do – Product features](https://www.slido.com/product)
- [Eventbrite – QR & Check-in](https://www.eventbrite.com/organizer/features/how-to-use-qr-codes-for-events/)
- [Konfeo – Pricing](https://www.konfeo.com/en/event-registration-software-pricing/) · [GoOut – pro pořadatele](https://goout.net/cs/pro-poradatele/funkce/)
- [Webex Events (Socio) – Features](https://socio.events/features)
- [Grip – Event Matchmaking](https://www.grip.events/products/event-matchmaking)
- [PINE – Product](https://pine.events/product)
- [Cvent – Increasing Event App Adoption](https://www.cvent.com/en/blog/events/complete-guide-increasing-event-app-adoption) · [Bizzabo – App adoption](https://www.bizzabo.com/blog/event-app-promotion-best-practices)

---

## Rešerše: SimpleShop integrace a GDPR/CZ kontext

### A) SimpleShop.cz — integrační možnosti

SimpleShop (provozuje Redbit/Vyfakturuj) má **veřejné REST API v2** ([Apiary](https://simpleshopcz.docs.apiary.io/)) i **webhooky**. Pro náš statický web + plánovanou aplikaci je to klíčové: umožní automaticky párovat zaplacenou vstupenku s účtem účastníka.

**Autentizace:** HTTP Basic Auth — username = přihlašovací e-mail, password = API klíč z *Nastavení → Propojení s dalšími systémy → API a webhook*. Klíč patří do backendu, nikdy do klientského JS.

| Schopnost | Stav | Poznámka pro implementaci |
|---|---|---|
| REST API (v2) | ANO | Vrací max **100 záznamů / request** → nutná paginace přes parametry data/období |
| Export objednávek "Kdo koupil" přes API | ANO | JSON s vnořeným CSV, UTF-8; obsahuje jméno, e-mail, kód objednávky, stav platby, **data z dotazníku (custom pole)**, slevové kupóny, info o ověření vstupenky |
| Custom / dotazníková pole ve formuláři | ANO | SimpleShop umožní přidat dotazníkové otázky → vracejí se v exportu. Lze sbírat firmu, IČ, dietní preference, GDPR opt-in pro networking |
| Webhook po objednávce / po platbě | ANO | Nastavitelný **globálně** (Nastavení → API a webhook) i **per produkt** (pole "Webhook po objednávce" / "Webhook po platbě"). Volá se i při platbě, editaci dokumentu, odeslání e-mailu |
| Push v reálném čase | ČÁSTEČNĚ | Webhook = trigger; payload je tenký → typicky doplnit GET dotazem na detail objednávky |

**Doporučená architektura párování (MUST, M):** webhook "po platbě" → náš backend endpoint (serverless function / malý PHP skript na témže FTP hostingu, mimo statický build) → ověří, dotáhne objednávku přes API → vytvoří/aktualizuje účet účastníka. **Párovací klíč = e-mail + kód objednávky.** E-mail je primární identifikátor, kód objednávky jako verifikační token (účastník ho zadá při prvním přihlášení / magic-link na e-mail z objednávky → bez hesel, ladí s "žádné účty" filozofií).

**Fallbacky (pokud API/webhook tým nezapojí včas):**
- **CSV/JSON export "Kdo koupil"** — manuální stažení + import do aplikace (cron/manuální upload). Spolehlivé, MUST jako záloha (S).
- **Manuální import / on-site ověření** — registrační kód / QR z e-mailu, kontrola na recepci (COULD, S).
- **E-mail parsing** — nedoporučuji (křehké, GDPR riziko), jen nouzově.

**CZ alternativy/doplňky:** SimpleShop ponecháme jako **prodejní/platební vrstvu** (form_id 0MnNQ je zaběhnutý). **Konfeo** je relevantní jako doplněk pro registraci/jmenovky/check-in (má vlastní registrační formuláře, e-mailing, platební brány) — zvážit jen pokud SimpleShop API nestačí na on-site. **GoOut/Ticketstream** = ticketing marketplace, pro B2B konferenci s vlastním webem zbytečná závislost a vyšší poplatky → nedoporučuji měnit.

### B) GDPR / ePrivacy pro eventovou aplikaci (ČR)

**Správce:** ENJOiT s.r.o. (IČ 19295073). Aplikace zavádí nové kategorie údajů → nutná aktualizace záznamů o činnostech zpracování a Zásad ochrany OÚ.

| Údaj | Účel | Právní titul (čl. 6 GDPR) |
|---|---|---|
| Jméno, e-mail, firma, kód objednávky | Vstup, doručení vstupenky, organizace | **6(1)(b)** plnění smlouvy |
| Registrační data, jmenovka, check-in | Realizace akce | **6(1)(b)** + **6(1)(f)** oprávněný zájem (logistika) |
| **Networking profil** (bio, foto, pozice, zájmy) sdílený mezi účastníky | Matchmaking, B2B kontakty | **6(1)(a) souhlas** (explicitní opt-in) |
| **Schůzky, zprávy mezi účastníky** | Funkce aplikace | **6(1)(a)** souhlas + 6(1)(b) |
| Marketing (newsletter, příští ročník) | Propagace | **6(1)(a)** / oprávněný zájem dle zák. 480/2004 Sb. |
| Fotky/video z akce | Dokumentace, propagace | **6(1)(f)** oprávněný zájem + zpravodajská licence |

**Klíčové principy pro architekturu:**
- **Networking opt-in = oddělený, granulární souhlas** (ne předzaškrtnutý, odvolatelný, prokazatelný — uložit timestamp, IP, znění). Účastník bez opt-inu se nesmí zobrazit ostatním. **Sdílení profilu řeš jako stavový flag, ne implicitně.** Toggle viditelnosti v profilu (privacy-by-default — čl. 25).
- **Data minimization:** sbírej jen nutné; foto a bio jsou volitelné. Zprávy/schůzky šifrovat at-rest.
- **Retence:** transakční data dle účetnictví (10 let zákonná povinnost u dokladů); networking profil/zprávy smazat ~30–90 dní po akci nebo na žádost; souhlasy do odvolání.
- **Právo na výmaz / přístup / přenositelnost:** aplikace potřebuje admin funkci "smazat účastníka" + export jeho dat (čl. 15–20).
- **Zpracovatelské smlouvy (DPA, čl. 28):** uzavřít se SimpleShop/Redbit, FTP hostingem, e-mail/SMTP providerem. Ověřit **EU/EEA data residency** — pro hosting i e-mail volit EU lokaci; vyhnout se US službám bez záruk (SCC / EU-US DPF).
- **Cookie/consent banner:** statický web dnes minimální; aplikace s analytikou/embedy (SimpleShop iframe z form.simpleshop.cz) vyžaduje **opt-in cookie lištu** (zák. 127/2005 Sb., ePrivacy) — kategorie nezbytné/analytické/marketingové, blokovat skripty do souhlasu.
- **Fotky z akce:** dle CZ praxe skupinové/dokumentační fotky kryje oprávněný zájem + zpravodajská licence; **informovat předem** (pozvánka, cedule u vstupu, znění v Zásadách), nabídnout opt-out a kontakt pro stažení. Individuální portréty pro marketing → raději souhlas.

**Sources:**
- [SimpleShop.cz API v2 (Apiary)](https://simpleshopcz.docs.apiary.io/)
- [Webhooky ve Vyfakturuj.cz a SimpleShopu — Redbit](https://podpora.redbit.cz/navod/webhooky/)
- [Export objednávek "Kdo koupil" — Redbit](https://podpora.redbit.cz/navod/export-objednavek-kdo-koupil/)
- [Konfeo — registrace účastníků](https://www.konfeo.com/en/)
- [5 GDPR tipů pro vývoj aplikací — Právní prostor](https://www.pravniprostor.cz/clanky/pravo-it/5-gdpr-tipu-pro-vyvoj-aplikaci)
- [GDPR a e-mailing — SmartEmailing](https://www.smartemailing.cz/gdpr-a-emailing/)
- [Focení veřejných akcí a GDPR — mylaw.cz](https://mylaw.cz/clanek/pozor-vyleti-ptacek-aneb-foceni-verejnych-akci-a-gdpr-801)

---

## Rešerše: technické vzory a stack pro dynamickou app na statickém webu

### Hlavní doporučení (TL;DR)
Marketing web nechte beze změny (build.py → statika na FTP). Dynamickou aplikaci postavte **mimo FTP**, jako samostatný projekt na **subdoméně `app.byzon.cz`**, s **Supabase** jako backendem (Postgres + Auth + Realtime + Storage v jednom) a **PWA** jako event-day frontendem. Jde o nejrychlejší cestu k MVP pro malý tým a jednorázovou akci, bez vendor lock-inu na proprietární datový model (čistý Postgres, exportovatelné).

### 1. Topologie
| Vrstva | Kde běží | Poznámka |
|---|---|---|
| Marketing (`byzon.cz`) | FTP, statika z build.py | Beze změny. Přidat jen odkazy `app.byzon.cz` (CTA "Vstoupit do aplikace"). |
| App (`app.byzon.cz`) | Cloudflare Pages / Vercel (ne FTP) | Separátní repo nebo `/app` adresář, vlastní CI. FTP nezvládá SPA routing ani env secrets. |
| Backend | Supabase (managed) | Volá se z app i z marketingu (např. počet prodaných lístků). |

**SSO/odkazy:** účet žije v Supabase Auth na subdoméně. Marketing zůstává anonymní; CTA jen prolinkuje na `app.byzon.cz/login`. Cookie scope na `.byzon.cz` umožní sdílet session, pokud byste později chtěli i na marketingu zobrazit "přihlášen jako". Pro MVP stačí prostý odkaz — **MUST, S**.

### 2. Backend decision matrix
| Volba | Plus | Minus | Verdikt pro vás |
|---|---|---|---|
| **Supabase** (BaaS) | Postgres + Auth + Realtime + Storage + RLS out-of-box; SQL = žádný lock-in; štědrý free tier; magic-link login | Realtime má limity na free tieru; nutná disciplína u RLS policies | **DOPORUČENO** |
| Firebase | Vyzrálé, skvělý realtime/push | NoSQL datový model špatně sedí na relační agendu/řečníky; Google lock-in | Ne |
| Pocketbase / Directus / Nhost (self-host) | Levné, plná kontrola, jeden binár (PB) | Vy provozujete a zálohujete server — režie navíc u jednorázové akce | Záloha, ne primár |
| Cloudflare Workers + D1/KV | Levné, edge, rychlé | Auth/Realtime si stavíte sami → víc kódu | Jen pokud chcete vše custom |
| Next.js/Nest/Laravel fullstack | Maximální flexibilita | Nejvíc kódu i provozu; pomalé k MVP | Overkill |

**Zdůvodnění:** agenda (days→stages→events), řečníci a partneři jsou silně relační — Postgres je přirozený. Supabase pokrývá účty, realtime i úložiště fotek jednou službou; data jsou kdykoli exportovatelná `pg_dump`. Pro tým bez DevOps to minimalizuje provozní zátěž. Existující `content.json` lze jednorázově naimportovat seed skriptem (zachová single source pro build.py, app jen čte kopii v DB). **MUST, M.**

### 3. Frontend event-day
| Varianta | Verdikt |
|---|---|
| **PWA** (instalovatelná, service worker, offline cache agendy, web push) | **DOPORUČENO** |
| Nativní (iOS/Android) | Ne — App Store review, dvě codebase, údržba po akci zbytečná |
| Pouhý responsive web | Nestačí — chybí offline a push |

PWA dá "appový" pocit (ikona na ploše) bez storů. Agendu a profily řečníků cachujte přes service worker → funguje i při přetíženém hotelovém WiFi. **Pozn.:** iOS Web Push funguje jen u PWA přidané na plochu (Safari 16.4+). **MUST, M.**

### 4. Realtime vrstva (Q&A, ankety, live agenda)
**Supabase Realtime** (Postgres logical replication + broadcast/presence) — nepřidává další službu. Q&A a hlasování = INSERT do tabulky → ostatní klienti dostanou push automaticky. Pusher/Ably až kdyby free tier nestačil (stovky účastníků jsou na hraně, ale pro burst Q&A obvykle OK; ankety agregujte server-side). Moderace Q&A přes RLS + flag `approved`. **SHOULD, M** (Q&A), **COULD, M** (live ankety).

### 5. Kalendářní import (ICS)
| Funkce | Hodnota | Detail |
|---|---|---|
| ICS celé agendy | Účastník si nahraje program | Jeden `.vevent` per session, `UID` stabilní pro re-import |
| ICS per session | "Přidat tuto přednášku" | Generovat staticky při buildu i dynamicky z app |
| "Add to Google/Outlook" odkazy | Bez stahování souboru | Google: `calendar.google.com/calendar/render?action=TEMPLATE&...`; Outlook obdobně; Apple = stažení `.ics` |

ICS umím generovat **už ve build.py** (žádný backend) — quick win. **SHOULD, S.** Závislost: korektní `TZID=Europe/Prague`, `DTSTART/DTEND` z `event.time`.

### 6. Web Push + QR check-in
- **Web Push** (VAPID, service worker): upozornění "Tvůj workshop začíná za 10 min", změny v programu. Posílat ze Supabase Edge Function. Hodnota: snižuje zmeškání, řídí networking. **SHOULD, M.** Závislost: PWA + souhlas uživatele (GDPR — opt-in).
- **QR check-in:** vstupenka ze SimpleShop → po dokoupení vygenerovat token (UUID v DB), zobrazit jako QR v app/e-mailu. U vchodu scanner (kamera v PWA, `BarcodeDetector`/`html5-qrcode`) ověří token proti DB a označí příchod. Hodnota: rychlý vstup, počet reálně přítomných, podklad pro partnery. **SHOULD, L.** Závislost: napojení na SimpleShop (webhook/CSV export objednávek → seed účastníků), backend zápis.

### 7. Build vs Buy
| Scénář | Doporučení |
|---|---|
| Chcete jen agendu + Q&A + push + check-in, řešíte jednou ročně | **Buy zvážit** — Whova/Swapcard ušetří vývoj |
| Chcete vlastní brand (#f5218e, Khand/Inter), data v Postgresu, opakovat ročně, integrace SimpleShop/ClickUp | **Build** (Supabase) — lock-in platforem je drahý a generický |

**Hybridní (doporučeno):** postavte **MUST jádro custom** (agenda z `content.json`, řečníci, ICS, PWA, push) na Supabase — je to malý rozsah a sdílí brand i data s webem. **Pro Q&A a live ankety** zvažte hotový widget (Slido) embednutý do PWA jako fallback, pokud realtime kód nestihnete. Tím oddělíte riziko: marketingově kritické věci máte pod kontrolou, "nice-to-have" interakci lze koupit per-event.

### Doporučený rollout (priorita)
1. **MVP (MUST):** subdoména + PWA + Supabase, import agendy/řečníků z `content.json`, offline cache, ICS export. *(M–L)*
2. **V2 (SHOULD):** účty (magic-link), osobní agenda, Web Push, QR check-in se SimpleShop. *(L)*
3. **V3 (COULD):** live Q&A/ankety přes Realtime, partner leady, post-event feedback. *(M)*

**Klíčové riziko:** udržet `content.json` jako single source of truth — app data jen **importuje**, build.py zůstává needotčený, takže marketing web nikdy nerozbijete.

---
Relevantní cesty v repu (k případnému navázání implementace): `/home/user/byzon-2026/build.py`, `/home/user/byzon-2026/data/content.json`.
