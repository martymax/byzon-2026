# Bezpečnost, soukromí a GDPR

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Roadmapa »](./06-roadmapa.md)

---

## Bezpečnost, soukromí a GDPR

Tato sekce navrhuje konkrétní bezpečnostní a privacy architekturu pro **event-management app (před akcí)** a **event-day app (během akce)**. Vychází z architektonického rozhodnutí: dynamická aplikace běží mimo statický web na subdoméně `app.byzon.cz` se Supabase backendem (Postgres + Auth + Realtime + Storage, EU region). Správcem osobních údajů je **ENJOiT s.r.o. (IČ 19295073)**, kontakt jsem@byzon.cz.

### 0. Bezpečnostní principy (závazná rozhodnutí)

- **Privacy by default & by design (čl. 25 GDPR):** každý nový datový tok má výchozí stav "neviditelný/nesdílený". Networking profil, foto, "co hledám/nabízím" jsou ze startu skryté, dokud účastník aktivně neudělí opt-in.
- **Least privilege napříč vrstvami:** role v aplikaci, RLS policies v DB, scope API klíčů i přístup týmu k adminu — vždy minimum nutné k roli.
- **Single source of truth pro identitu:** účet = řádek v `auth.users` (Supabase), párovaný na zaplacenou vstupenku přes e-mail + kód objednávky. Žádné duplicitní úložiště hesel.
- **Bez hesel:** přihlášení výhradně **magic-link / OTP** → eliminuje credential stuffing, reuse hesel, leak hesel.
- **Vše stavové přes RLS:** žádný "trust the client". I když je frontend PWA, autorizace se vynucuje v Postgresu (Row Level Security), ne v JS.

### 1. Model autentizace

| Prvek | Rozhodnutí | Priorita | Odhad |
|---|---|---|---|
| Login metoda | **Magic-link e-mailem** (primárně) + 6místný OTP kód jako fallback na slabém WiFi. Bez hesel. | MUST | S |
| Identita účtu | Supabase Auth, e-mail jako primární klíč. | MUST | S |
| Párování na vstupenku | Při 1. loginu účastník zadá **kód objednávky** ze SimpleShop e-mailu → ověří se proti tabulce `tickets` (seedované z webhooku / CSV exportu). Bez platné vstupenky → účet zůstane v roli `guest` bez přístupu k networkingu/agendě. | MUST | M |
| Token & session | Supabase JWT, **access token TTL 1 h**, refresh token rotace zapnutá, refresh TTL 30 dní (po akci zkrátit). Logout invaliduje refresh. | MUST | S |
| Re-auth pro citlivé akce | Smazání účtu, export dat, změna e-mailu → vynutit čerstvý magic-link (re-authentication), ne jen platnou session. | SHOULD | S |
| Staff/organizátor login | Stejný magic-link, ale role přidělená **manuálně** (allowlist e-mailů v `staff_roles`), nikdy ne self-service. Pro admin doporučeno **2. faktor**: omezit admin přístup na konkrétní e-maily + krátká session (15 min idle timeout). | MUST | M |

**Magic-link konkrétně:**
- Link platný **15 minut**, **single-use** (po prvním kliknutí invalidovat token v DB).
- Vázaný na e-mail; klik z jiného zařízení vyžaduje zadání OTP (ochrana proti přeposlanému linku).
- Šablona e-mailu obsahuje varování "neposílej dál" + IP/čas požadavku.

### 2. Model autorizace a role

Pět rolí + technická role `guest`. Role je sloupec/řádek v tabulce `user_roles` (jeden uživatel může mít víc rolí, např. řečník je i účastník). Autorizace se vynucuje **RLS policies**, ne v aplikační vrstvě.

| Role | Kdo | Klíčová oprávnění | Co NESMÍ |
|---|---|---|---|
| `guest` | Přihlášený, bez ověřené vstupenky | Read veřejný program a řečníci (to samé co web) | Networking, vidět seznam účastníků, Q&A |
| `attendee` | Ověřená vstupenka | Vlastní profil (CRUD), osobní agenda, networking (po opt-in), schůzky, Q&A/ankety, vlastní QR | Vidět skryté profily, moderovat, číst cizí zprávy, admin |
| `speaker` | Řečník | Vše jako attendee + **vlastní speaker profil**, upload slidů/bio/foto do svého slotu, statistiky vlastní session (počet Q&A) | Editovat cizí session, vidět osobní data ostatních nad rámec networkingu |
| `partner` | Partner/sponzor | Vše jako attendee + **lead retrieval** (skenovat QR účastníků, kteří souhlasili se sdílením kontaktu partnerovi), export vlastních leadů, partner profil | Hromadný export všech účastníků, scan bez opt-inu účastníka |
| `staff` | Obsluha na místě | Check-in scan (zápis příchodu), náhled jméno+stav vstupenky, moderace Q&A | Mazat účty, měnit role, číst soukromé zprávy, export DB |
| `organizer` | Pořadatelský tým (admin) | Plná správa: role, moderace, řízené schůzky, push, export pro GDPR žádosti, smazání účastníka | — (ale akce jsou **auditované**, viz §13) |

