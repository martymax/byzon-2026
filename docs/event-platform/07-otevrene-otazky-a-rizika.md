# Otevřené otázky, rozhodnutí a kontrola úplnosti

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Rešerše (příloha) »](./99-reserse.md)

---

## Otevřené otázky a rozhodnutí

Číslovaný seznam blokujících otázek pro pořadatele (ENJOiT). U každé je kontext a **doporučená default volba**, aby tým mohl rozhodnout rychle a stavět se mohlo začít.

1. **Rozsah pro 2026: stavíme app letos, nebo až 2027?**
Akce je za ~12 týdnů (18.–19. 9. 2026), Early Bird končí už za 4 dny (30. 6.). Plný rozsah (vlastní Q&A, matchmaking, schůzky, gamifikace) se do září reálně nepostaví ani neodladí na stovkách lidí. *Default:* **Jet jen Fáze 0+2 MVP pro 2026** (registrace/účty, read-only agenda v PWA, check-in, oznámení+push, Slido embed pro Q&A/ankety). Networking, schůzky, speaker portal a admin CMS odložit na 2027. Bez tohoto rozhodnutí je celá roadmapa nereálná.

2. **Rozpočet a model dodání (interní vs. dodavatel)?**
Plán implicitně předpokládá vývojáře se SvelteKit + Supabase + Postgres RLS znalostí. Nikde není uvedeno, kdo to píše ani za kolik. *Default:* Stanovit strop (např. 150–300 tis. Kč na MVP 2026) a rozhodnout, zda interní kapacita, nebo externí dodavatel; pokud externí, MVP scope dle Q1 je jediný realistický.

3. **Kdo aplikaci provozuje a vlastní po akci (mezi ročníky)?**
Supabase projekt, doména `app.byzon.cz`, secrets (SimpleShop API key, GitHub token, VAPID, Postmark) a GDPR retence vyžadují vlastníka i mimo akci. Statický web je dnes "nula údržby"; app to mění. *Default:* Určit jmenovitě jednoho člověka jako technického vlastníka + smluvní SLA s dodavatelem na měsíce kolem akce; mimo sezónu Supabase na free/paused tier.

4. **Vlastnictví dat a role zpracovatele (GDPR).**
Správce je ENJOiT, ale Supabase, Cloudflare, Postmark/SMTP, Slido a případný dodavatel jsou **zpracovatelé** — ke každému je nutná **smlouva o zpracování (DPA)** a záznam v ROPA. Slido navíc může znamenat předání dat mimo EU. *Default:* Před spuštěním uzavřít DPA se všemi zpracovateli; preferovat EU-region varianty; pokud Slido nesplní EU/DPA, padá na vlastní Q&A nebo se Q&A pro 2026 nepustí.

5. **SimpleShop: máme reálně webhook + API v2, nebo jen CSV export?**
Celé párování účtů stojí na "Webhook po platbě" + REST API v2 s API klíčem. Není ověřeno, že daný SimpleShop plán/tarif tyto funkce má a že formulář `0MnNQ` sbírá e-mail + potřebná custom pole (firma, IČ, dieta, networking opt-in). *Default:* **Začít CSV/JSON importem jako primární cestou** (ne fallbackem) a webhook nasadit, jen pokud se API ověří; do formuláře doplnit chybějící pole hned (než skončí Early Bird).

6. **Firemní / hromadné nákupy — kdo je účastník?**
Ceny "od 3 990 Kč" napovídají více tierů a hromadné nákupy. E-mail kupujícího ≠ e-mail účastníka. Plán to zmiňuje, ale tok přiřazení jmen je jen "SHOULD". Pro check-in a jmenovky je to ale MUST. *Default:* MUST už pro 2026 — jednoduchý tok "kupující přiřadí jména/e-maily k vstupenkám" + možnost doplnit jméno až na recepci.

7. **Jazyk: stačí čeština, nebo je nutná EN?**
Publikum je "čeští podnikatelé", web je `cs`. Vícejazyčnost je v plánu jako COULD, ale `accounts.locale` a `lang` u sessions to předpokládají. *Default:* **Pro 2026 jen čeština** (žádná i18n infrastruktura), `locale` ponechat v modelu jako rezervu.

8. **Kapacita a tier-limity vstupenek — jaká reálná čísla plánovat?**
"Odhad stovky účastníků", `capacityHint: 400`, workshopy s `capacity`. Bez konkrétních čísel nelze dimenzovat check-in fronty, kapacity workshopů, meeting pointy ani Supabase tier. *Default:* Vyžádat tvrdá čísla: celková kapacita, kapacita 2 workshopů, počet stagů/místností, počet staff na check-inu.

