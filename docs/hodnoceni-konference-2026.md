# Hodnocení konference BYZON 2026

Dotazník je součástí účastnické aplikace na `/app/hodnoceni`. Odkaz je v **Můj účet → Hodnocení konference** a používá ho i stávající připomenutí e-mailem. Bez přihlášení stránka nabídne přihlášení s návratem na hodnocení. Odpovídat může aktivní účastník dané konference.

## Úvod pro účastníka

**Jaký byl váš BYZON?**

Děkujeme za zpětnou vazbu. Pomůže nám připravit další ročník.

Vyplnění je dobrovolné. Otázky označené * potřebujeme k odeslání. Odpověď se ukládá k vašemu účtu a není anonymní.

Rozpracované odpovědi zůstávají při přecházení mezi kroky na této stránce. Uloží se až po odeslání.

## Otázky

1. **Něco o vás** – dobrovolné: pohlaví včetně „Nechci odpovídat“ a „Jiné“, město/obec, způsob získání vstupenky (firma, vlastní nákup, organizační tým, řečník, jinak).
2. **Přednášky a řečníci** – dobrovolné hodnocení jednotlivých letošních vystoupení, seskupených podle dne a stage. Nabídka se načítá ze zveřejněného programu. U každého vystoupení lze uvést, že se ho účastník nezúčastnil. Nevyplněná vystoupení se přeskočí.
3. **Koučování a workshopy** – účast ano/ne*. Pokud ano: hodnocení aktivity* a dobrovolný komentář. U workshopů navíc dobrovolné hodnocení jednotlivých workshopů a mastermindů z letošního programu.
4. **Občerstvení a networking** – hodnocení oběda*, coffee breaků* a networkingu*, pokaždé s možností „Nevyužil/a jsem“ a dobrovolným komentářem.
5. **Web a účastnická appka** – dvě samostatná hodnocení a komentáře (přesné znění níže).
6. **Partneři konference** – dobrovolně: „Které partnery konference si vybavíte (mimo svou firmu)?“ Nabídka partnerů se nezobrazuje, aby nenapovídala.
7. **Konference celkově** – organizace před konferencí*, organizace během konference*, celkové hodnocení*, zájem o příští ročník*. Dobrovolně: co se povedlo/co zlepšit, tip na řečníka nebo téma, sledování Instagramu @byzoncz.

### Web a appka – přesné znění

- **Jak hodnotíte web konference byzon.cz?*** Čtyřbodová škála + „Web jsem nepoužil/a“.
- **Co na webu fungovalo a co máme zlepšit?** Dobrovolný komentář. Nápověda: „Například přehlednost, informace o programu nebo nákup vstupenky.“
- **Jak hodnotíte účastnickou appku?*** Čtyřbodová škála + „Appku používám až teď k hodnocení“.
- **Co v appce fungovalo a co vám chybělo?** Dobrovolný komentář. Nápověda: „Například přihlášení, program, vlastní agenda, rezervace, networking nebo oznámení.“

### Škály

| Odpověď                    | Uložená hodnota                  |
| -------------------------- | -------------------------------- |
| Spokojen/a                 | 4                                |
| Spíše spokojen/a           | 3                                |
| Spíše nespokojen/a         | 2                                |
| Nespokojen/a               | 1                                |
| Nenavštívil/a / nepoužil/a | `null`, nezapočítávat do průměru |

Celkové hodnocení zachovává možnosti z roku 2025: Výborná (5), Velmi dobrá (4), Dobrá (3), Průměrná (2), Slabá (1). Zájem o další ročník: Určitě ano / Spíše ano / Spíše ne / Určitě ne. Rok se odvozuje od termínu konference, pro BYZON 2026 tedy 2027.

Žádná známka není předvybraná. Čtyřbodová spokojenost a pětibodové celkové hodnocení jsou oddělené škály. Pro srovnání s rokem 2025 je nutné zohlednit dobrovolnost osobních a otevřených otázek i jiné složení respondentů.

## Odeslání a dostupnost

- Dotazník se zpřístupní až po `event.endsAt`, pokud je v administraci povolena funkce hodnocení (`ratingsEnabled`). Čas i oprávnění kontroluje také server.
- Jedna odpověď na účastníka a konferenci; po odeslání ji nelze upravit. Po opětovném otevření se zobrazí poděkování.
- Opakovaný pokus po nepotvrzeném odeslání zachovává klíč požadavku. Databáze brání duplicitám i při souběžném odeslání.
- Rozpracované odpovědi jsou pouze v paměti stránky. Přechod mezi kroky je zachová; obnovení nebo opuštění stránky je ztratí. Při obnovení/zavření se prohlížeč pokusí upozornit na neodeslané změny. Odhlášení a změna účtu koncept vymažou.
- Po odeslání se nabídne dobrovolný odkaz na veřejnou recenzi na Facebooku. Recenze není podmínkou odeslání.

## Podklad a úpravy oproti roku 2025

Podkladem je deset dodaných snímků. Mezi úvodem a BYZON stage chybí ve snímcích stránka označená 2/8; její obsah není domýšlen. Všechny doložené tematické části jsou zahrnuté.

Dlouhé vodorovné tabulky nahrazují otázky použitelné na mobilu. Názvy řečníků, stagí a vystoupení pocházejí z letošního zveřejněného programu, loňská jména se nepřenášejí. Workshopy nejsou omezené jen názvem „sobotní“, aby pokryly skutečný letošní program. Povinné textové otázky na nenavštívené aktivity nahrazují volby ano/ne s podmíněnými detaily.

## Technické předání

Migrace `packages/database/drizzle/0032_event_survey.sql` přidává nullable sloupec `ratings.survey` (JSONB). Migrace a nový backend musí být nasazeny spolu. Původní záznamy i jednoduché hodnocení přednášek zůstávají kompatibilní. Nový dotazník se ukládá atomicky s celkovou známkou do jednoho záznamu. `survey.version = 1` určuje verzi dotazníku, `survey.programVersion` verzi zveřejněného programu; jednotlivé odpovědi odkazují na session ID. Obsah jde dohledat v neměnné publikaci programu pro danou konferenci a verzi.

Hodnocení jednotlivých vystoupení uvnitř dotazníku používá loňskou škálu 1–4. Jde o součást dotazníku, nikoli další zápisy do samostatného hodnocení přednášek 1–5. Při vyhodnocení je neslučovat bez sjednocení škály.

Release navazuje na aktuální `main` a nasazuje se přes Git integraci do stávajícího Railway prostředí `production` (runtime nadále používá `APP_ENV=staging`). Migrace přidává pouze nový sloupec; seed, import obsahu ani změna přepínače hodnocení se nespouštějí. Při kontrole před nasazením bylo hodnocení povolené a konec konference nastavený na 19. 9. 2026 v 18:30 Europe/Prague.

Před nasazením prošel build webu i workeru, lint, formátování, migrace v oddělené prázdné databázi, 71 cílených serverových a jednotkových testů a 39 browser testů na telefonu, tabletu a desktopu. Zahrnuty jsou také regrese existujícího hodnocení přednášek a moderace dotazů.
