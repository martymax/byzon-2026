# BYZON 2026 – Priority A frontend route map

> Stav: frontend `F0` až `F6-05` je `UI ready (mocked)`; produkční integrace a
> UAT `F6-06` až `F6-08` zůstávají otevřené
>
> Zdroj pravdy: §3.3, §7.10, §12 a §18 `AI_IMPLEMENTATION_PLAN.md`
>
> Aktualizace této mapy je povinná při změně route, role, fáze, feature flagu
> nebo datového kontraktu.

## 1. Účel a hranice

Tento dokument určuje pro každou Priority A obrazovku:

- cílovou roli a minimální serverové oprávnění;
- chování podle stavu identity, onboardingu, membership a relace;
- dostupnost podle fáze eventu a feature flagu;
- jediný primární úkol a nejvýše jednu dominantní akci;
- deep link, kanonickou route, návrat a zachování bezpečného stavu;
- datový kontrakt, offline režim a klasifikaci osobních údajů;
- povinné loading, empty, error, permission, offline/stale, pending, success a
  session-expired varianty.

Mapa je produktový a bezpečnostní kontrakt, nikoli autorizace. Server musí
vždy znovu ověřit event scope, membership, roli, permission a resource context.
Frontendový guard nesmí být jedinou ochranou route ani dat.

### 1.1 Zahrnutý rozsah

- 9 veřejných, aktivačních a recovery routes;
- 15 participant routes včetně stávajícího Priority A speaker/partner obsahu,
  detailu minimálního in-app inboxu z `F2-05` a kanonického hubu `Více`;
- 11 organizačních a check-in routes;
- celkem 35 kanonických Priority A routes, tři kompatibilní admin redirecty a
  jedna dynamická varianta obecné chyby přístupu.

### 1.2 Vyloučený rozsah

Následující routes jsou Priority B a do této mapy se zařadí až po Gate A:

- `/app/networking`, `/app/networking/[profileId]`, `/app/spojeni`,
  `/app/zpravy/[connectionId]`;
- `/app/interakce/[sessionId]`;
- `/speaker`, `/speaker/profil`, `/speaker/vystoupeni/[sessionId]`,
  `/speaker/podklady`, `/speaker/dotazy`;
- `/admin/moderace`, `/moderator/[sessionId]`, `/projection/[sessionId]`.

Jejich existence se účastníkům bez příslušné role/feature flagu nenaznačuje.

## 2. Společné kontrakty

### 2.1 Fáze eventu

| Kód | Fáze              | Výchozí frontendové chování                                                                                              |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `D` | `draft`           | Přihlášení může fungovat podle recovery policy, aktivace a participant obsah jsou zavřené. Admin připravuje event.       |
| `A` | `activation_open` | Aktivace, onboarding, příprava agendy a publikovaný obsah jsou dostupné. Check-in je v produkci ještě zavřený.           |
| `L` | `live`            | Účastnické a provozní Priority A funkce jsou aktivní podle serverových pravidel.                                         |
| `E` | `ended`           | Obsah, oznámení, vlastní agenda a privacy cesty jsou převážně read-only. Nové claimy, rezervace a check-in jsou zavřené. |
| `R` | `archived`        | Zůstává pouze přihlášení, správa relace, privacy/support cesta a oprávněné retenční/auditní admin čtení.                 |

Fáze se nikdy neodvozuje jen z času zařízení. Autoritativní je serverový
`event.status`, event timezone a případné serverové uzávěrky konkrétní session.

### 2.2 Feature flags a rozhodovací gate

| Flag nebo gate             | Routes                           | Pravidlo                                                                                                                                            |
| -------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `announcementsEnabled`     | participant a admin oznámení     | Při vypnutí zobrazit vysvětlený nedostupný stav oprávněným uživatelům; participant navigation položku lze skrýt, pokud není unread deep link.       |
| `offlineCheckinEnabled`    | `/check-in`                      | Nezapíná samotný online check-in. Povoluje pouze později schválený offline adapter po `BLOCKER-TKT-04` a provozním gate; výchozí stav je vypnuto.   |
| `publicContentSyncEnabled` | admin dashboard a obsah          | Ovlivňuje pouze sync status/akci veřejného webu, ne čtení publikovaného obsahu v aplikaci.                                                          |
| `BLOCKER-TKT-05`           | `/app/vstupenka`                 | Do uzavření gate se nesmí zobrazit skutečný skenovatelný credential. Route smí ukázat stav vstupenky a bezpečný nedostupný stav prezentační plochy. |
| `BLOCKER-AUTH-01`          | aktivace/onboarding handoff      | Do uzavření gate nesmí UI tvrdit, že pending claim vytvořil membership nebo session.                                                                |
| session reservation policy | agenda/rezervace/admin rezervace | Dostupnost akce vrací server pro konkrétní session; neexistuje globální klientský boolean, který by nahrazoval uzávěrky a kapacitu.                 |