**Princip nejmenších práv — konkrétní RLS příklady (Postgres/Supabase):**

```sql
-- Účastník vidí jen vlastní profil + profily s opt-in a viditelností 'attendees'
CREATE POLICY profile_read ON profiles FOR SELECT USING (
  user_id = auth.uid()
  OR (networking_opt_in = true AND visibility = 'attendees'
      AND EXISTS (SELECT 1 FROM user_roles r
                  WHERE r.user_id = auth.uid() AND r.role = 'attendee'))
);

-- Zprávy: čte jen odesílatel nebo příjemce
CREATE POLICY dm_read ON messages FOR SELECT USING (
  sender_id = auth.uid() OR recipient_id = auth.uid()
);

-- Partner vidí lead jen pokud účastník souhlasil sdílet s partnery
CREATE POLICY lead_read ON leads FOR SELECT USING (
  partner_id = auth.uid()
  AND EXISTS (SELECT 1 FROM consents c
              WHERE c.user_id = leads.attendee_id
                AND c.purpose = 'partner_lead_share' AND c.granted = true)
);
```

- **Push a hromadné akce** jen pro `organizer`, navíc přes Edge Function se service-role klíčem (nikdy ne z klienta).
- **Service-role klíč** Supabase žije výhradně v server-side Edge Functions; do PWA jde jen `anon` klíč (chráněný RLS).

### 3. Ochrana účtů a API

| Hrozba | Opatření | Priorita |
|---|---|---|
| Brute-force / spam magic-linků | **Rate limit**: max 5 požadavků na login / e-mail / hodinu; 20 / IP / hodinu. Supabase Auth rate limit + Cloudflare WAF/Turnstile před login formulářem. | MUST · S |
| Enumerace e-mailů | Odpověď loginu vždy generická ("Pokud e-mail existuje, poslali jsme link"). | MUST · S |
| Enumerace kódů objednávek | Rate limit na ověření kódu (5 pokusů / účet / 10 min), pak lockout + manuální ověření. | MUST · S |
| Token leak (refresh) | Rotace refresh tokenů, httpOnly + Secure + SameSite=Lax cookies, scope na `.byzon.cz`. | MUST · S |
| API abuse (Q&A flood, scraping seznamu) | Rate limit na zápisové endpointy (Q&A: 1 dotaz / 20 s / uživatel), paginace read endpointů, žádný "list all profiles" bez filtru. | MUST · M |
| CSRF | SameSite cookies + ověření Origin headeru na Edge Functions. | MUST · S |
| XSS (bio, Q&A, zprávy) | Sanitizace vstupů server-side (escapování), CSP header (`default-src 'self'; script-src 'self'`), žádný `dangerouslySetInnerHTML` bez sanitizéru. | MUST · M |
| Transport | HTTPS-only, HSTS, TLS 1.2+. PWA jen přes HTTPS (vyžadováno service workerem). | MUST · S |
| Secrets | Žádné klíče v repu/PWA bundlu. SimpleShop API klíč, VAPID private key, service-role klíč → env secrets v Supabase/CI. | MUST · S |

### 4. GDPR — mapa zpracovávaných osobních údajů a právní tituly

