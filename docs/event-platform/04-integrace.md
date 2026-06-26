# Integrace a rozhraní

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Bezpečnost a GDPR »](./05-bezpecnost-gdpr.md)

---

## Integrace a rozhraní s okolními systémy

Tato sekce definuje hranice aplikace BYZON 2026 vůči okolním systémům. Architektonický princip zůstává: **marketing web (`byzon.cz`) je read-only statika z `build.py`**, **aplikace (`app.byzon.cz`) je stavová vrstva na Supabase**. Veškerá integrace se zápisem běží mimo FTP — buď v Supabase Edge Functions, nebo jako embed osvědčené SaaS (vzor SimpleShopu). Pro každou integraci uvádím účel, směr toku, mechanismus, fallback a rizika.

### Přehledová matice integrací

| # | Integrace | Směr toku | Mechanismus | Priorita | Složitost |
|---|---|---|---|---|---|
| 1 | SimpleShop → účet účastníka | dovnitř | Webhook + REST API v2 | MUST | M |
| 2 | Kalendáře (ICS / Add-to-X) | ven | Statický build + dynamický endpoint | SHOULD | S–M |
| 3 | Transakční e-mail | ven | Provider API (Postmark) | MUST | M |
| 4 | Web Push (VAPID) | ven | Service worker + Edge Function | SHOULD | M |
| 5 | QR kódy (vstupenka/profil/check-in) | obojí | Token v DB + scanner v PWA | SHOULD | L |
| 6 | On-site upsell/platby | dovnitř | SimpleShop / Stripe link | COULD | M |
| 7 | Video/stream + záznamy | ven | YouTube embed | COULD | S |
| 8 | Týmové MCP (Calendar/Canva/ClickUp/M365) | obojí | MCP v provozu týmu | SHOULD | S–M |
| 9 | Analytika + CRM | dovnitř | Plausible + webhook do CRM | SHOULD | S |

---

### 1) SimpleShop → párování zaplacené vstupenky s účtem

**Účel:** Z anonymního kupce (SimpleShop) udělat identifikovaného účastníka v aplikaci, který si může spravovat agendu, networking a check-in. Zachovat filozofii "žádná hesla" → magic-link / verifikace kódem objednávky.

**Směr toku:** SimpleShop → backend (dovnitř). Žádný zápis zpět do SimpleShopu.

**Mechanismus (primární, MUST):**
1. V SimpleShop Nastavení → *API a webhook* (i per produkt 0MnNQ) nastavit **Webhook po platbě** → `https://api.byzon.cz/hooks/simpleshop` (Supabase Edge Function).
2. Webhook je tenký trigger → funkce dotáhne detail objednávky přes **REST API v2** (Basic Auth: e-mail + API klíč z env, nikdy v klientu).
3. Mapování → tabulka `attendees`:

| SimpleShop pole | DB sloupec | Poznámka |
|---|---|---|
| e-mail | `email` (unique) | primární identifikátor / párovací klíč |
| kód objednávky | `order_code` | verifikační token pro první přihlášení |
| jméno | `full_name` | |
| stav platby | `payment_status` | účet aktivní jen při `paid` |
| typ vstupenky | `ticket_type` | Early/Standard/Late → segmentace pushů |
| custom pole (firma, IČ, dieta, GDPR opt-in networking) | `company`, `vat_id`, `diet`, `networking_optin` | dotazníková pole ve formuláři |

4. **Párovací klíč = e-mail + kód objednávky.** Při prvním vstupu uživatel zadá e-mail → magic-link na e-mail z objednávky, nebo zadá kód objednávky jako jednorázový token. Bez hesel.
5. Paginace API: max **100 záznamů/request** → při hromadném seedu iterovat přes období.