Priority A route nesmí být podmíněna Priority B/C flagem
(`networkingEnabled`, `speakerPortalEnabled`, `questionsEnabled`,
`pollsEnabled`, `ratingsEnabled`, `socialWallEnabled`).

### 2.3 Stavy identity a přístupu

| Stav                            | Veřejné/aktivační routes                                                                    | Participant routes                                                                             | Organizační/check-in routes                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymní                        | Může otevřít `/`, aktivaci, přihlášení, offline a obecnou chybu přístupu.                   | Přesměrovat na `/prihlaseni?returnTo=…`; neprozradit membership, ticket ani existenci profilu. | Přesměrovat na `/prihlaseni?returnTo=…`; nepoužít participant onboarding jako mezikrok.                                               |
| Přihlášený bez event membership | Recovery/claim může pokračovat podle kontraktu.                                             | Stejný bezpečný access state jako anonymní nebo `/chyba-pristupu`; nerozlišovat cizí event.    | `403/404` dle serverové policy bez názvů rolí a bez eventových dat.                                                                   |
| Nedokončený onboarding          | Pokračovat na `/onboarding` a zachovat bezpečný `returnTo`.                                 | Přesměrovat na `/onboarding`; nepovolit participant data ani mutace.                           | Organizátorská role může používat admin jen pokud serverový bootstrap výslovně povolí oddělený admin onboarding; jinak `/onboarding`. |
| Membership `suspended`          | Recovery nesmí membership automaticky obnovit.                                              | `/chyba-pristupu` s podporou; vymazat osobní cache a nepovolit mutace.                         | Odebrat event scope a zobrazit bezpečný forbidden stav; check-in zařízení okamžitě přestat používat.                                  |
| Membership `revoked`            | Nový claim pouze podle auditovaného serverového rozhodnutí.                                 | `/chyba-pristupu`; vymazat osobní cache, tokeny a pending queue.                               | Stejně jako suspended; žádné stale admin/operátorské DTO nesmí zůstat viditelné.                                                      |
| Expirovaná relace               | `/prihlaseni` se safe `returnTo`; ticket kód ani one-time token se do `returnTo` nepřenáší. | `/prihlaseni` se safe `returnTo`, po loginu obnovit route, filtr a ne-citlivý draft.           | `/prihlaseni` se safe `returnTo`; neobnovovat destruktivní potvrzení, reason ani rozpracovaný apply bez nového preview.               |

`returnTo` přijímá pouze relativní allowlisted route na stejném originu.
Odstraní se ticket kódy, magic-link tokeny, e-mail, jméno, reason a jiné
citlivé query parametry. Po spotřebování one-time tokenu se URL nahradí
kanonickou route přes history replacement.

### 2.4 Datové a offline třídy

| Kód  | Data                                                               | Cache/offline pravidlo                                                                                                                       |
| ---- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `P0` | Publikovaná veřejná data bez PII                                   | Versionovaná cache je povolena; offline stav vždy ukáže publication version a čas poslední aktualizace.                                      |
| `P1` | Autorizovaná eventová data bez přímé PII                           | Cache jen po schválení `CS-OFFLINE-01`; musí být event-scoped.                                                                               |
| `P2` | Vlastní profil, agenda, ticket stav, read state a jiné vlastní PII | Šifrování prohlížeče se nepovažuje za autorizační hranici. Cache musí mít user/event owner a wipe při logoutu, switch-account nebo revokaci. |
| `P3` | Provozní PII jiných osob, audit a support data                     | Admin/check-in browser cache je zakázaná; data jsou online-only a po ztrátě oprávnění se okamžitě odstraní z UI.                             |
| `S`  | Ticket/magic-link credential, raw kód nebo jiný secret             | Nikdy do URL historie, logu, analytiky, obecné cache ani podpůrného screenshotu. Credential se zobrazí jen podle specializovaného kontraktu. |

Offline mutace jsou výchozím stavem zakázané. Queue podle `CS-OFFLINE-01`
přijímá pouze agenda add/remove. Announcement read state, rezervace, ticket
claim, support/admin mutace a check-in jsou online-only.