| Kategorie údajů | Účel zpracování | Právní titul (čl. 6) | Retence |
|---|---|---|---|
| Jméno, e-mail, firma, kód objednávky, stav platby | Prodej a doručení vstupenky, vstup na akci, komunikace | **6(1)(b)** plnění smlouvy | Účetní doklady **10 let** (zák. 235/2004 Sb., 563/1991 Sb.); provozní kopie 90 dní po akci |
| Registrační/profilová data, jmenovka, QR token, check-in čas | Realizace a logistika akce, kontrola vstupu | **6(1)(b)** + **6(1)(f)** oprávněný zájem (organizace) | 90 dní po akci, pak anonymizace |
| **Networking profil** (foto, bio, pozice, zájmy, "hledám/nabízím") sdílený mezi účastníky | Matchmaking, B2B kontakty | **6(1)(a) souhlas** (explicitní opt-in, granulární) | Do odvolání nebo **30 dní po akci** (auto-výmaz) |
| **Schůzky, chat/DM, žádosti o spojení** | Networking funkce | **6(1)(a)** souhlas + 6(1)(b) | Zprávy **30 dní po akci**, pak smazat |
| **Lead pro partnera** (kontakt předaný skenem) | Předání kontaktu partnerovi se souhlasem | **6(1)(a) souhlas** (separátní opt-in "sdílet s partnery") | Předáno partnerovi; u nás 90 dní jako důkaz souhlasu |
| Q&A dotazy, hlasování | Interakce na sessions | **6(1)(f)** oprávněný zájem (anonymizovatelné) | Anonymizovat ihned po session / do 30 dní |
| **Fotky/video z akce** | Dokumentace, propagace ročníku | **6(1)(f)** oprávněný zájem + zpravodajská licence (skupinové); **6(1)(a)** souhlas (individuální portrét pro marketing) | Dle marketingové potřeby, opt-out kdykoli |
| Push notifikace token, device | Doručení upozornění | **6(1)(a) souhlas** (opt-in v prohlížeči) | Smazat po akci / při odvolání |
| Cookies analytické/marketingové | Měření, remarketing | **6(1)(a) souhlas** (cookie banner) | Dle typu cookie |
| Logy (IP, user-agent, auth eventy) | Bezpečnost, audit | **6(1)(f)** oprávněný zájem (security) | 90 dní (security logy), audit log 1 rok |

### 5. Souhlasy a jejich evidence (ConsentRecord)

Souhlasy nejsou booleovský flag v profilu — jsou to **immutable append-only záznamy** v tabulce `consents`, aby byly prokazatelné (akontabilita, čl. 7(1)).

```
consents (
  id            uuid pk,
  user_id       uuid,
  purpose       enum('networking_visibility','partner_lead_share',
                     'marketing_email','photo_marketing','push'),
  granted       boolean,          -- true = udělen, false = odvolán
  scope         text,             -- např. 'attendees' / 'speakers_partners'
  policy_version text,            -- verze Zásad v okamžiku souhlasu
  consent_text  text,             -- přesné znění, se kterým souhlasil
  created_at    timestamptz,
  ip            inet,             -- důkaz
  user_agent    text
)
```

- **Odvolání = nový řádek `granted=false`**, ne UPDATE/DELETE → zachová historii.
- **Aktuální stav** se počítá jako poslední záznam per `(user_id, purpose)` (materializovaný view `current_consents`).
- RLS čte `current_consents` před zobrazením profilu, předáním leadu, odesláním marketingu.
- Souhlasy jsou **granulární a nezávislé**: zapnutí networkingu nezapíná marketing ani sdílení s partnery. Žádné předzaškrtnuté checkboxy.

Priorita: **MUST · M.**

### 6. Networking opt-in a viditelnost profilu

| Rozhodnutí | Detail |
|---|---|
| Výchozí stav | **Profil skrytý.** `networking_opt_in = false`, `visibility = 'hidden'`. Nově ověřený účastník není v seznamu, dokud sám nezapne. |
| Granularita viditelnosti | Toggle se 3 úrovněmi: `hidden` (nikdo), `attendees` (jen účastníci), `speakers_partners` (i řečníci/partneři kvůli leadům). |
| Co je povinné vs. volitelné | Pro zapnutí networkingu stačí jméno + firma. **Foto a bio volitelné** (data minimization). |
| Odvolatelnost | Vypnutí opt-inu okamžitě (do pár sekund přes Realtime) odstraní profil ze seznamů a zruší viditelnost; existující schůzky zůstanou, ale kontakt se dál nešíří. |
| Anti-ghost-town vs. soukromí | Onboarding **nabízí** zapnutí networkingu s jasným popisem hodnoty, ale nevynucuje. Nikdy ne dark-pattern (předzaškrtnuto). |
| Blokování / mute | Účastník může druhého **zablokovat** → vzájemně skryje profily a znemožní DM/žádost o schůzku. |

Priorita: **MUST · M.**

### 7. Data minimization