**Aktivační e-mail:** trigger po úspěšném `paid` webhooku → přes transakční provider (integrace #3) odeslat "Vstupenka potvrzena — aktivuj si appku" s magic-linkem. Idempotence: posílat jen jednou na `order_code` (flag `activation_sent_at`).

**Fallbacky (sestupně dle spolehlivosti):**
- **CSV/JSON export "Kdo koupil"** — manuální/cron import do `attendees`. MUST jako záloha, pokud tým nestihne webhook (S).
- **Magic-link bez webhooku** — uživatel zadá e-mail, systém ověří existenci v posledním importu CSV.
- **On-site ověření** — kód/QR z potvrzovacího e-mailu na recepci (COULD).
- **E-mail parsing** — NEdoporučeno (křehké, GDPR riziko).

**Rizika:**
- Webhook payload je tenký a může dorazit dřív, než je objednávka konzistentní → vždy potvrdit GET na API, retry s backoffem.
- API klíč v klientu = únik dat → výhradně server-side, v Supabase secrets.
- Duplicitní webhooky (platba + editace dokumentu spouští stejný hook) → idempotence dle `order_code`.
- E-mail v objednávce ≠ e-mail účastníka (firemní hromadný nákup více vstupenek) → řešit skupinovou registraci: jeden kupec přiřadí jména/e-maily k jednotlivým vstupenkám (SHOULD, M).
- GDPR: `networking_optin` musí být explicitní pole ve formuláři, ne implicitní.

---

### 2) Kalendáře — ICS a Add-to-X odkazy

**Účel:** Účastník si vloží program (celý nebo vybrané sessions) do svého kalendáře → snižuje zmeškání, posiluje "Moje agenda".

**Směr toku:** aplikace/web → kalendář uživatele (ven).

**Mechanismus:**

| Funkce | Kde se generuje | Detail |
|---|---|---|
| ICS celé agendy (`byzon-2026.ics`) | **build.py** (staticky) | jeden `VEVENT` per session, stabilní `UID` (`<slug>@byzon.cz`) pro re-import |
| ICS per session ("Přidat tuto přednášku") | build.py | odkaz u každého eventu v programu |
| ICS "Moje agenda" (jen bookmarknuté) | **Edge Function** (dynamicky z DB) | vyžaduje účet; generuje filtrovaný kalendář |
| Add to Google | odkaz | `calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...&location=...` |
| Add to Outlook | odkaz | `outlook.live.com/calendar/0/deeplink/compose?...` |
| Add to Apple | stažení `.ics` | Apple nemá URL schéma → servíruje se ICS soubor |

**Technické detaily:** `TZID=Europe/Prague`, `DTSTART`/`DTEND` z `event.time`, `LOCATION` = stage + sál Clarionu, `URL` zpět na detail session. Quick win: statická varianta nepotřebuje backend vůbec.

**Tým — Google Calendar MCP:** produkční tým si přes MCP vygeneruje **interní provozní kalendář** (sloty řečníků, příjezdy, briefingy, on-site checkpointy) — oddělený od veřejné agendy. Užitečné pro koordinaci, ne pro účastníky.

**Fallback:** když dynamický "Moje agenda" ICS nestihneme → účastník použije statický plný ICS a ručně smaže nechtěné. Žádná tvrdá závislost.

**Rizika:** špatná časová zóna / DST posun (proto explicitní `TZID`); příliš dlouhé URL u Add-to-Google s diakritikou → URL-encode; re-import duplikáty → stabilní `UID`.

---

### 3) Transakční e-mail (aktivace, připomínky, schůzky)

**Účel:** Spolehlivé doručení aktivačního e-mailu, připomínek programu a notifikací o schůzkách. Doručitelnost je kritická — aktivace = vstupní brána do celé app.

**Směr toku:** backend → účastník (ven).

**Volba providera:**

| Provider | EU data residency | Pro/proti | Verdikt |
|---|---|---|---|
| **Postmark** | EU region dostupný | špička v doručitelnosti transakční pošty, oddělené streamy (transakční vs. broadcast), skvělé šablony | **DOPORUČENO** |
| Resend | EU region | moderní DX, React Email šablony, mladší → menší reputace | dobrá alternativa |
| SendGrid | EU možné | univerzální, ale horší poměr cena/doručitelnost, sdílené IP problémy | jen pokud už používán |
| Amazon SES | EU (eu-central-1) | nejlevnější, ale doručitelnost si stavíte sami (warmup, DMARC) | jen při objemu |

**Doporučení:** **Postmark (EU region)** pro transakční (aktivace, schůzky, připomínky). Pro hromadný marketing/newsletter raději oddělit do **SmartEmailing** (CZ, GDPR-friendly, zák. 480/2004 Sb.) — nemíchat reputaci IP.

**Šablony (branded, Khand/Inter, růžová #f5218e):**
- Aktivace účtu (magic-link)
- Připomínka D-7 / D-1 ("zítra začínáme, tady je tvůj QR")
- Notifikace schůzky (potvrzení / změna / zrušení)
- Reminder "tvůj workshop začíná za X" (jen pokud uživatel nemá zapnutý push)
- Post-event (poděkování, feedback, "tvá spojení")

**Doručitelnost (MUST):** SPF, DKIM, **DMARC** na doméně `byzon.cz`; dedikovaná subdoména pro odesílání (`mail.byzon.cz`) aby se nepoškodila reputace hlavní domény; plain-text alternativa; unsubscribe jen u marketingu.

**Fallback:** Pokud provider vypadne → fronta s retry v DB (`email_queue`, status `pending/sent/failed`); kritický aktivační e-mail lze v nouzi poslat i ručně z administrace s magic-linkem.

**Rizika:** aktivační e-mail v spamu = zablokovaný onboarding → proto Postmark + DMARC; GDPR → DPA s providerem, EU lokace; míchání transakční a marketingové pošty poškodí doručitelnost.

---

### 4) Web Push notifikace (VAPID) pro event-day

**Účel:** Real-time řízení účastníka během akce — "workshop začíná za 10 min", změna sálu, "networking blok otevřen", "tvá schůzka potvrzena". Naplňuje pozicování řízeného networkingu a anti-pattern "app na jedno otevření".

**Směr toku:** backend → zařízení (ven), opt-in zařízení → backend (registrace subscription).

**Mechanismus:**
1. PWA si vyžádá souhlas (po onboardingu, ne hned) → `PushSubscription` uložit do `push_subscriptions` (endpoint, keys, attendee_id).
2. Odeslání ze **Supabase Edge Function** přes **VAPID** (web-push knihovna).
3. Segmentace: dle `ticket_type`, stage, bookmarknutých sessions ("máš v agendě X, začíná za 10 min").
4. **iOS:** Web Push funguje jen u PWA přidané na plochu (Safari 16.4+) → onboarding musí vést k "Přidat na plochu".
5. Disciplína: **2–3 cílené pushe/den**, ne spam (anti-pattern over-advertising).

**Fallback:** kdo nepovolí push / má iOS bez instalace → e-mailové připomínky (#3) + in-app banner při otevření. Kritická oznámení (změna programu) duplikovat i jako banner na webu/PWA.

**Rizika:** souhlas s notifikacemi = GDPR opt-in, prokazatelný; iOS omezení sníží dosah → nikdy ne jediný kanál pro kritické info; nadužívání → odinstalace. VAPID klíče v secrets.

---

### 5) QR kódy (vstupenka, profil, check-in)

**Účel:** Rychlý vstup, měření reálné účasti, hmatatelná hodnota pro partnery (lead retrieval), výměna kontaktů mezi účastníky.

**Směr toku:** obojí (generování ven, sken dovnitř).

**Mechanismus:**

| Typ QR | Obsah | Generování | Skenuje | Účel |
|---|---|---|---|---|
| **Vstupenkový QR** | UUID token vázaný na `order_code` | po `paid` webhooku, v aktivačním e-mailu + v PWA | recepce (PWA scanner) | check-in, count přítomných |
| **Profilový QR** | `attendee_id` + podpis | v profilu v PWA | jiný účastník | výměna kontaktu (opt-in) |
| **Partnerský lead QR** | sken profilu účastníka partnerem | — | partner v PWA | lead retrieval + scoring |

**Detaily:** scanner v PWA přes `BarcodeDetector` (fallback `html5-qrcode`); tokeny jako UUID v DB, ne predikovatelné; check-in zapíše `checked_in_at`; real-time dashboard přes Supabase Realtime. **Offline režim** check-inu: cache seznamu platných tokenů v service workeru, sync po obnovení sítě (hotelová WiFi je riziko).

**Lead retrieval pro partnery:** partner skenuje profilový QR účastníka (jen u opt-in profilů) → uloží lead + poznámku + scoring → export CSV po akci. Hodnota balíčků pro partnery bez extra HW.

**Fallback:** ruční check-in podle jména/e-mailu v PWA admin; tištěný seznam jako poslední záloha; partner si lead zapíše ručně.

**Rizika:** GDPR — profilový/lead QR jen pro účastníky s `networking_optin`; sken bez souhlasu = porušení; offline desync u check-inu (řešit idempotentním zápisem); klonování QR (proto podpis/UUID, ne sekvenční ID).

---

### 6) On-site upsell / platby (volitelné)

**Účel:** Doprodej na místě — upgrade vstupenky, merch, příští ročník early bird, dodatečný workshop.

**Směr toku:** účastník → platební vrstva (dovnitř).

**Mechanismus:**
- **Primárně:** odkaz na SimpleShop (zachová účetní tok, faktury, DPH) — QR/odkaz v PWA "Dokoupit X".
- **Alternativa pro rychlý on-site:** **Stripe Payment Link** / **GoPay** (CZ, karty + Apple/Google Pay) pro okamžitou platbu bez vyplňování — ale řeší se účtování zvlášť.

**Fallback:** ruční prodej na recepci + dodatečná faktura ENJOiT; QR na SimpleShop produkt.

**Rizika:** účetní konzistence (raději vše přes SimpleShop), DPH na místě, GDPR u nového platebního providera (DPA). COULD — neřešit v MVP.

---

### 7) Video / stream a záznamy

**Účel:** Live stream keynote (pokud hybridně), on-demand záznamy po akci (anti-pattern: app jen na jeden den → záznamy prodlouží životnost).

**Směr toku:** YouTube → web/PWA (ven, embed).

**Mechanismus:**
- **YouTube** (už používán v `links.youtube` řečníků) — unlisted/premiéra pro stream, embed do PWA u session detailu.
- Po akci: on-demand knihovna = sekce v PWA s embedy záznamů, gate jen pro účastníky (volitelně).
- Slidy řečníků (ze speaker upload portálu) ke stažení u session.

**Fallback:** prostý odkaz místo embedu; pokud stream nebude, jen post-event záznamy.

**Rizika:** práva řečníků na záznam (souhlas předem, smluvně); GDPR u záběrů publika (informovat, opt-out — viz Zásady); YouTube cookies → consent banner.

---

### 8) Týmové nástroje jako MCP (Calendar, Canva, ClickUp, M365)

**Účel:** Zefektivnit produkci — generování artefaktů a koordinaci týmu — využitím MCP integrací dostupných v prostředí. Tyto integrace běží v **provozu týmu, ne v runtime aplikace**.

| Nástroj | Zapojení | Konkrétní use-case | Priorita |
|---|---|---|---|
| **Google Calendar MCP** | interní provozní kalendář | sloty řečníků, briefingy, příjezdy, on-site checkpointy, schůzky VIP; generování z `content.json` | SHOULD |
| **Canva MCP** | grafické artefakty z dat | **jmenovky/badge** (jméno+firma+QR z `attendees`), **sociální karty řečníků** (foto+jméno+role z `content.json`), promo grafika programu | SHOULD |
| **ClickUp MCP** | produkční úkoly | rozpad implementačního plánu na tasky/listy (MVP→V2→V3), deadliny speaker podkladů, on-site runbook, dependencies | SHOULD |
| **Microsoft 365 MCP** | dokumenty/tabulky týmu | export účastníků do Excelu pro on-site tým, sdílené dokumenty, případně Outlook kalendář | COULD |

**Konkrétní pipeline (příklad):**
- **Jmenovky:** seed `attendees` (jméno, firma, QR token) → Canva MCP `create-design-from-brand-template` s datasetem → batch export PDF na tisk. Eliminuje ruční sazbu 14 řečníků + stovek účastníků.
- **Sociální karty řečníků:** `content.json` řečníci → Canva brand template → export PNG pro LinkedIn/IG promo (2 měsíce předem — anti-pattern pozdního launche).
- **Produkční board:** implementační plán → ClickUp listy s tasky, custom fieldy (priorita MUST/SHOULD, odhad S/M/L), dependencies (speaker portál před tiskem jmenovek).

**Směr toku:** obojí — data z `content.json`/`attendees` ven do Canva/ClickUp; stav úkolů zpět k týmu.

**Fallback:** vše lze udělat ručně (Canva GUI, ClickUp web) — MCP je akcelerátor, ne závislost.

**Rizika:** osobní data účastníků do Canva/ClickUp = zpracovatel třetí strany → DPA, minimalizace (do Canva jen co je na jmenovce); nemíchat US SaaS s citlivými daty bez záruk.

---

### 9) Analytika (privacy-friendly) a CRM

**Účel:** Měřit chování bez cookie-consent zátěže a bez US trackerů; CRM pro follow-up a příští ročník.

**Směr toku:** web/PWA → analytika (ven); aplikace → CRM (dovnitř/ven).

**Analytika:**

| Nástroj | Proč | Verdikt |
|---|---|---|
| **Plausible** (EU, self-host nebo EU cloud) | cookieless → **bez nutnosti cookie banneru** pro analytiku, lehký skript, GDPR-friendly, EU data | **DOPORUČENO** |
| Matomo (EU/self-host) | plnější, ale těžší, často potřebuje consent | alternativa |
| Google Analytics 4 | NE — US transfer, consent nutný, proti privacy-by-default | nedoporučeno |

Měřit: konverze vstupenek (CTA → SimpleShop), adopce app (aktivace/login), engagement (bookmarky, schůzky, check-in rate). Cíle (goals) na klíčové akce.

**CRM (volitelné, SHOULD):**
- **Raynet** nebo **Anabix** (CZ CRM, GDPR, EU) pro B2B follow-up a databázi účastníků/partnerů napříč ročníky.
- Napojení: po akci export `attendees` + lead retrieval → CRM přes webhook/CSV. Segmenty: účastníci, partneři, leady partnerů, kandidáti "Výjimečný Jihočech".
- Pro lehčí potřebu stačí **Microsoft 365 / Excel** (MCP) jako jednoduchá databáze.

**Cookie/consent:** Plausible nepotřebuje banner. Banner je nutný kvůli **SimpleShop iframe** (form.simpleshop.cz) a YouTube embedům → opt-in lišta (zák. 127/2005 Sb.), kategorie nezbytné/analytické/marketingové, blokovat embedy do souhlasu.

**Fallback:** pokud analytika vypadne → server-side eventy v Supabase (login, check-in) jako minimální měření; CRM lze nahradit exportem do M365.

**Rizika:** GA4 by vynutil consent a US transfer → proto Plausible; CRM = nový zpracovatel (DPA, EU lokace); minimalizace dat při exportu do CRM (jen co je potřeba pro follow-up).

---

### Shrnutí závislostí mezi integracemi

- **#1 SimpleShop** je kořen — bez identity účastníka nefunguje #3 (aktivace), #4 (cílený push), #5 (check-in/QR), #9 (CRM export).
- **#3 e-mail** je kritická cesta onboardingu — nasadit a otestovat doručitelnost (DMARC) **před** spuštěním aktivací.
- **#2 ICS** a **#8 MCP** jsou nezávislé quick-winy — lze dodat brzy bez backendu.
- **Privacy-by-default** prostupuje vše: networking/profilové funkce (#5) gateované přes `networking_optin` z #1; consent banner kvůli embedům v #7 a #9.