### 2.5 Povinné UX profily

Každá route v mapě odkazuje na jeden profil níže. Profil pokrývá všech osm
stavů z §12.5; text za `+` v route mapě je povinná route-specific varianta.

| Profil                     | Loading                                  | Empty                                       | Opravitelná chyba                                   | Permission                                                       | Offline/stale                                                                | Pending sync                                                             | Success                                                                | Session expired                                                              |
| -------------------------- | ---------------------------------------- | ------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `PUB-R` veřejné čtení      | Skeleton rezervující layout              | Vysvětlení + bezpečný další krok            | Inline error + retry                                | Neaplikuje se; nepublikovaný obsah je bezpečné `404/unavailable` | Cached `P0` + version/čas, jinak offline fallback                            | Jen viditelný stav probíhajícího refresh/cache update                    | Potvrzení refresh bez spoléhání na barvu                               | Pokud existovala relace, nabídnout login; veřejné čtení zůstává dostupné     |
| `PUB-W` veřejný flow       | Stav kroku + disabled submit             | Začít/zopakovat flow                        | Error summary, chyba u pole, retry                  | Generická neenumerující chyba                                    | Shell a rozepsaný ne-secret draft; submit zakázán                            | Disabled dvojitý submit + jednoznačný probíhající krok                   | Jednoznačný další krok; žádný příslib membership před serverem         | Login/recovery se safe `returnTo`; secret se neobnovuje                      |
| `MEM-R` participant čtení  | Skeleton bez falešných live dat          | Empty + další smysluplný krok               | Inline error + retry/request ID                     | Bezpečný forbidden/access state                                  | Schválená event/user cache + čas; jinak offline state                        | Pouze pokud se synchronizuje read/cache stav                             | Text + ikona/live region pro dokončený refresh/read                    | Login se safe návratem a obnovou filtru/scrollu                              |
| `MEM-W` participant mutace | Skeleton + disabled akce                 | Empty + cesta k vytvoření/volbě             | Error summary nebo inline domain error + retry      | Forbidden bez úniku cizích dat                                   | Read cache; mutace disabled nebo explicitně queued jen po `CS-OFFLINE-01`    | Jedna pending akce, zákaz double submit, možnost bezpečného cancel/retry | Serverový canonical stav, text + ikona/live region                     | Login se safe návratem; znovu potvrdit ne-idempotentní akci                  |
| `ADM-R` admin čtení        | Skeleton/tabulka s rezervovaným layoutem | Empty + konfigurace/import/filtr podle role | Error + retry/request ID                            | `403` bez částečných dat                                         | Online-only; stale data se zneplatní a skryjí                                | Pouze stav serverového jobu/exportu                                      | Potvrzení refresh/export-ready + audit reference                       | Login se safe návratem; filtry bez PII lze obnovit                           |
| `ADM-W` admin mutace       | Skeleton + disabled submit               | Empty + jedna primární setup akce           | Error summary, field errors, stale-version recovery | `403`, žádná optimistic změna                                    | Online-only; žádný příslib apply/send/mutace                                 | Immutable preview/version, disabled double submit, průběh jobu           | Canonical výsledek + audit/request reference                           | Login se safe návratem; preview/reason/destruktivní potvrzení se načte znovu |
| `CHK` check-in             | Kamera/lookup progress bez blikání       | Manuální lookup jako další krok             | Full-screen recovery + retry/manual fallback        | Okamžité ukončení skenu a vyčištění výsledku                     | Autoritativně online; offline jen po explicitním gate a s viditelným režimem | Zamknout opakovaný scan/confirm; idempotency stav                        | Full-screen valid/duplicate outcome textem, ikonou a volitelným zvukem | Login se safe návratem do prázdného scanneru; nikdy neobnovit výsledek osoby |

## 3. Navigační architektura

### 3.0 Společné invarianty shellu

Všechny varianty shellu mají jako první focusovatelný prvek skip link na
`#main`. Po klientské navigaci se focus přesune na `#main`, každá route má
právě jeden popisný `h1` a aktivní navigační stav není sdělený jen barvou.
Interaktivní cíle mají nejméně 44 × 44 CSS px, focus ring zůstává viditelný a
animace respektují `prefers-reduced-motion`.

Dynamické `sessionId`, `announcementId`, slugy a další identifikátory jsou
opaque vstupy: server je validuje, omezuje aktuálním eventem a autorizuje před
načtením dat. Chybný nebo cizí identifikátor nikdy nesmí prozradit existenci
záznamu.