- **Sbírej jen nutné:** povinné jen jméno, e-mail, firma, kód objednávky. Vše ostatní (foto, bio, telefon, dieta) volitelné a účelově vázané.
- **Žádné nadbytečné custom pole** ve SimpleShop formuláři "pro jistotu" — každé pole musí mít účel v mapě §4.
- **Q&A a hlasování** ukládat **pseudonymně** (interní user_id pro rate-limit), zobrazovat anonymně, po session možnost úplné anonymizace (smazat vazbu na user_id).
- **Logy:** IP a user-agent jen u auth/security eventů, ne u běžných čtení.
- **Telefon nesbírat**, pokud není explicitní funkce, která ho potřebuje.

### 8. Retenční politika a automatický výmaz

Implementováno jako **scheduled job** (Supabase pg_cron / Edge Function s cronem), spuštěný den D = konec akce (19. 9. 2026).

| Data | Retence | Akce po lhůtě |
|---|---|---|
| Networking profil (foto, bio, zájmy) | D + 30 dní | DELETE / detach z profilu |
| Chat/DM, žádosti o spojení | D + 30 dní | DELETE |
| Schůzky (kdo s kým, slot) | D + 30 dní | Anonymizovat (agregát pro statistiku) |
| Push tokeny | D + 7 dní | DELETE |
| Q&A vazba na user_id | D + 14 dní | Anonymizovat (text dotazu zůstane bez autora) |
| Check-in záznamy, QR tokeny | D + 90 dní | Anonymizovat na agregát |
| Provozní kopie objednávek | D + 90 dní | DELETE (originál v účetnictví) |
| Účetní/daňové doklady | 10 let | Ponechat (zákonná povinnost) |
| Security logy | 90 dní | DELETE |
| Audit log adminu | 1 rok | DELETE |
| Marketingový souhlas + e-mail | Do odvolání | Respektovat odhlášení |

- Cron loguje, co smazal (počty), do audit logu.
- **Soft-delete grace 7 dní** u networking dat pro případ chyby, pak hard-delete.

Priorita: **MUST · M.**

### 9. Práva subjektu údajů (přístup / výmaz / přenositelnost)

| Právo | Implementace | Priorita |
|---|---|---|
| Přístup (čl. 15) | Self-service v profilu: "Stáhnout moje data" → Edge Function složí JSON ze všech tabulek daného `user_id`. | SHOULD · M |
| Přenositelnost (čl. 20) | Stejný export ve strojově čitelném **JSON** (profil, agenda, schůzky, souhlasy). | SHOULD · M |
| Výmaz (čl. 17) | Self-service "Smazat účet" → re-auth → hard-delete osobních dat napříč tabulkami (kromě účetních dokladů, kde platí zákonná retence — uživatel je informován). | MUST · M |
| Oprava (čl. 16) | Editace profilu přímo v appce. | MUST · S |
| Odvolání souhlasu (čl. 7) | Toggly v profilu (networking, marketing, partneři, push) — okamžitý zápis ConsentRecord. | MUST · S |
| Admin nástroj | `organizer` má funkci "Vyřídit GDPR žádost o e-mailu jsem@byzon.cz" → export i výmaz pro daný e-mail, s auditem kdo a kdy. | MUST · M |

- **Lhůta** na vyřízení žádosti: zpravidlo do 30 dnů (čl. 12). Eviduj žádosti v ClickUp jako úkol s deadline.

### 10. Fotky a záznamy z akce

| Rozhodnutí | Detail |
|---|---|
| Právní titul | Skupinové/dokumentační fotky a video = **oprávněný zájem + zpravodajská licence** (§ 89 obč. zák.). Individuální portrét použitý pro marketing = **souhlas**. |
| Informování předem | Znění v pozvánce, v Zásadách OÚ, **cedule u vstupu a u vchodů do sálů** ("Na akci se pořizují fotografie a video pro dokumentaci a propagaci"). |
| Opt-out | **Vizuální znak** (např. jiná barva šňůrky na jmenovce / samolepka "Nefotit") → fotografové instruováni respektovat. Kontakt jsem@byzon.cz pro stažení konkrétní fotky. |
| Gala "Výjimečný Jihočech" | Oceněný předem informován a souhlasí s focením/zveřejněním (je to veřejný moment). |
| Storage fotek | Veřejně publikované fotky v běžné galerii; **interní/neretušované** v privátním Storage bucketu s přístupem jen pro `organizer`. |

Priorita: **SHOULD · S** (procesní), galerie **COULD · M**.

