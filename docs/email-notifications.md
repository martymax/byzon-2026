# E-maily BYZON

Implementované šablony najdete v [galerii](email-preview/index.html). Galerie
vzniká ze stejného rendereru jako odesílané zprávy. Obsahuje syntetická jména
a nefunkční odkazy na `app.example.test`; pouze adresy obrázků a fontů jsou
nahrazené lokálními soubory.

| E-mail                     | Spuštění a příjemce                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Pozvánka účastníka         | Odeslání pozvánky organizátorem; aktivační odkaz 24 hodin.                                                  |
| Pozvánka do týmu           | Pozvánka člena týmu; administrace, odkaz 24 hodin.                                                          |
| Aktivace účtu              | Samoobslužná aktivace; odkaz 24 hodin.                                                                      |
| Přihlášení                 | Vyžádání jednorázového přihlášení; odkaz 30 minut.                                                          |
| Potvrzení rezervace        | Úspěšná rezervace; jeden e-mail k rezervaci.                                                                |
| Zrušení rezervace          | Zrušení účastníkem, nahrazení jinou rezervací nebo zrušení organizátorem.                                   |
| Zařazení do čekací listiny | Potvrzuje čekání; výslovně uvádí, že místo ještě není rezervované.                                          |
| Odhlášení z čekací listiny | Úspěšné odhlášení účastníkem.                                                                               |
| Uvolněné místo             | Automatický postup z čekací listiny; rezervace už je potvrzená.                                             |
| Změna programu             | Publikování významné změny. Souhrn jen účastníkům s dotčeným bodem v agendě, rezervaci nebo čekací listině. |
| Oznámení organizátora      | Stávající náhled a odeslání oznámení nyní zakládá také e-maily stejným příjemcům.                           |
| Hodnocení konference       | Jednou, nejdříve 12 hodin po konci konference, pouze bez vyplněného hodnocení; odkaz na `/app/hodnoceni`.   |

## Obsah a oslovení

Společný balíček `packages/mail` vytváří předmět, preheader, HTML a prostý
text. Používá původní logo, fonty Khand/Inter se systémovými náhradami,
švestkovou hlavičku a růžová tlačítka s tmavým textem. HTML má tabulkovou
strukturu, inline styly, mobilní úpravy, tmavý režim a VML tlačítko pro Outlook.
Důležitý obsah funguje bez obrázků i webfontů. Veřejná aktiva nejsou sledovací pixely.

Platnost v textu přihlašovacích zpráv se předává ze skutečného nastavení
Better Auth. Tlačítko a náhradní odkaz obsahují totožnou URL. Odkazy se
kontrolují proti původu aplikace; obsah se escapuje. Přihlašovací tokeny
se neukládají do notifikační fronty ani provozních logů.

`packages/mail/src/salutation.ts` obsahuje kontrolovaný slovník křestních
jmen pro 5. pád: Martin → Martine, Jana → Jano, Petr → Petře.
Nejde o obecné skloňování všech pádů. Jména se normalizují do Unicode NFC;
neznámá, složená nebo neplatná jména mají pozdrav „Dobrý den,“.
Neodhadujeme pohlaví, neodstraňujeme diakritiku a nerozebíráme celá jména
ani e-mailové adresy. Rodové minulé časy v automatických textech nepoužíváme.

V profilu lze zvolit automatické oslovení, vlastní tvar nebo pozdrav bez jména.
`email_salutation = NULL` znamená slovník, prázdný řetězec znamená bez jména.
Vlastní oslovení má přednost. Tým bez strukturovaného profilu dostane neutrální
pozdrav. Osobní údaje načítá server, nikoli klientská metadata přihlášení.

`rating_emails_enabled` lze změnit v profilu a standardně je zapnuté.
Tato volba ovládá jediné připomenutí hodnocení; provozní zprávy zůstávají aktivní.
Hodnoty se ukládají přes verzované API profilu. Fronta se maže kaskádou při
odstranění profilu.

## Fronta a provoz