### 3.1 Participant shell

Spodní navigace má pět položek:

1. **Přehled** → `/app`
2. **Program** → `/app/program`
3. **Agenda** → `/app/agenda`
4. **Oznámení** → `/app/oznameni`
5. **Více** → `/app/vice`

Hub **Více** obsahuje Vstupenku, Praktické informace, Řečníky, Partnery,
Profil, Soukromí a Nastavení. `/app` má vždy viditelný ticket shortcut, takže
kritická vstupenka není závislá jen na hubu. Aktivní stav má ikonu i label,
spodní safe-area inset a nejméně 44 × 44 CSS px.

Detail route se nevrací na pevně danou homepage: Browser Back obnoví skutečnou
zdrojovou route, filtr a scroll. Přímý deep link bez historie použije uvedený
kanonický fallback.

### 3.2 Admin shell

Desktop používá jeden sidebar s těmito skupinami:

- Přehled;
- Obsah;
- Účastníci a vstupenky;
- Provoz;
- Oznámení;
- Reporty a audit;
- Nastavení.

Úzký viewport používá jediný sheet se stejnou hierarchií. Breadcrumbs jsou
sekundární orientace, nikoli třetí paralelní navigační systém. `/check-in`
záměrně používá samostatný operátorský shell bez admin sidebaru.

## 4. Veřejné a aktivační routes