### 11. Bezpečnost souborů (prezentace řečníků)

| Rozhodnutí | Detail | Priorita |
|---|---|---|
| Kdo nahrává | Pouze `speaker` do **svého** slotu (RLS na `presentations.speaker_id = auth.uid()`). | MUST · S |
| Úložiště | Supabase Storage, **privátní bucket**, přístup přes krátkodobé **signed URL** (TTL 1 h), ne veřejné linky. | MUST · S |
| Kdo vidí | Default: jen řečník + organizátor. Sdílení účastníkům **až po session** a **jen pokud řečník povolí** (flag `shareable=true`). | MUST · M |
| Vodoznak | Při sdílení slidů účastníkům generovat PDF s **vodoznakem** ("BYZON 2026 — interní, nešířit", příp. e-mail stahujícího pro dohledatelnost leaku). | SHOULD · M |
| Validace uploadu | Whitelist typů (pdf, pptx), limit velikosti (např. 50 MB), antivirus scan (ClamAV / Edge), žádný spustitelný obsah, zobrazování přes viewer ne přímé spuštění. | MUST · M |

### 12. Moderace a zneužití (Q&A, chat)

| Hrozba | Opatření | Priorita |
|---|---|---|
| Spam v Q&A | Rate limit 1 dotaz / 20 s; duplicitní detekce; **pre-moderace** dotazů u klíčových sessions (flag `approved` přes RLS, viditelné až po schválení `staff`). | MUST · M |
| Harassment v chatu/DM | Tlačítko **Nahlásit** u každé zprávy/profilu → fronta pro `organizer`; možnost **blokovat** uživatele; profanity filtr (CZ/EN slovník) jako první linie. | SHOULD · M |
| Zneužití schůzek (spam žádostí) | Limit počtu odeslaných žádostí / den; po opakovaném nahlášení dočasný mute. | SHOULD · S |
| Nevhodný profil/foto | Report → organizer může profil skrýt; foto prochází lehkou kontrolou (manuální u prvního ročníku). | SHOULD · S |
| Eskalace | Code of Conduct akce publikovaný v appce; organizer může účet **suspendovat** (role → guest) bez smazání dat (pro důkaz). | SHOULD · S |
| Audit moderace | Každý moderační zásah (skrytí, suspend, smazání zprávy) loguje do audit logu (kdo, co, kdy, důvod). | MUST · S |

### 13. Incident response

- **Detekce:** alerty na anomálie (prudký nárůst auth chyb, hromadný export, pád RLS) přes Supabase logy + Cloudflare; klíčové eventy do audit logu.
- **Plán (runbook):** dokument v repo/ClickUp — kdo je incident owner (technický kontakt), kroky: izolovat (revokovat klíče, vypnout endpoint), posoudit rozsah, zaznamenat.
- **Notifikační povinnost:** porušení zabezpečení OÚ s rizikem → **ohlášení ÚOOÚ do 72 hodin** (čl. 33); při vysokém riziku informovat subjekty (čl. 34). Připravená šablona oznámení.
- **Revokace:** postup na okamžitou rotaci service-role klíče, VAPID, SimpleShop API klíče.
- **Cvičení:** 1 tabletop test cca měsíc před akcí.

Priorita: **MUST · S** (runbook), **SHOULD · S** (tabletop).

### 14. Zálohy a kontinuita

| Prvek | Rozhodnutí | Priorita |
|---|---|---|
| DB zálohy | Supabase automatické denní backupy (PITR dle tier). Před akcí **manuální snapshot** ráno D-day a po každém dni. | MUST · S |
| Export seedu | `content.json` zůstává single source pro program → app data jen importuje; obnovitelné re-seedem. | MUST · S |
| Účastnická data | Denní export `tickets`/`profiles` do šifrovaného off-site úložiště (EU). | SHOULD · S |
| Fallback registrace/check-in | Offline režim PWA + **lokální cache seznamu** pro check-in; při výpadku WiFi staff skenuje lokálně, sync později. Papírová záloha seznamu VIP. | SHOULD · M |
| Degradace | Pokud spadne Realtime (Q&A) → fallback na embed **Slido** (viz architektura). Pokud spadne app → web zůstává (statický, nezávislý). | SHOULD · S |
| RTO/RPO | Cíl: RPO ≤ 24 h (denní záloha), RTO ≤ 4 h během akce (restore + re-seed). | SHOULD · S |

### 15. DPA s dodavateli a EU/EEA data residency