Migrace `0030_email_notifications.sql` přidává preference a tabulku
`email_deliveries`. Zařazení e-mailu probíhá ve stejné databázové transakci
jako změna rezervace, publikace či oznámení. Rollback zruší i e-mail;
unikátní klíč brání vytvoření další zprávy při opakování stejné akce.

Worker si zprávy přebírá přes `FOR UPDATE SKIP LOCKED`, používá časově
omezený zámek a nejvýše 8 pokusů s prodlužovanou prodlevou. Síťový požadavek
probíhá mimo databázovou transakci. Obsah prvního pokusu se pro opakování
zafixuje a Resend dostává stabilní idempotency key. Mailpit slouží ke stagingovým
kontrolám a jeho vlastní hlavička sama o sobě nezaručuje deduplikaci doručení.
Po dokončení se osobní podoba zprávy z fronty odstraní. Chyby obsahují jen
obecné kódy, ne adresy, tokeny nebo odpovědi poskytovatele.

Před odesláním se znovu ověřuje aktivní účastnická role a členství, ověření
účtu, požadavek na smazání a retenční hranice. Kontroluje se aktuální stav
rezervace/čekání, nejnovější publikovaný program, existence oznámení a
nastavení či vyplnění hodnocení. Neaktuální zpráva se přeskočí. Při změně
kontaktní adresy se zafixovaný pokus již neodešle na původní adresu.

Běžné notifikace expirují po 24 hodinách. Změny programu se neposílají při
první publikaci ani za již skončené aktivity. Jedna publikace znamená nejvýše
jeden souhrn na člověka, s nejvýše 20 vypsanými body a odkazem na celou agendu.
Potvrzení skupinové rezervace zahrnuje její publikované části. Koncepty
programu do e-mailů nevstupují.

Hodnocení kontroluje worker každou minutu pro aktuální ročník `byzon-2026`.
Připomenutí se vytváří pouze v intervalu 12 hodin až 7 dní po skončení a
vyžaduje dokončený onboarding. Starší ročníky se zpětně nerozesílají.
Přehled provozu administrace započítává také čekající a selhané e-maily.
Odeslané oznámení už nelze odvolat ze schránky; administrační potvrzení to uvádí.

## Nasazení a kontrola

1. Spustit `pnpm --filter @byzon/database db:migrate` proti cílové databázi
   před aktualizací webu a workeru. Migrace je přídavná a neodesílá zprávy.
2. Obě služby potřebují stejný `APP_BASE_URL`, `MAIL_PROVIDER`, `MAIL_FROM`,
   `MAIL_REPLY_TO` a konfiguraci Resend nebo stagingového Mailpitu.
   Příklady jsou v `.env.example`. Web obsluhuje také `/brand/email/*`.
3. Sestavit `pnpm build:web` a `pnpm build:worker`. Spustit oba procesy;
   bez workeru zůstanou provozní notifikace ve frontě. Neúplná produkční
   konfigurace doručení selže a zpráva se zkouší znovu.
4. Po nasazení provést doručovací kontrolu na vlastních testovacích účtech
   v cílových poštovních klientech. Lokální ověření zahrnuje PostgreSQL,
   mockované transporty a Chromium, nikoli skutečné schránky Gmail/Seznam/Outlook.

Náhledy znovu vytvoří `pnpm --filter @byzon/mail build` a
`node scripts/generate-email-preview.mjs` (nebo společně `pnpm preview:emails`).
`node scripts/check-email-preview.mjs` zkontroluje 26 variant rozložení včetně
dlouhých hodnot bez obrázků/fontů a aktualizuje screenshoty. Prohlédnout lze i
[desktop](email-preview/desktop.png), [mobil](email-preview/mobile.png)
a [tmavý režim](email-preview/dark.png).

Testy rendereru jsou v `packages/mail/src/mail.test.ts`, doručování ve
`apps/worker/src/email.integration.test.ts`. Integrační testy webu ověřují
spouštěče, opakované akce, souhrny publikace a uložení preferencí.
Browser testy ověřují oslovení, preference a odeslání hodnocení konference
na telefonu, tabletu a desktopu, včetně automatických kontrol přístupnosti.
Integrační testy vyžadují samostatnou migrovanou databázi v `TEST_DATABASE_URL`.