| Route                | Role a minimum                                                 | Fáze/flag                                                             | Primární úkol → dominantní CTA                                                                | Deep link, Back a zachování stavu                                                                                                   | Data/offline/PII                                                                  | UX profil                                                                                |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/`                  | anonymní nebo libovolná relace; bez event permission           | `D/A/L/E/R` podle dostupné recovery                                   | Přihlásit se jednorázovým odkazem → `Poslat přihlašovací odkaz`; aktivace je sekundární cesta | Kanonický přihlašovací root; Back opouští app. Rozpracovaný serverový claim má přednost před novým recovery požadavkem.             | vlastní e-mail `P2`; online-only submit, shell může být offline                   | `PUB-W` + stejná odpověď pro existující/neexistující účet a bezpečný stav neznámé relace |
| `/aktivace`          | anonymní; pending claim bez membership                         | `A/L`; jinak vysvětleně zavřeno                                       | Zvolit způsob aktivace → `Zadat kód`                                                          | Deep link z ticket komunikace; Back `/`. Volba metody se může zachovat, kód ne.                                                     | `P0`, flow metadata `P1`; network-only submit                                     | `PUB-W` + již aktivovaný/pozastavený/nepodporovaný stav bez enumerace                    |
| `/aktivace/skenovat` | anonymní; camera permission až po vysvětlení                   | `A/L`                                                                 | Načíst ticket kód → `Povolit kameru`                                                          | Deep link z `/aktivace`; Back `/aktivace`. Po cancel zachovat jen zvolenou metodu.                                                  | raw kód `S`; žádný obraz ani kód do cache/logu                                    | `PUB-W` + permission denied, unsupported device a vždy viditelný ruční fallback          |
| `/aktivace/kod`      | anonymní                                                       | `A/L`                                                                 | Odeslat opaque kód → `Pokračovat`                                                             | Deep link z `/aktivace` nebo scanner fallback; Back `/aktivace`. Raw hodnota se neukládá do URL/history/draft.                      | raw kód `S`; online-only                                                          | `PUB-W` + neenumerující invalid/cancelled/already-used/rate-limited outcome              |
| `/aktivace/odkaz`    | anonymní nebo přihlášený příjemce one-time odkazu              | `A/L`; recovery může být dostupné dle token policy                    | Spotřebovat jednorázový odkaz → automatický serverový handoff, případně `Pokračovat`          | Vstupní deep link s tokenem; po serverové spotřebě okamžitě replace na kanonickou route bez tokenu. Back nesmí token znovu odeslat. | token `S`; no-referrer, network-only                                              | `PUB-W` + expired/used/wrong-event generická chyba a recovery CTA                        |
| `/prihlaseni`        | anonymní; Better Auth                                          | `D/A/L/E/R` podle dostupné recovery                                   | Obnovit relaci → `Poslat přihlašovací odkaz` nebo potvrdit handoff                            | Deep link ze safe `returnTo`; Back na zdroj nebo `/`. E-mail může zůstat jen v paměti formuláře, ne URL.                            | vlastní e-mail `P2`; online-only                                                  | `PUB-W` + stejná odpověď pro existující/neexistující účet, resend cooldown               |
| `/onboarding`        | ověřená identita a pending/active event vztah dle `CS-BOOT-01` | `A/L`; `E` jen dokončení dříve založeného vztahu, pokud server dovolí | Dokončit aktuální krok → `Pokračovat`/`Dokončit`                                              | Deep link po auth/claim; Back mezi kroky, exit potvrdit při neuložené změně. Po dokončení safe `returnTo` nebo `/app`.              | jméno/e-mail/souhlasy `P2`; autosave pouze kontraktem, networking opt-in odděleně | `MEM-W` + chybějící právní verze, povinné acknowledgement a dobrovolný networking choice |
| `/offline`           | veřejný shell; může číst pouze cache aktuálního ownera         | `D/A/L/E/R`                                                           | Pochopit stav a vrátit se → `Zkusit znovu`                                                    | Deep link z network fallbacku; Back na poslední bezpečnou route nebo `/`.                                                           | `P0/P1/P2` jen podle owner-scoped cache; nikdy `P3/S`                             | `PUB-R` + seznam dostupného offline obsahu, last updated a instalace/update SW           |
| `/chyba-pristupu`    | kdokoli; žádná citlivá data v query                            | `D/A/L/E/R`                                                           | Obnovit bezpečnou cestu → `Přihlásit se`, `Kontaktovat podporu` nebo `/`                      | Nenavrací do redirect loopu. Support reference může obsahovat request ID, ne PII.                                                   | `P0`; network není nutný pro obecné vysvětlení                                    | `PUB-R` + suspended/revoked/forbidden/session-expired varianty bez enumerace             |

## 5. Participant routes

Všechny participant routes vyžadují ověřenou relaci, dokončený onboarding,
aktivní event membership a event scope. Konkrétní permission níže je další
minimum, nikoli náhrada těchto podmínek.

| Route                            | Role a minimum                                                                           | Fáze/flag                                          | Primární úkol → dominantní CTA                                                        | Deep link, Back a zachování stavu                                                                                          | Data/offline/PII                                                                       | UX profil                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/app`                           | `participant`; `program:published:read`                                                  | `A/L/E`; `R` jen privacy/session shortcut          | Zjistit co je teď nejdůležitější → phase-specific karta, nejvýše jedna dominantní CTA | Kanonický participant home; Back `/` nebo opuštění PWA. Zachovat jen poslední bezpečný refresh.                            | `P0/P1`, vlastní agenda/unread `P2`; cache podle jednotlivých slice                    | `MEM-R` + žádná vymyšlená live data, pre-event/post-event empty state                         |
| `/app/program`                   | `participant`; `program:published:read`                                                  | `A/L/E`                                            | Najít session → otevření detailu není vizuálně dominantní globální CTA                | Shareable deep link; Back `/app`. Zachovat den, typ, room, scroll a publication version.                                   | publikovaný obsah `P0`; network-first cache                                            | `MEM-R` + žádná publikace, nulový výsledek filtru a změněná publication                       |
| `/app/program/[sessionId]`       | `participant`; `program:published:read`, akce `agenda:own:write` s `ownsResource`        | `A/L/E`                                            | Porozumět session → kanonická agenda/rezervační akce podle `CS-AGENDA-01`             | Přímý deep link; Back obnoví program state, fallback `/app/program`.                                                       | session/speaker `P0`, vlastní agenda state `P2`; obsah cache, mutace dle offline gate  | `MEM-W` + session removed/cancelled/changed, capacity action neslibuje místo                  |
| `/app/recnici`                   | `participant`; `program:published:read`                                                  | `A/L/E`                                            | Najít řečníka → otevřít profil                                                        | Deep link z menu/programu; Back na zdroj nebo `/app/program`. Zachovat scroll.                                             | publikované profily `P0`; network-first cache                                          | `MEM-R` + prázdný seznam/nepublikovaný profil                                                 |
| `/app/recnici/[slug]`            | `participant`; `program:published:read`                                                  | `A/L/E`                                            | Přečíst profil a související sessions → `Zobrazit v programu`                         | Shareable deep link; Back obnoví directory/program, fallback `/app/recnici`.                                               | publikovaný profil `P0`; network-first cache                                           | `MEM-R` + profil odebrán, externí odkazy pouze HTTP(S)                                        |
| `/app/partneri`                  | `participant`; `program:published:read`                                                  | `A/L/E`                                            | Najít partnera/informaci → případný bezpečný externí web                              | Deep link z menu; Back na zdroj nebo `/app`. Zachovat scroll.                                                              | publikovaná data `P0`; network-first cache                                             | `MEM-R` + prázdní partneři a neplatný externí odkaz                                           |
| `/app/agenda`                    | `participant`; `agenda:own:write`, `reservation:own:read`, mutace podle `CS-AGENDA-01`   | `A/L`; `E` read-only                               | Zobrazit vlastní plán a spravovat rezervaci/waitlist → jedna canonical session akce   | Deep link z bottom nav; Back `/app`. Zachovat den, scroll, session context a canonical agenda version.                     | agenda/rezervace `P2` + program `P0`; owner-scoped cache, rezervace online-only        | `MEM-W` + empty/conflict/pending, full/waiting/offered/expired/closed/stale a ended read-only |
| `/app/informace`                 | `participant`; `program:published:read`                                                  | `A/L/E`                                            | Najít praktickou odpověď → kontextové `Otevřít mapu`                                  | Deep link na bezpečný anchor/section; Back na zdroj nebo `/app`. Zachovat otevřenou FAQ a scroll.                          | publikované stránky/venue/FAQ `P0`; network-first cache                                | `MEM-R` + prázdná sekce, neplatný map link, stale publication                                 |
| `/app/oznameni`                  | `participant`; `announcement:own:read` s `announcementRecipient`; `announcementsEnabled` | `A/L/E`; v `R` nedostupné                          | Přečíst provozní oznámení → otevřít nejnovější unread                                 | Deep link z bottom nav/badge; Back `/app`. Zachovat filtr unread/all a scroll.                                             | obsah `P1`, vlastní read state `P2`; read mutace je online-only bez queue              | `MEM-W` + prázdný inbox, unread/read a removed announcement                                   |
| `/app/oznameni/[announcementId]` | stejné jako inbox; server ověří audience membership                                      | `A/L/E`; `announcementsEnabled`                    | Přečíst oznámení → kontextový odkaz na dotčenou session                               | Přímý deep link z notifikace; Back obnoví inbox, fallback `/app/oznameni`. ID je opaque, ne audience údaj.                 | audience-scoped `P1/P2`; read mutace je online-only bez queue                          | `MEM-W` + audience denied jako bezpečné `404` a expired/removed                               |
| `/app/vstupenka`                 | `participant`; `checkin:own-code:read` s `ownsResource`; `BLOCKER-TKT-05`                | `A/L`; `E` pouze stav bez aktivního credentialu    | Prezentovat vlastní vstup → `Zobrazit vstupenku`, pouze po serverovém kontraktu       | Deep link z `/app` a menu; Back na zdroj nebo `/app`. Po background/timeout credential skrýt.                              | ticket stav `P2`, credential `S`; credential bez schválené offline politiky necachovat | `MEM-R` + valid/cancelled/refunded/blocked, skrytý credential, screenshot/privacy upozornění  |
| `/app/profil`                    | `participant`; plánované `profile:own:write`                                             | `A/L/E`; `R` read-only nebo odstraněno dle retence | Upravit profilové minimum → `Uložit změny`                                            | Deep link z menu/settings; Back `/app/nastaveni`, neuložené změny potvrdit.                                                | vlastní profil `P2`; online-only write, žádná networkingová pole v Priority A          | `MEM-W` + field errors, stale version, retained/deleted field state                           |
| `/app/soukromi`                  | `participant`; `personal-data:own:export` pro export, plánované `privacy:own:write`      | `A/L/E/R` podle retence                            | Porozumět a uplatnit privacy právo → jedna zvolená žádost, ne více dominantních CTA   | Deep link z onboarding/legal/settings; Back na zdroj nebo `/app/nastaveni`. Draft žádosti bez citlivého textu lze obnovit. | consent/privacy request `P2`; online-only submit, dokumenty `P0`                       | `MEM-W` + chybějící právní verze, request pending/completed/rejected s vysvětlením            |
| `/app/nastaveni`                 | ověřený vlastník účtu; Better Auth session ownership, event role jen pro event část      | `D/A/L/E/R`                                        | Spravovat relaci a účet → kontextově `Odhlásit se` nebo `Odhlásit všechna zařízení`   | Deep link z menu; Back `/app` nebo `/` po archivaci. Switch-account zahodí osobní cache před navigací.                     | session metadata/profil minimum `P2`; online-only mutace                               | `MEM-W` + logout/logout-all/switch-account, wipe success/error a nedostupný event             |
| `/app/vice`                      | `participant`; jednotlivé cíle ověřují vlastní minimum                                   | `A/L/E/R` podle cíle                               | Najít sekundární participant funkci → otevřít zvolený bezpečný cíl                    | Deep link z bottom nav; Back `/app`. Hub nedrží citlivý stav a necachuje data cílových obrazovek.                          | navigační metadata `P0`; cílové obrazovky podle vlastní klasifikace                    | `MEM-R` + permission/phase-aware cíle bez naznačení nepovolených funkcí                       |