9. **Check-in hardware a konektivita na místě.**
Check-in přes QR sken předpokládá zařízení (telefony/tablety staff), stabilní WiFi/LTE a tiskárnu jmenovek. Hotelová WiFi je v plánu označena jako rizikový bod. *Default:* Min. 2–3 staff zařízení + offline režim skeneru (cache seznamu, sync po obnově) + LTE záloha; jmenovky předtištěné dle objednávek jako fallback bez appky.

10. **Build vs. buy pro Q&A/ankety a pro celou app.**
Plán doporučuje Slido embed pro 2026, ale zároveň drží "vlastní Q&A" jako SHOULD/L. Hrozí, že se postaví obojí. *Default:* **Pro 2026 výhradně Slido**, vlastní Q&A vůbec nezačínat; rozhodnout až podle zkušenosti z 2026.

11. **"Výjimečný Jihočech 2026" — hlasuje se v aplikaci?**
Gala s předáváním cen je marketingově nosné. Není jasné, zda jde o veřejné/účastnické hlasování (a tím právní a anti-fraud nároky) nebo o porotu. *Default:* Pro 2026 **bez app hlasování** (porota offline); případný "live moment" jen jako oznámení.

12. **Lead retrieval pro partnery — je to slíbené v partnerských balíčcích?**
Sken QR účastníků partnery je SHOULD, ale pokud už je to prodané v partnerské nabídce, stává se to MUST se závazným termínem a explicitním opt-inem účastníka. *Default:* Ověřit obsah partnerských smluv; pokud slíbeno, povýšit na MUST a dořešit consent „sdílet kontakt partnerovi".

13. **Kdo moderuje live obsah a publikuje oznámení během akce?**
Q&A moderace, push oznámení a news feed potřebují jmenovitě obsazenou roli na místě (kdo, na jakém zařízení, kdo je záloha). *Default:* Určit moderátora per stage + jednoho "comms" člověka na push; sepsat eskalační postup pro změny v programu.

14. **Doménová a DNS realita (`app.byzon.cz`, `admin.byzon.cz`, `api.byzon.cz`).**
Plán používá tři subdomény + Cloudflare. Není jisté, kdo spravuje DNS k `byzon.cz` (FTP hosting vs. samostatný registrátor) a zda jde nasměrovat na Cloudflare Pages. *Default:* Ověřit přístup k DNS před startem; minimalizovat na jedinou subdoménu `app.byzon.cz` pro 2026 (admin jako route `/admin`, ne vlastní doména).

15. **Souhlas s pořizováním a publikací fotek/záznamu (účastníci, ne jen řečníci).**
Plán řeší consent řečníků, ale fotogalerie/social wall/záznam zachycují i účastníky. *Default:* Doplnit photo/recording consent do registračního/onboardingového toku a viditelné značení "natáčí se" v sále.

## Kontrola úplnosti a rizika

### A. Co v návrhu chybí (funkce, edge-case, provoz, právo, role)