| Dodavatel | Role | DPA / opatření | Data residency |
|---|---|---|---|
| **SimpleShop / Redbit (Vyfakturuj)** | Zpracovatel (ticketing, platby) | Uzavřít DPA (čl. 28); API klíč jen server-side | ČR/EU |
| **Supabase** | Zpracovatel (DB, auth, storage) | DPA (Supabase nabízí); **zvolit EU region** (Frankfurt) | EU |
| **Hosting app (Cloudflare Pages / Vercel)** | Zpracovatel (běh frontendu) | DPA + EU/SCC; statický web na FTP zůstává v EU | EU |
| **E-mail / SMTP** (magic-link, transakční) | Zpracovatel | Volit **EU providera** (např. SMTP přes EU); DPA | EU |
| **Web Push** | Browser push služby (FCM/Apple) jsou mimo přímou kontrolu | Posílat jen token + minimální payload, žádná osobní data v notifikaci | mimo EU (token-only, bez OÚ) |
| **Analytika** | Pokud nasazena | Preferovat **EU/privacy-friendly** (Plausible EU, Matomo self-host EU) místo GA | EU |

- **Pravidlo:** žádný US provider bez SCC / EU-US Data Privacy Framework. Default volba = EU lokace u DB, hostingu i e-mailu.
- **Seznam zpracovatelů** zveřejnit v Zásadách OÚ.

Priorita: **MUST · S** (smluvní), **MUST · S** (volba EU regionů při setupu).

### 16. Cookie / consent banner

- **Statický web dnes:** minimální cookies → stačí informační lišta. **Jakmile přibude analytika nebo SimpleShop iframe s tracking cookies**, je nutný **opt-in banner** (zák. 127/2005 Sb. + ePrivacy): kategorie **nezbytné / analytické / marketingové**.
- **Blokovat ne-nezbytné skripty do udělení souhlasu** (SimpleShop iframe z `form.simpleshop.cz`, analytika, remarketing pixely).
- Volba uložená jako consent cookie + záznam (verze, čas).
- **App `app.byzon.cz`:** funkční cookies (session) jsou nezbytné → bez souhlasu; analytika/push opt-in zvlášť.
- Reuse stejné consent logiky na webu i v app.

Priorita: **MUST · S** (web), **MUST · S** (app).

### 17. Aktualizace Zásad ochrany osobních údajů a dokumentace

Aplikace zavádí **nové kategorie zpracování** → nutná revize právní dokumentace **před spuštěním app**:

- **Zásady ochrany OÚ** rozšířit o: networking a sdílení profilu mezi účastníky, schůzky/zprávy, lead retrieval pro partnery, fotky/video, push notifikace, seznam zpracovatelů (Supabase, hosting, SMTP), retenční lhůty, nový backend (`app.byzon.cz`), práva a kontakt.
- **Záznamy o činnostech zpracování (čl. 30):** doplnit nové činnosti (networking, check-in, lead retrieval, push).
- **Verzování:** každá verze Zásad má číslo a datum; `policy_version` se ukládá do ConsentRecord.
- **Code of Conduct** akce publikovat v app (podklad pro moderaci/suspend).
- **VOP** zkontrolovat ohledně zpracování plateb a storno (beze změny architektury, ale konzistence textů).
- **Posouzení DPIA:** vzhledem k matchmakingu a sdílení profilů zvážit lehké **DPIA** (čl. 35) — pravděpodobně postačí zjednodušené, ale zdokumentovat rozhodnutí.

Priorita: **MUST · M** (právní revize před launch).

### Shrnutí priorit (bezpečnost & GDPR jádro)

| MUST (před launch) | SHOULD | COULD |
|---|---|---|
| Magic-link auth, role+RLS, párování vstupenky, rate limiting, ConsentRecord, networking privacy-by-default, retenční cron, právo na výmaz, DPA+EU residency, cookie banner, aktualizace Zásad OÚ, incident runbook, audit log | Export/přenositelnost dat, vodoznak slidů, moderace/report chatu, profanity filtr, fallback check-in offline, tabletop test, DPIA | Galerie fotek s opt-out znakem, pokročilý scoring leadů, automatický AV scan příloh |

Relevantní cesty v repu pro navázání implementace: `/home/user/byzon-2026/build.py`, `/home/user/byzon-2026/data/content.json` (zdroj pro seed agendy/řečníků do app DB; právní stránky VOP a Zásady OÚ ke commitnuté revizi).