## 6. Organizační a check-in routes

Admin routes vyžadují aktivní event membership, `organizer_admin` a uvedenou
permission. `/check-in` navíc povoluje roli `checkin_operator`; role je vždy
event-scoped a případný room/session scope se ověřuje serverem.

| Route              | Role a minimum                                                                                       | Fáze/flag                                                                               | Primární úkol → dominantní CTA                                                     | Deep link, Back a zachování stavu                                                                                  | Data/offline/PII                                                             | UX profil                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/admin`           | `organizer_admin`; `operations:read`                                                                 | `D/A/L/E/R` podle retenčního minima                                                     | Najít provozní odchylku → jedna kontextová akce k nejzávažnějšímu stavu            | Kanonický admin home; Back opouští admin. Zachovat pouze bezpečný časový filtr.                                    | agregace `P1`, výjimky mohou být `P3`; online-only                           | `ADM-R` + žádná falešná live čísla, degraded worker/Redis/sync stav                                      |
| `/admin/obsah`     | `organizer_admin`; `program:manage`                                                                  | `D/A/L/E`; `R` read-only                                                                | Spravovat program, řečníky, partnery a další obsah → uložit změnu nebo publikovat  | Deep link z admin nav; Back `/admin`. Zachovat resource filtr, ne stale edit/publish potvrzení.                    | draft/publikovaný obsah `P0/P1`; online-only admin write                     | `ADM-W` + empty/validation/collision/archive, immutable preview, publish conflict/sync pending           |
| `/admin/vstupenky` | `organizer_admin`; `ticket:any:manage` a `CS-IMPORT-01`                                              | `D/A/L`; `E` read-only/support, `R` retenčně omezeno                                    | Zvalidovat a aplikovat import → aktuální krok upload/preview/confirm               | Deep link na opaque batch ID; Back mezi kroky bez raw řádků v URL. Stale preview se znovu načte.                   | import/support `P3`, raw kód `S`; online-only, raw file v private quarantine | `ADM-W` + unsupported file, validation conflicts, immutable preview, apply job/report                    |
| `/admin/ucastnici` | `organizer_admin`; `participant:operational:read`, citlivá akce `ticket:any:manage`                  | `A/L/E`; `D` bez participant dat, `R` retenčně omezeno                                  | Najít účastníka a bezpečně vyřešit problém → `Vyhledat`; citlivá akce až v detailu | Deep link jen přes opaque interní ID; Back obnoví ne-PII filtr, jméno/e-mail neukládat do URL/history.             | provozní PII `P3`, ticket secret `S`; online-only                            | `ADM-W` + no result, ambiguous result, reason/confirmation/audit outcome                                 |
| `/admin/role`      | `organizer_admin`; `role:manage`                                                                     | `D/A/L`; `E/R` revoke/read-only                                                         | Spravovat scoped operátorskou roli → `Přidat oprávnění`                            | Deep link na opaque assignment ID; Back `/admin`. Neobnovovat rozpracované grant/revoke confirm po session expiry. | role/scope metadata `P3`; online-only                                        | `ADM-W` + self-lockout prevention, last-admin guard, stale assignment, audit reason                      |
| `/admin/rezervace` | `organizer_admin`; `reservation:any:read`, override `agenda:any:override` s `auditedException`       | `A/L`; `E/R` read-only                                                                  | Vyřešit kapacitní nebo attendance výjimku → kontextový auditovaný zásah            | Deep link na session ID; Back obnoví day/session/filter. Reason se neukládá do URL ani po expiraci.                | rezervace a attendance `P3`; online-only                                     | `ADM-W` + full/waitlist/stale capacity, attendance update, explicit impact, reason a audit               |
| `/admin/oznameni`  | `organizer_admin`; `announcement:send`; `announcementsEnabled`                                       | `A/L/E`; `R` read-only                                                                  | Připravit a potvrdit in-app oznámení → aktuální krok `Náhled publika`/`Odeslat`    | Deep link na opaque draft/send ID; Back `/admin`. Po session expiry znovu načíst immutable preview.                | text `P1`, audience agregace `P1`, příjemci `P3`; online-only                | `ADM-W` + empty audience, stale preview, duplicate send, job/DLQ stav                                    |
| `/admin/reporty`   | `organizer_admin`; `operations:read`, export `personal-data:operational:export` s `auditedException` | `A/L/E/R` dle retence                                                                   | Získat provozní souhrn → `Vytvořit export` jen po zvolení reportu                  | Deep link s allowlisted ne-PII filtrem; Back `/admin`. Expiring download se neobnovuje ze staré URL.               | agregace `P1`, export může být `P3`; online-only                             | `ADM-R` + report empty, async export queued/ready/expired/failed                                         |
| `/admin/audit`     | `organizer_admin`; `audit:read`                                                                      | `D/A/L/E/R` dle retence                                                                 | Dohledat auditovanou změnu → `Použít filtry`                                       | Deep link jen s allowlisted action/time/opaque ID; žádné jméno/e-mail/reason v query. Back `/admin`.               | audit `P3`; online-only, citlivé before/after redacted                       | `ADM-R` + no result, redacted entry, retention boundary, request ID lookup                               |
| `/admin/nastaveni` | `organizer_admin`; `event:settings:manage`                                                           | `D/A/L/E`; `R` read-only                                                                | Změnit minimální event nastavení → `Uložit změny`                                  | Deep link z admin nav; Back `/admin`. Neuložené změny potvrdit, stale version znovu načíst.                        | event config `P1`, role actor `P3`; online-only                              | `ADM-W` + invalid phase transition, stale version, destructive flag confirmation                         |
| `/check-in`        | `checkin_operator` nebo `organizer_admin`; `checkin:perform`, undo navíc `checkin:undo`              | `L`; `A` pouze explicitní rehearsal; offline adapter jen `offlineCheckinEnabled` + gate | Odbavit právě jednu osobu → `Skenovat`/`Potvrdit odbavení` podle kroku             | Přímý deep link po loginu; Back vyžaduje opuštění operátorského režimu. Každý nový scan začíná čistým stavem.      | minimum identity/ticket outcome `P3`, credential `S`; autoritativně online   | `CHK` + camera/manual/name-email lookup, valid/duplicate/cancelled/unknown, undo a network-loss recovery |

## 7. Otevřené permission gaps pro navazující kontrakty

F4 doplnilo oddělené admin permissions pro ticket support, operational read,
role, dashboard/report, audit a event settings; `CS-ANN-01` používá
`announcement:own:read` s recipient kontextem. Otevřené zůstávají pouze
participant account/privacy významy a úplná ticket presentation autorita:

| Plánovaný význam                         | Konzumenti       | Vlastník                       |
| ---------------------------------------- | ---------------- | ------------------------------ |
| vlastní participant profil read/write    | `/app/profil`    | `CS-BOOT-01`, `F2-07`, `P4-13` |
| vlastní privacy preference/request write | `/app/soukromi`  | `CS-BOOT-01`, `F2-07`, `P4-13` |
| úplný ticket state/presentation read     | `/app/vstupenka` | `CS-TICKET-01`, `P4-12`        |

`checkin:own-code:read` je pro `/app/vstupenka` pouze současný nejbližší
permission. Úplný `CS-TICKET-01` musí po `BLOCKER-TKT-05` potvrdit, zda pokrývá
celý ticket state/presentation scope, nebo zavést přesnější vlastní ticket
permission. Otevřený gap se nesmí nahrazovat širším UI role guardem.

## 8. Akceptační kontrola F0-01

- [x] Každá Priority A route v §12 má roli/minimální permission.
- [x] Každá route má fázi eventu a relevantní flag/gate.
- [x] Každá route má jeden primární úkol a nejvýše jednu dominantní CTA.
- [x] Každá route má deep link, kanonickou návratovou cestu a pravidlo
      zachování stavu/scrollu.
- [x] Každá route má datovou/offline/PII klasifikaci.
- [x] Každá route odkazuje na profil pokrývající všech osm stavů z §12.5 a má
      route-specific varianty.
- [x] Participant navigace má nejvýše pět položek, label, ikonu, active stav a
      safe-area pravidlo.
- [x] Admin používá jednu adaptivní navigační hierarchii.
- [x] Priority B/C routes jsou explicitně mimo gate.
- [x] Chybějící server permissions jsou evidované a nesmí se nahrazovat
      širším UI role guardem.