| Mezera | Proč to vadí | Priorita | Slož. |
|---|---|---|---|
| **Refund / storno / změna objednávky** ze SimpleShopu | Webhook řeší jen "po platbě". Vrácení/zrušení/změna množství nezneplatní ticket ani check-in oprávnění → na recepci projde stornovaná vstupenka. | MUST | M |
| **Přeprodej a kontrola kapacity vstupenek** | Prodej běží v SimpleShopu, app o limitech neví; nikde není reconcil mezi prodanými a kapacitou sálu. | SHOULD | S |
| **Onboarding/empty-state strategie ("ghost town")** | Networking i agenda jsou prázdné, dokud lidé nevyplní profil. Plán to zmiňuje u adresáře, ale chybí plán "seedování" (předvyplnit z objednávky, gamifikace dokončení profilu, kdy zapnout viditelnost). | MUST | S |
| **Provoz transakčních e-mailů: doménová autentizace** | Magic-link i připomínky stojí na deliverabilitě. Chybí SPF/DKIM/DMARC pro `byzon.cz`, jinak skončí v spamu a celá aktivace selže. | MUST | S |
| **Rate-limiting a anti-abuse na magic-link / OTP / webhook** | Bez limitů hrozí e-mail bombing, OTP brute-force, zahlcení webhooku. Bezpečnostní sekce zmiňuje rate-limit jen u Q&A. | MUST | S–M |
| **Idempotence a fronta odchozích e-mailů** | "Aktivuj účet" se nesmí poslat 2× při re-sendu webhooku; chybí explicitní `sent_at` guard napříč všemi notifikacemi (plán to má jen u aktivace). | SHOULD | S |
| **GDPR self-service: export + výmaz účastníka** | Bezpečnostní sekce zmiňuje re-auth pro výmaz, ale chybí konkrétní DSAR workflow (lhůta 30 dní, kdo vyřizuje, jak smazat napříč tabulkami i Storage a Slido). | MUST | M |
| **Retence a "co po akci"** | Kdy se smažou Q&A/zprávy/networking data, kdy se app vypne, co s účty do 2027. Zmíněno jen volně ("30–90 dní"). | SHOULD | S |
| **Migrace/seed idempotence při změně programu** | Re-seed z `content.json` po editaci nesmí rozbít FK z agendy/Q&A na sessions. Závisí na stabilních `id`, které dnešní `content.json` nemá — to je skrytá vstupní práce. | MUST | M |
| **Stav offline / špatná WiFi pro check-in i live** | Degradace zmíněna jako princip, ale chybí konkrétní offline scan buffer a konfliktní řešení duplicitního check-inu. | MUST | M |
| **Accessibility v PWA** | Marketing web má důraz na ARIA/skip-link/reduced-motion; u nové app to v plánu mizí. Měl by to zdědit (deklarovat jako acceptance kritérium). | SHOULD | S |
| **Cookie/consent banner v app** | Analytika (Plausible je sice cookieless), Slido, případné další embeddy → potřeba consent UX i v app. | SHOULD | S |
| **Role "kouč" / koučovací zóna a "afterparty"** | `co_vas_ceka` zmiňuje koučovací zónu a afterparty; datový model rolí (attendee/speaker/partner/organizer/staff/moderator) je nepokrývá. | COULD | S |
| **Notifikace bez push (iOS web push omezení)** | Web Push na iOS funguje jen pro nainstalovanou PWA (A2HS). Plán s tím nepočítá → velká část publika push nedostane. Nutný e-mail/SMS fallback pro kritická oznámení. | SHOULD | M |
| **Stav "speaker je i attendee"** v UI a oprávněních | Datový model to řeší (více rolí), ale toky onboardingu a navigace mezi speaker-portal a běžnou app nejsou popsané. | SHOULD | S |

### B. Nekonzistence mezi doménami

| # | Nekonzistence | Detail |
|---|---|---|
| 1 | **Dvojí pojmenování stejných tabulek** | `f_registrace` používá `accounts`/`profiles`/`tickets`/`orders` (anglicky, lower-case), `a_datovymodel` používá `User`/`AttendeeProfile`/`Order`/`Ticket` (PascalCase), `f_networking` má `attendee`/`attendee_intent`/`connection`. Tři různá schémata pro tutéž doménu. Nutno sjednotit jeden kanonický datový slovník **před** implementací. |
| 2 | **Profil: jedna tabulka, nebo dvě?** | `f_registrace`/`a_datovymodel` mají oddělené `accounts`+`profiles` (1:1, opt-in). `f_networking` slévá identitu i networking do jedné `attendee`. Rozdílná RLS i privacy model. |
| 3 | **Párovací klíč na SimpleShop** | Místy "e-mail", místy "order_code", místy "e-mail + order_code". Bezpečnostní dopad (order_code jako jednorázový token vs. trvalý identifikátor) je různý. Sjednotit. |
| 4 | **Počet řečníků: 12 vs. 14** | Hero v `content.json` i badge říká "14 speakerů", ale `speakers.list` má reálně **12**. Speaker portal plánuje "~14". Reálné číslo je 12 — ovlivňuje deadliny a kapacitu portálu. |
| 5 | **Q&A: Slido vs. vlastní** | `a_architektura` říká jasně "Q&A nekódovat, embednout Slido", `f_live` ho má jako MUST vlastní + Slido jen fallback. Roadmapa drží obojí (řádky "Slido embed" MUST a "vlastní" SHOULD). Riziko duplicitní práce — viz Q10. |
| 6 | **Sloty schůzek vs. program** | Networking generuje `meeting_slot` z events typu break/networking/meal, ale agenda doména přejmenovává/rozšiřuje typy a zavádí ISO časy. Pokud se nezavede stabilní `id`+`start/end` jako první, networking sloty se rozbijí při každém re-buildu. |
| 7 | **Admin publikace přes GitHub API vs. FTP deploy** | Admin doména commitne `content.json` do GitHubu a očekává "Actions/deploy → FTP". Repo ale **nemá CI/CD** (žádné `.github/workflows`), deploy je dnes manuální na FTP. Tento automatický pipeline je nepodložený předpoklad, ne hotová věc. |
| 8 | **`timeDisplay` vs. dnešní `time`** | Agenda zavádí `start/end/timeDisplay`, ale `build.py` dnes čte `time` string. Migrace `content.json` a úprava `build.py` jsou nutné a nikde nejsou v odhadech rozpočtovány jako "změna statického jádra" (což plán jinak slibuje nedělat). |

### C. Nejrizikovější / nejdražší předpoklady (co může plán shodit)

1. **Termín.** 12 týdnů na PWA + Supabase + RLS + SimpleShop integraci + check-in + onboarding stovek lidí je extrémně napjaté, navíc přes léto/dovolené. **Nejpravděpodobnější příčina selhání.** Mitigace: tvrdě řezat na MVP (Q1), feature-freeze ~3 týdny před akcí, generální zkouška check-inu na ~20 lidech.
2. **SimpleShop API/webhook nemusí existovat nebo nést potřebná pole.** Pokud webhook+API v2 nejsou v tarifu, padá automatické párování → ručně přes CSV. Mitigace: ověřit hned, postavit CSV cestu jako primární (Q5).
3. **"Statický web zůstane beze změny" je porušeno hned na startu.** Stabilní `id`, ISO časy a admin-publish do `content.json` vyžadují úpravu `content.json` schématu i `build.py`. To je práce navíc a regresní riziko pro fungující web. Mitigace: ohraničit a otestovat tuto migraci jako samostatný, reverzibilní krok ve Fázi 0.
4. **Adopce účastníky.** Pokud si app nainstaluje/aktivuje málo lidí, networking i live engagement jsou prázdné a investice se nevrátí. Mitigace: aktivovat při koupi, magic-link v potvrzovacím e-mailu, na místě QR + incentiva, fallback na web bez loginu pro read-only agendu.
5. **iOS Web Push omezení.** Klíčový "jediný kanál pravdy" (oznámení o změnách) nemusí na velké části telefonů fungovat bez instalace PWA. Mitigace: e-mail/SMS pro kritická oznámení, jasná A2HS výzva.
6. **Provoz po akci a bus-factor.** Bez jmenovaného vlastníka a DPA se z "nula údržby" stane trvalá zátěž a právní expozice. Mitigace: Q3 + Q4.
7. **Slido jako externí závislost na datech a brandu.** Ztráta jednotných dat, GDPR transfer, omezení free tieru (počet účastníků/anket). Mitigace: ověřit limity a EU/DPA před slíbením funkce.

### D. Konkrétní doporučení na zlepšení plánu

1. **Zamknout jeden kanonický datový slovník** (názvy tabulek, sloupců, párovací klíč, profil 1:1 vs. sloučený) jako první deliverable Fáze 0 — vyřeší nekonzistence B1–B3.
2. **Přesunout "stabilní `id` + ISO `start/end` + migrace `build.py`" na úplný začátek Fáze 0** jako blokující úkol; bez něj se rozpadne agenda i networking sloty (B6, B8, C3).
3. **CSV import jako primární, webhook jako enhancement** — sníží závislost na neověřeném SimpleShop API (Q5, C2).
4. **Explicitně rozhodnout scope 2026 = redukovaný MVP** a vše ostatní označit "2027" v roadmapě, ne držet dlouhý MUST seznam, který tým psychologicky tlačí stavět vše (Q1, C1).
5. **Doplnit chybějící MUST funkce**: refund/storno tok, GDPR export+výmaz workflow, e-mail doménová autentizace (SPF/DKIM/DMARC), rate-limiting magic-linku/OTP, offline check-in buffer.
6. **Ověřit existenci deploy pipeline** (žádné `.github/workflows` v repu) — buď ji postavit, nebo admin-publish degradovat na "vygeneruj `content.json` ke stažení a nahraj ručně na FTP" pro 2026 (B7).
7. **Definovat acceptance kritéria zděděná z marketingu**: a11y (ARIA, skip-link, reduced-motion), brand tokeny, výkon — aby app neklesla pod úroveň webu.
8. **Naplánovat generální zkoušku check-inu a aktivace účtů** na malém vzorku (~14 řečníků + tým) ~2–3 týdny před akcí jako gate před ostrým provozem.
9. **Opravit obsahovou nekonzistenci 12 vs. 14 řečníků** v `content.json` (hero/badge) nezávisle na app — drobné, ale viditelné (B4).
10. **Sjednotit Q&A rozhodnutí**: pro 2026 výhradně Slido, "vlastní Q&A" přesunout do 2027 backlogu, ať se neobjevuje jako paralelní MUST/SHOULD (B5, Q10).
