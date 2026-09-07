# Přístup programových spolupracovníků a živé Q&A

Stav: implementace zahájena 7. 9. 2026; AQ-00 lokální scope a inventář zpracovány

Datum: 5. 9. 2026

Primární aplikace: `apps/conference`

## Průběh realizace

- 7. 9. 2026: AQ-00 – přijat [ADR-017](adr/017-participant-collaborators-and-private-question-follow-ups.md), vytvořen [source inventář](evidence/participant-access-live-qa-inventory.md) a strojový whitelist s kontrolou proti kanonickým datům.
- Uživatel potvrdil vyloučení EB21 a „Jak na networking“ z Q&A: 17 přednáškových/panelových session. Kanonický rezervovatelný networking je Leadership Stage; druhá projekce je pouze informativní.
- AQ-01 a navazující implementace zatím nejsou dokončené. Skutečné účty, publikace, provozní kapacita networkingu a staging rehearsal čekají na ověření; lokální inventář je nenahrazuje.

## 1. Cíl

Tento plán řeší dva související, ale technicky oddělené okruhy:

1. bezpečné zpřístupnění účastnické aplikace koučům a vedoucím vybraných aktivit;
2. dokončení Q&A pro páteční přednášky na BYZON Stage a Leadership Stage, včetně možnosti speakera doplnit po vystoupení písemnou odpověď.

Výsledkem nemá být nový obecný speaker portál ani veřejná sociální zeď. Jde o malé role-aware rozšíření současné účastnické aplikace.

### Potvrzený výklad zadání

„Přístup do účastnické appky pro kouče, páteční mastermind, páteční networking, sobotní mastermind a sobotní workshopy“ v tomto plánu znamená přístup **lidí, kteří tyto aktivity vedou**, ne nový nárok běžných účastníků na vstup do placeného nebo uzavřeného programu.

To odpovídá současné dokumentaci projektu, kde vedoucí aktivit potřebují účastnickou appku a read-only seznam rezervovaných osob. Nový produktový entitlement běžných návštěvníků je výslovně mimo tento scope; případná budoucí varianta je oddělená v kapitole 13.

## 2. Důležité zjištění: Q&A už není greenfield

V repozitáři už existuje většina základního živého sběru dotazů:

| Oblast            | Co už existuje                                                                                               | Co chybí nebo je chybně                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Databáze          | tabulka `questions` s eventem, session, autorem, textem a časem                                              | písemná odpověď, lifecycle a explicitní Q&A způsobilost                |
| Účastník          | formulář na `/app/interakce/[sessionId]`                                                                     | kontext přednášky, časové stavy, vlastní odpovědi, robustní retry      |
| Moderátor         | read-only chronologický feed na `/moderator/[sessionId]`                                                     | rozcestník přiřazených session a dotažený tabletový režim              |
| Admin             | globální a per-session přepínač, přiřazení moderátora                                                        | omezení jen na podporované session, preflight a QR akce                |
| QR                | server umí SVG jedné session a ZIP všech session                                                             | žádné tlačítko v admin UI; QR vede na detail programu, ne na dotazy    |
| Speaker           | vazba speaker profil–účet–session existuje                                                                   | API, permission a UI pro písemnou odpověď                              |
| Přístup vedoucích | ruční přidání účastníka, SimpleShop import, membership, participant, speaker a `room_operator` role existují | zdrojově nezávislé dokončení role setupu a přehledné role-aware vstupy |

Relevantní výchozí soubory:

- `packages/database/src/schema/interactions.ts`
- `packages/database/src/schema/events.ts`
- `packages/database/src/schema/content.ts`
- `packages/domain/src/contracts/questions.ts`
- `packages/domain/src/permissions.ts`
- `apps/conference/src/server/questions.ts`
- `apps/conference/src/server/session-qr.ts`
- `apps/conference/src/server/activity-roster.ts`
- `apps/conference/src/server/admin-engagement.ts`
- `apps/conference/src/server/admin-support.ts`
- `apps/conference/src/components/live-interactions.tsx`
- `apps/conference/src/components/program-view.tsx`
- `apps/conference/src/components/admin-engagement-workspace.tsx`
- `apps/conference/src/components/admin-content-console.tsx`
- `apps/conference/src/components/participant-shell-navigation.tsx`

### Současné mezery, které musí implementace výslovně odstranit

1. Admin nyní může zapnout Q&A pro libovolnou session.
2. Server přijímá dotazy i po konci vystoupení, dokud zůstanou přepínače zapnuté.
3. CTA účastníka čte `questionsEnabled` z immutable publikovaného snapshotu, zatímco admin mění živou tabulku session. Bez nové publikace se proto může zobrazovat zastaralý stav.
4. QR backend není vystavený v administraci, generuje i nepodporované session a vede na `/app/program/:id`.
5. Speaker nemá permission, API ani UI pro odpovědi.
6. Moderátor nemá seznam svých přiřazených přednášek a jeho feed nemá dostatek kontextu pro tablet.
7. `activity-roster` dnes odvozuje přístup také jen z vazby speaker–session. Read-only roster má být podle principu nejmenších oprávnění dostupný jen přes explicitní scoped `room_operator`.
8. Team-member flow vytváří pouze provozní roli a jeho pozvánka vede do `/admin`; pro programového spolupracovníka se proto musí nejprve použít ruční participant flow nebo SimpleShop import.
9. Q&A má pouze kontraktové testy; chybí ucelené serverové, komponentové a E2E pokrytí.
10. Moderátora dnes nelze připravit, dokud nejsou zapnuté globální i session otázky. To znemožňuje bezpečný setup s vypnutým kill switchem.

## 3. Závazná produktová rozhodnutí pro implementaci

Agent nemá tato pravidla během implementace reinterpretovat.

### 3.1 Přístup do appky a oprávnění role jsou dvě různé věci

- Aktivní event membership + role `participant` zpřístupní běžnou účastnickou aplikaci.
- Role `speaker`, `room_operator` a `moderator` pouze přidávají úzce vymezené schopnosti.
- Nevzniknou role `coach`, `friday_mastermind`, `networking_host` ani jiné kombinované role.
- Jeden člověk může mít více rolí a více typů spolupráce.
- Programový spolupracovník dostane plnou běžnou účastnickou zkušenost. Networking zůstává opt-in jako u ostatních účastníků.
- Moderátor používající `/host/moderace` musí mít stejný participant baseline; samotný provozní účet z `/admin/tym` nestačí.
- Primární cestou pro řečníky a vedoucí je existující ruční přidání účastníka administrátorem. SimpleShop import zůstává alternativní cestou, pokud v něm daný člověk už je nebo jej organizátor výslovně zvolí.
- Obě cesty musí skončit stejným invariantem: jeden účet, aktivní event membership, participant profil a aktivní role `participant`.
- Přidělení `speaker`, `room_operator` nebo `moderator` role nesmí samo zakládat druhý účet ani automaticky odesílat pozvánku.
- Ruční participant flow v této etapě zachová současný interní kompatibilní ticket záznam, protože jej používají participant pozvánky a support operace block/reactivate. Jeho hash ani suffix se nesmí ukázat uživateli, vytvořit z něj QR, použít jej pro check-in nebo z něj odvozovat programová oprávnění. Odstranění této ticket-shaped vrstvy je samostatný pozdější refaktor.

### 3.2 Rozsah Q&A je explicitní, ne odvozený z názvu

Q&A je podporováno jen pro předem označené páteční programové session na BYZON Stage a Leadership Stage. Do rozsahu nepatří coaching, networking, mastermind mimo tyto stage, workshopy, přestávky, jídlo ani sobotní program.

Serverová autorizace se nesmí za běhu opírat o textový název stage ani o nepřesný `session.type`. Každá session dostane explicitní capability `questionMode`:

- `disabled`
- `moderated_follow_up`

Současný `questionsEnabled` zůstane provozním vypínačem pouze pro způsobilou session. Globální `eventFeatures.questionsEnabled` zůstane nouzovým vypínačem živého sběru pro celý event. Pro speaker část přibude oddělený default-OFF flag `questionFollowUpsEnabled`, aby šel follow-up nasadit a případně vypnout nezávisle na pátečním sběru. Capability, per-session toggles i moderátory musí jít připravit při globálním stavu OFF; globální ON až poté spustí readiness preflight.

Historický `speakerPortalEnabled` zůstane vypnutý. `/host/dotazy` je jediný úzký capability slice, ne obnovení obecného speaker portálu.

### 3.3 Moderátor nic neslučuje ani neoznačuje

- Během vystoupení má moderátor read-only chronologický feed.
- Není zde hlasování, slučování, pořadí podle relevance, archivace ani ruční stav „zodpovězeno“.
- Po skončení moderátor nic nepředává speakerovi a nemá další workflow.

### 3.4 „Nezodpovězený“ znamená „bez písemné odpovědi“

Systém neví, co bylo zodpovězeno ústně. Po `session.endsAt` proto linked speaker uvidí texty všech dotazů ke své session, které ještě nemají písemnou odpověď, a sám zvolí, na který odpoví. UI musí používat formulaci „Bez písemné odpovědi“, ne tvrdit, že dotaz nebyl zodpovězen na pódiu.

### 3.5 Soukromí odpovědí

Doporučený výchozí režim:

- během vystoupení vidí všechny dotazy pouze přiřazený moderátor;
- po skončení vidí texty dotazů linked speakeři dané session, ale ne jméno, e-mail ani firmu autora;
- publikovanou písemnou odpověď vidí pouze autor původního dotazu ve své přihlášené appce;
- jiní účastníci, veřejný web, projekce ani obecný admin obsah dotazu či odpovědi nevidí;
- admin vidí pouze provozní počty a stav pokrytí, nikoli texty.

Tento režim je privacy-safe a nejlépe odpovídá větě, že dotazy nejsou veřejně promítané. Změna na veřejnou galerii odpovědí je samostatné produktové rozhodnutí a není součástí MVP.

MVP neposílá e-mailové notifikace o novém dotazu ani odpovědi. Participant i speaker stav najdou v role-aware appce; notifikace by byla samostatný opt-in slice.

### 3.6 Časová pravidla

- Formulář může zobrazit stav předem, ale přijímá dotazy pouze v intervalu `startsAt <= now < endsAt`.
- Čas vyhodnocuje výhradně server v UTC; lokalizace se používá jen pro zobrazení.
- Po konci je nový submit odmítnut stabilním problem kódem, ale autor stále může číst svůj dotaz a pozdější odpověď.
- Speaker může číst a publikovat písemné odpovědi od `endsAt` do archivace eventu nebo odebrání přístupu.
- Přiřazený moderátor může číst již nasbíraný feed i po konci nebo provozním vypnutí sběru; flagy zastavují nový submit, nemažou ani neschovávají existující otázky jeho session.
- Vypnutí globálního sběru nesmí skrýt už existující vlastní dotazy a odpovědi ani zablokovat follow-up, který má vlastní flag. Je to vypínač nového sběru, ne mazání obsahu.
- Vypnutí `questionFollowUpsEnabled` zastaví speaker read/write, ale autorovi nesmí skrýt již publikovanou odpověď.

### 3.7 Jeden dotaz, jedna písemná odpověď

U panelu s více speakery může odpovědět kterýkoli linked speaker, ale na jeden dotaz vznikne právě jedna publikovaná odpověď. Konkurenční druhý publish skončí `409 Conflict` a nabídne refresh. Editovat ji smí jen speaker, který ji publikoval. Jméno odpovídajícího speakera se uloží a zobrazí autorovi.

## 4. Cílový model přístupů

### 4.1 Matice rolí

| Persona                               | Běžná appka   | Další role                  | Scope                                          | Co navíc získá                                                         |
| ------------------------------------- | ------------- | --------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Kouč                                  | `participant` | `room_operator`             | vlastní koučovací místnost nebo přesné session | read-only jména, firmy a rezervační stav vlastních slotů               |
| Vedoucí pátečního mastermindu         | `participant` | `speaker` + `room_operator` | speaker vazba a konkrétní mastermind session   | vlastní roster; speaker follow-up jen pokud je session Q&A podporovaná |
| Vedoucí pátečního networkingu         | `participant` | `speaker` + `room_operator` | networking session                             | vlastní roster; žádné Q&A                                              |
| Vedoucí sobotního mastermindu         | `participant` | `speaker` + `room_operator` | obě části sdílené rezervační skupiny           | jeden logický roster; žádné Q&A                                        |
| Vedoucí sobotního workshopu           | `participant` | `speaker` + `room_operator` | vlastní workshop                               | vlastní roster; žádné Q&A                                              |
| Speaker páteční podporované přednášky | `participant` | `speaker`                   | pouze session z `sessionSpeakers`              | po konci dotazy bez písemné odpovědi a odpověď na ně                   |
| Moderátor                             | `participant` | `moderator`                 | přesné podporované session                     | pouze živý feed přiřazených session                                    |

Poznámky:

- U koučů dnes není speaker vazba v importu; roster se jim proto musí přidělit explicitním `room_operator` scope.
- U sobotního mastermindu musí scope respektovat společnou reservation group, aby se dvě části nechovaly jako dvě různé aktivity.
- Speaker vazba sama nesmí zpřístupňovat roster. Pokud jej vedoucí potřebuje, musí mít i `room_operator`.
- Odebrání jedné přídavné role nesmí zrušit participant přístup, pokud zůstává jeho membership aktivní.

### 4.2 Zdroj identity a přístupu

Nevznikne nový registry programových spolupracovníků. Podporované jsou dvě vstupní cesty:

1. **Ruční přidání účastníka – primární cesta pro vedoucí a speakery.** Administrátor použije existující flow v účastnické správě, vyplní jméno, e-mail a profilová data a vytvoří participant baseline.
2. **SimpleShop import – alternativní cesta.** Pokud už je člověk ve schváleném importu, použije se tento existující participant a ruční duplikát se nezakládá.

Po obou cestách následují stejné kroky:

1. ověřit aktivní membership, participant profil a roli `participant`;
2. přidat scoped provozní role a speaker vazby;
3. samostatně a auditovaně odeslat participant pozvánku;
4. ověřit přihlášení do `/app` a role-aware vstup.

Ruční vytvoření ani přidání programové role samo e-mail neposílá. Použije se výhradně participant invitation z detailu účastníka, nikdy team/admin invitation. Role lze připravit před přijetím pozvánky, ale člověk není provozně „ready“, dokud nebylo ověřeno doručení, přihlášení/onboarding a efektivní oprávnění.

Zdrojově nezávislá pravidla:

- před ručním vytvořením hledat existujícího uživatele/účastníka podle canonicalizovaného e-mailu;
- existující SimpleShop nebo ruční participant se znovu použije; nevznikne druhá identita;
- ručně vytvořená osoba později nalezená v SimpleShopu konverguje do stejného user/profile/membership a dostane pouze další source vazbu;
- opačný směr, SimpleShop-first a následný pokus o ruční vytvoření, skončí rozpoznanou duplicitou a admin vybere existujícího participanta;
- konflikt neaktivní membership se před změnou zobrazí k ručnímu rozhodnutí;
- invitation/recovery vede do participant appky, nikoli do administrace;
- audit zachová, zda participant vznikl ručně nebo importem;
- interní kompatibilní ticket vytvořený současným ručním flow zůstává implementační detail; check-in a credential scope zůstává pro ročník 2026 nedosažitelný.

ADR-016 a scope inventory je nutné doplnit o výslovnou výjimku: ruční tvorba není primární cesta běžných návštěvníků, ale je schválenou primární cestou programových spolupracovníků.

### 4.3 Admin setup programového spolupracovníka

V administraci přidat nad existujícím participantem bez ohledu na zdroj akci „Nastavit jako vedoucího programu“ s těmito kroky:

1. výběr ručně založeného nebo importovaného aktivního účastníka;
2. UI preset `kouč`, `vedoucí mastermindu`, `vedoucí networkingu`, `vedoucí workshopu` nebo `speaker`;
3. výběr jedné či více session, případně místnosti;
4. serverový preview odvozených změn: scoped role, speaker link a cílový roster;
5. potvrzení transakce;
6. samostatný přehled, zda už byla odeslána participant pozvánka.

Preset je pouze bezpečná administrační zkratka, nikoli nová event role. Server z něj odvodí povolené role a scope; neakceptuje libovolný seznam rolí z klienta.

Role setup musí umět bezpečně:

- znovu použít existující účet a membership bez ohledu na zdroj;
- přidat nebo atomicky nahradit přesný multi-session `room_operator` scope;
- propojit existující speaker profil, pokud ho daná osoba má;
- přidat speaker roli pouze při skutečné speaker vazbě;
- nezaložit druhou identitu ani další přístupový záznam;
- vrátit čitelný preview/result a audit event.

Odebrání vedoucí role standardně nemaže participant membership. Případná blokace nebo reaktivace účastnického přístupu zůstává samostatným admin support procesem. Odebrání scope musí být previewované a auditované.

### 4.4 Kanonická konfigurace aktivit

Před přidělením rolí je nutný datový preflight:

- koučovací sloty musí mít aktuálně přiřazené coach-specific rooms; starší data mohla mít `roomId = null`;
- oba díly sobotního mastermindu musí zůstat v jedné reservation group a v jednom multi-session scope;
- páteční řízený networking má ve zdroji dvě projekce a dnes může být importovaný jako `other` bez kapacity. potvrzená kanonická rezervovatelná session je Leadership Stage, druhá projekce je pouze informativní;
- každá aktivita musí mít před provozem právě očekávaného vedoucího, kapacitu a validní roster scope.

Aktuální kandidáti podle repozitáře, které je nutné před apply potvrdit proti finálním datům a e-mailům:

| Aktivita                  | Osoba/osoby                     | Potřebná oprava nebo kontrola                                                                 |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| Páteční coaching          | Radim Roček, Stanislava Maunová | room scope každého kouče; speaker profil není potřeba                                         |
| Páteční mastermind EB21   | Lucie Libovická, Pavel Janoušek | oba participant účty, speaker links a společný roster scope                                   |
| Páteční řízený networking | Tomáš Řezníček                  | Leadership je kanonická rezervace; doplnit typ, speaker link a kladnou kapacitu               |
| Sobotní workshop          | Leonid Kushnir                  | ověřit explicitní speaker/session vazbu                                                       |
| Sobotní workshop          | Blanka Mrázková                 | doplnit explicitní source speaker link; dnešní title/meta párování není dostatečně spolehlivé |
| Sobotní mastermind        | Tomáš Ryza                      | link k oběma částem a jeden logický roster                                                    |

## 5. Cílový Q&A lifecycle

```text
PŘED SESSION
participant: vidí, kdy se dotazy otevřou
moderátor: vidí přiřazenou session
speaker: dotazy nevidí

START <= NOW < END
participant -> odešle soukromý dotaz
                    |
                    v
moderátor <- read-only chronologický feed na tabletu
speaker: dotazy nevidí

NOW >= END
nové dotazy: zavřeno
moderátor: bez povinného follow-up workflow
linked speaker -> vidí anonymizované dotazy bez písemné odpovědi
               -> vybere dotaz tím, že publikuje jednu odpověď
autor dotazu <- vidí svůj dotaz a speakerovu odpověď
ostatní účastníci / projekce / veřejnost: nic
```

### 5.1 Participant flow

1. U podporované přednášky je v detailu programu CTA „Položit dotaz“.
2. QR vede přímo na `/app/interakce/:sessionId`.
3. Nepřihlášený uživatel se po přihlášení bezpečně vrátí na stejnou interní route.
4. Stránka ukáže název, stage, čas a stav `otevře se / probíhá / skončilo / vypnuto`.
5. Formulář přijme 1–1000 znaků prostého textu.
6. Při síťové chybě text nezmizí; retry používá stejný idempotency key.
7. Po úspěchu se zobrazí potvrzení a možnost položit další dotaz.
8. Na stejné stránce nebo v `/app/vice` je „Moje dotazy“ se stavem písemné odpovědi.

Doporučená vysvětlivka:

> Během vystoupení dotaz uvidí pouze moderátor. Po skončení jej mohou bez údajů o autorovi vidět řečníci a případně na něj písemně odpovědět. Odpověď uvidíte jen vy.

### 5.2 Moderátorský tablet

Doporučené route:

- `/host/moderace` – pouze přiřazené přednášky;
- `/host/moderace/[sessionId]` – feed;
- starou `/moderator/[sessionId]` ponechat po přechodnou dobu jako bezpečný redirect.

Feed obsahuje:

- sticky záhlaví s názvem, stage, časem a stavem spojení;
- pevné chronologické pořadí;
- jméno autora a text, nikdy e-mail či firmu;
- ruční „Obnovit“, poslední úspěšnou synchronizaci a stav offline/reconnecting;
- nenásilné hlášení „N nových dotazů“ a tlačítko „Přejít na nové“;
- žádný automatický scroll, který by odsunul právě čtenou otázku;
- žádné checkboxy, slučování, hlasování ani stav „zodpovězeno“.

Polling musí deduplikovat podle `questionId`, dočíst všechny stránky nad současný limit 100, pozastavit se ve skryté záložce a po `401/403` nebo změně účtu okamžitě odstranit feed z paměti.

Zůstává REST polling podle ADR-006. SSE, WebSocket nebo Redis pub/sub nejsou pro tento rozsah potřeba.

### 5.3 Speaker follow-up

Doporučené route:

- `/host/dotazy` – skončené vlastní session a počty;
- `/host/dotazy/[sessionId]` – dotazy ke konkrétní session.

Server pustí uživatele jen pokud:

- má aktivní event membership a aktivní roli `speaker`;
- jeho `speakerProfiles.userId` je přes `sessionSpeakers` propojený s danou session;
- session je publikovaná, `questionMode = moderated_follow_up` a už skončila;
- `questionFollowUpsEnabled` je zapnutý;
- event je ve stavu `live` nebo `ended`, nikoli `draft`, `activation_open` či `archived`;
- pro publish má request platný idempotency key a verzi.

Speaker vidí pouze text otázky, čas odeslání a stav písemné odpovědi. Nevidí autora. Odpověď je prostý text, doporučeně 1–4000 znaků. Po publikaci ji může do archivace editovat pomocí optimistic concurrency; audit uchová aktéra a čas, ne plnou kopii textu v obecném audit logu.

## 6. Datový model a migrace

### 6.1 Session capability

Do `sessions` přidat enum `question_mode`:

- `disabled` – výchozí hodnota;
- `moderated_follow_up` – živý moderovaný sběr a následná písemná odpověď.

`questionsEnabled` zůstane provozní boolean. Výsledný stav sběru je průnik:

```text
event.questionsEnabled
AND session.questionMode = moderated_follow_up
AND session.questionsEnabled
AND session.status = published
AND startsAt <= now < endsAt
```

Backfill smí nastavit `moderated_follow_up` jen na explicitní whitelist session z pátku na BYZON Stage a Leadership Stage. Whitelist musí být dohledatelný v content seed/import datech a pokrytý testem; migrace ani request-time autorizace nesmí hádat podle názvu.

### 6.2 Písemné odpovědi

Přidat `question_answers`:

| Pole                                   | Pravidlo                                           |
| -------------------------------------- | -------------------------------------------------- |
| `id`                                   | UUID                                               |
| `eventId`, `sessionId`, `questionId`   | kompozitní tenant/session integrita                |
| `speakerProfileId`, `answeredByUserId` | skutečně linked speaker                            |
| `text`                                 | prostý text, 1–4000 znaků, bez řídicích/bidi znaků |
| `publishedAt`, `updatedAt`             | lifecycle                                          |
| `version`                              | optimistic concurrency, kladné celé číslo          |

Omezení a indexy:

- právě jedna odpověď na `questionId`;
- kompozitní FK brání cross-event a cross-session vazbě;
- speaker profil musí patřit stejnému eventu;
- index pro vlastní otázky autora a index pro unanswered feed speakera;
- text dotazu ani odpovědi se neukládá do obecného audit payloadu nebo aplikačního logu.

Není potřeba `answered` boolean na tabulce `questions`. Stav se vždy odvodí existencí odpovědi.

Do `event_features` přidat `question_followups_enabled boolean not null default false`. Flag řídí pouze nové speaker čtení/publish/edit operace. Owner read již publikovaných odpovědí zůstává dostupný i po jeho vypnutí.

### 6.3 Přístupová data

Pro přístup programových spolupracovníků není v doporučené variantě potřeba nová tabulka ani enum. Použijí se existující:

- ruční participant flow nebo SimpleShop import pro vytvoření participant baseline;
- membership, participant profil a role `participant` pro vstup do appky;
- `eventRoles.scope.sessionIds` nebo `roomIds` pro roster;
- `speakerProfiles.userId` + `sessionSpeakers` pro speaker ownership;
- admin audit pro změny scope a linků.

Je ale potřeba rozšířit správu aktivní role tak, aby jeden atomický grant uměl bezpečně obsahovat více session IDs. Současné omezení „jedna session nebo room při jednom přidělení“ nestačí pro sobotní dvoudílný mastermind ani vedoucí s více bloky.

### 6.4 Expand/contract postup

1. Expand migrace: nové enum/pole/tabulky/indexy, vše defaultně vypnuté.
2. Nasadit server, který umí starý i nový tvar a nic samo nezapne.
3. Zapsat explicitní Q&A whitelist a scoped role/speaker vazby.
4. Nasadit UI.
5. Provést staging rehearsal a teprve poté zapnout provozní flags.
6. Odstranění staré kompatibility je samostatný pozdější contract krok, ne součást eventového releasu.

Migrace musí být reverzibilní ve smyslu bezpečného vypnutí funkce; rollback aplikace nesmí vyžadovat mazání nasbíraných dotazů či odpovědí.

## 7. API a serverová autorizace

Všechny soukromé odpovědi používají stávající API problem/result konvence a hlavičku `Cache-Control: private, no-store`.

### 7.1 Interaction context

Přidat autoritativní owner-scoped context, například:

`GET /api/v1/sessions/:sessionId/question-context`

Vrací publikovanou identitu session a živý runtime stav:

```ts
{
  session: { id, title, startsAt, endsAt, roomName },
  state: 'unsupported' | 'disabled' | 'scheduled' | 'open' | 'closed',
  canSubmit: boolean,
  canReadOwn: boolean
}
```

Detail programu i samostatný formulář používají tentýž stav. Tím se odstraní rozdíl mezi immutable publication snapshotem a živým admin přepínačem. Pokud se místo nového endpointu zvolí serverový overlay v `participant-program.ts`, jeho ETag musí zahrnout runtime verzi; agent nesmí jen přepsat DTO bez invalidace cache.

### 7.2 Existující participant submit

Zachovat:

- `POST /api/v1/sessions/:sessionId/questions`
- participant membership a role check;
- event/session scoping;
- idempotency a rate limit.

Doplnit:

- `questionMode` a serverové časové okno;
- stabilní problem kódy pro `not_open`, `closed`, `unsupported`;
- žádné logování těla;
- korektní retry stejného requestu.

### 7.3 Vlastní dotazy účastníka

Přidat například:

- `GET /api/v1/me/questions`
- volitelné filtry `sessionId`, cursor a limit;

Vrací jen dotazy `authorUserId = actor.userId` a případnou publikovanou odpověď. Jiný participant nesmí získat cizí otázku ani znalostí UUID.

### 7.4 Moderátor

Zachovat read-only feed a doplnit:

- `GET /api/v1/moderator/sessions` – pouze aktivně přiřazené podporované session;
- obohacení feedu o session kontext a lifecycle;
- spolehlivé cursor stránkování.

Read policy existujících dotazů musí být oddělená od submit policy: provozní vypínač nebo konec session zastaví nový submit, ale nesmaže přiřazenému moderátorovi feed. Nepřidávat moderátorovi žádný endpoint pro změnu otázky.

### 7.5 Speaker

Přidat například:

- `GET /api/v1/speaker/question-sessions`
- `GET /api/v1/speaker/sessions/:sessionId/questions?status=unanswered`
- `PUT /api/v1/speaker/questions/:questionId/answer`
- `PATCH /api/v1/speaker/questions/:questionId/answer`

PUT/PATCH musí znovu na serveru ověřit event, session, čas, `questionMode`, aktivní membership, speaker roli a skutečnou speaker/session vazbu. Samotná role `speaker` nestačí. Přidat explicitní permission, například `question:own-session:answer`, s contextem `assignedSession`.

### 7.6 Admin setup vedoucích

Rozšířit stávající správu rolí o list/preview/apply/revoke kontrakty pro existující participanty z obou zdrojů; nezakládat paralelní admin identity modul. Mutace musí používat version/idempotency, transakci a audit. Server nebere role z klientem dodaného volného seznamu; role odvodí z UI presetu a potvrzeného session/room scope. Participant invitation zůstává existujícím samostatným krokem admin support flow.

## 8. Admin a QR

### 8.1 Q&A konfigurace

V `/admin/interakce`:

- ukázat pouze session s `questionMode = moderated_follow_up`;
- zobrazit den, čas, stage, stav okna, provozní toggle, moderátora a speaker-account coverage;
- nedovolit přiřadit moderátora k nepodporované session;
- uvést „Feed je soukromý a není určen k projekci“;
- přidat preflight: chybějící moderátor, chybějící linked speaker účet, draft/cancelled session, nevygenerovaný QR.
- přidat samostatný toggle a readiness stav speaker follow-upu.

Globální questions flag je emergency switch živého sběru. Per-session `questionsEnabled` je provozní toggle. Capability `questionMode` se nemění v live engagement obrazovce. Admin smí nastavit per-session toggle a přiřadit moderátora i při globálním OFF. Přechod questions flagu na ON musí ověřit, že každý zapínaný blok má moderátora. Zapnutí `questionFollowUpsEnabled` má samostatný preflight linked speaker účtů. Stejné autorizační pravidlo musí používat engagement API i obecné role API.

### 8.2 Rychlé stažení QR

V seznamu přednášek v `/admin/obsah`, přímo v řádku podporované publikované session:

- tlačítko „Stáhnout QR pro dotazy“;
- bez otevírání editace nebo další stránky;
- v záhlaví seznamu „Stáhnout všechna Q&A QR“.

Rozšířit stávající QR službu o explicitní target `questions`:

- deep link `/app/interakce/:sessionId`;
- pouze `questionMode = moderated_follow_up` a publikovaná, nezrušená session;
- SVG jedné session;
- ZIP jen podporovaných session s manifestem názvu, času, stage a filename;
- bezpečný lidsky čitelný filename bez osobních či přístupových údajů;
- existující obecný session QR na `/app/program/:id` zůstane zachovaný.

Jde o vědomou změnu starého `P12-05`: upravené zadání říká, že QR je druhý přímý vstup do prostoru pro dotazy, proto má Q&A varianta mířit rovnou na `/app/interakce/:sessionId`. Nezakládá se druhá QR knihovna ani druhý admin modul; jen nový target ve stávající službě.

QR může admin stáhnout před otevřením sběru. Cílová stránka tehdy vysvětlí, kdy se dotazy otevřou. Přihlášení musí zachovat interní `returnTo` a odmítnout open redirect.

## 9. Navigace a UX

Nevytvářet nový druhý portál. Využít společný přihlášený shell a roli zobrazit v sekci „Moje role“ nebo `/app/vice`:

- `Vedoucí aktivity` → existující `/host/aktivity`;
- `Moderování` → `/host/moderace`;
- `Dotazy k doplnění` → `/host/dotazy` s počtem.

Spodní participant navigace má zůstat kompaktní. Role-aware odkazy se nezobrazí lidem bez příslušné capability.

### Povinné UX detaily

- Formulář má viditelný label, počitadlo, jednoznačný submit stav a nesmaže text při chybě.
- Touch targets mají minimálně 44 × 44 px; textarea na mobilu alespoň 16px font.
- Moderátorský feed je ověřen v portrait i landscape na 768 a 1024 px bez horizontálního scrollu.
- Nové položky nekradou focus ani scroll.
- Celý feed není `aria-live`; oznamuje se jen atomický počet nových dotazů.
- Offline/reconnecting/closed stav není sdělen pouze barvou.
- Ověřit 320, 375, 414, 768 a 1024 px, 200% zoom, keyboard, reduced motion a axe.

## 10. Pracovní balíčky pro AI agenty

Jeden agent musí vlastnit všechny databázové migrace a sdílené doménové kontrakty. Paralelní agenti nesmí nezávisle generovat migration journal ani měnit stejný contract file.

### BYZON-AQ-00 — Scope reconciliation a ADR

**Závislosti:** žádné

**Vlastnictví:** dokumentace a explicitní session inventory

Úkoly:

- potvrdit z aktuálních content dat přesný whitelist pátečních session na dvou stage;
- potvrdit vedoucí a linked speaker profily pro coaching, oba mastermindy, networking a workshopy;
- rozhodnout kanonickou projekci pátečního networkingu a stabilní source speaker vazby;
- zapsat tento návrh jako nový ADR nebo dodatek k ADR-016;
- výslovně povolit ruční participant creation jako primární cestu programových spolupracovníků a SimpleShop jako alternativu;
- promítnout stejnou výjimku do `AI_IMPLEMENTATION_PLAN.md`, `docs/v6-scope-inventory.md` a `handover.md`, aniž by se povolila veřejná registrace nebo check-in;
- opravit zastaralé scope záznamy, které tvrdí, že speaker follow-up nebude;
- nepřenášet staré „Q&A not started“ checkboxy bez ověření reality kódu.

Akceptace:

- whitelist používá stabilní session ID/slug a očekávaný počet;
- žádná sobotní nebo nestage session není označena jako Q&A podporovaná;
- nejasný speaker účet je uveden v provisioning preflightu, ne nahrazen odhadem.

### BYZON-AQ-01 — Schema, migrace, kontrakty a permissions

**Závislosti:** AQ-00

**Vlastnictví:** jediný agent pro `packages/database`, sdílené `packages/domain` kontrakty a migrace

Úkoly:

- přidat `questionMode`;
- přidat default-OFF `questionFollowUpsEnabled`;
- přidat `question_answers`;
- přidat nové API DTO/problem kódy a speaker permission;
- backfillnout jen schválený Q&A whitelist;
- doplnit schema/contract/permission testy.

Akceptace:

- čistá databáze i upgrade existující databáze projdou;
- default je všude vypnutý;
- unique/FK/check constraints znemožní cross-event odpověď a druhou odpověď na stejný dotaz;
- migration test přesně ověří whitelist;
- starý submit/feed kontrakt zůstane kompatibilní.

### BYZON-DATA-02 — Kanonický content a activity reconciliation

**Závislosti:** AQ-00, AQ-01

**Vlastnictví:** jediný agent pro `static-site/data/content.json`, content import a jeho fixture/testy

Úkoly:

- zapsat schválené `questionMode` hodnoty do kanonického source/importu;
- nahradit křehké odvozování důležitých speaker vazeb explicitními slugs;
- opravit/ověřit vazbu Blanky Mrázkové a ostatních vedoucích;
- vyřešit kanonickou networking session, její typ a kapacitní precondition;
- ověřit coach rooms a dvoudílnou reservation group;
- vytvořit staging readiness report bez e-mailů v artefaktu.

Akceptace:

- opakovaný import zachová všechny schválené session/speaker vazby;
- přesný Q&A whitelist je deterministický a žádná session se nezařadí podle volného názvu;
- networking nevzniká jako dvě nejasně konkurenční rezervovatelné session;
- readiness report selže při chybějící místnosti, kapacitě, speaker vazbě nebo reservation group.

### BYZON-ACCESS-02 — Setup vedoucích backend

**Závislosti:** DATA-02

**Vlastnictví:** admin role/speaker setup server/API, ne UI

Úkoly:

- implementovat zdrojově nezávislý list ručních i importovaných kandidátů a preview/apply/revoke orchestration;
- znovu použít již implementovaný manual participant flow; nevytvářet jeho paralelní kopii;
- skládat speaker/room_operator role podle matice;
- rozšířit jeden aktivní role grant o atomický multi-session scope;
- doplnit datový preflight coach rooms, reservation group a kanonického networkingu;
- přidat audit a integrační testy;
- nezakládat účet či membership uvnitř role setupu; chybějícího člověka nejprve poslat do ručního participant flow nebo SimpleShop importu.

Hranice balíčku: ACCESS-02 pouze vyhledá a vybere existující participant baseline nebo admina odkáže na současnou obrazovku ručního přidání. Apply role operace nikdy ve stejné transakci nevytváří účet, membership či profil a neposílá pozvánku. Po ručním založení admin osobu znovu vybere v role setupu.

Akceptace:

- opakovaný apply nevytváří duplicity a scope je deterministický;
- ručně založený a importovaný participant dostanou stejné výsledné role a capability;
- bez aktivního participant účtu skončí setup čitelným precondition problémem s odkazem na ruční přidání;
- odebrání vedoucí role samo nezruší participant membership;
- coach nepotřebuje speaker profil;
- sobotní mastermind lze pokrýt jedním grantem se dvěma session IDs;
- žádný klientem upravený role payload nemůže rozšířit scope.

### BYZON-ACCESS-03 — Setup vedoucích v adminu a role hub

**Závislosti:** ACCESS-02

**Vlastnictví:** setup UI, host rozcestník a navigace

Úkoly:

- přidat preview/apply/revoke flow nad ručními i importovanými participanty;
- zobrazit stav membership/pozvánky a přesné scope;
- doplnit role-aware „Moje role“;
- zajistit explicitní `room_operator` kontrolu rosteru;
- odstranit implicitní speaker-only přístup k rosteru.

Akceptace:

- admin před potvrzením vidí každou odvozenou roli a scope;
- setup jasně odkáže na ruční přidání chybějícího participanta nebo odeslání participant pozvánky;
- speaker bez `room_operator` roster neotevře ani přímým URL;
- vedoucí vidí pouze vlastní session/room;
- participant část funguje nezávisle na host capability.

### BYZON-QA-02 — Runtime context a hardening živého sběru

**Závislosti:** AQ-01

**Vlastnictví:** participant Q&A server a runtime projection

Úkoly:

- zavést jednotný autoritativní context;
- doplnit capability a časové kontroly do submitu;
- rozdělit collection gate od read-existing policy moderátora a autora;
- opravit stale snapshot/runtime toggle problém;
- doplnit vlastní dotazy autora;
- zachovat idempotency, rate limit a no-store;
- přidat serverové integrační testy.

Akceptace:

- unsupported, disabled, scheduled, open a closed mají stabilní chování;
- crafted POST po konci nebo na sobotní session selže;
- žádný participant nevyčte cizí otázku;
- přepnutí adminem se projeví bez nové publikace programu;
- vypnutí sběru nesmaže ani neschová historii autora.

### BYZON-QA-03 — Participant formulář a vlastní odpovědi

**Závislosti:** QA-02

**Vlastnictví:** participant Q&A UI

Úkoly:

- doplnit kontext session a lifecycle;
- zachovat text a idempotency key přes retry;
- přidat „Moje dotazy“ a privátní speaker odpověď;
- opravit aktivní stav navigace a bezpečný auth return;
- doplnit komponentové a accessibility testy.

Akceptace:

- QR i detail programu vedou na stejný formulář;
- formulář nemůže tvrdit „odesláno“, když server submit odmítl;
- síťová chyba nesmaže rozepsaný text;
- participant vidí jen vlastní historii;
- text přesně vysvětluje, kdo dotaz kdy uvidí.

### BYZON-MOD-03 — Moderátorský seznam a tabletový feed

**Závislosti:** QA-02

**Vlastnictví:** moderator API/UI; nemění question mutace

Úkoly:

- vytvořit seznam přiřazených session;
- přesunout/sjednotit route pod `/host/moderace` a ponechat redirect;
- doplnit session kontext, stav spojení, stránkování, deduplikaci a reconnect;
- doplnit role-aware navigaci a tabletové testy.

Akceptace:

- moderátor nevidí nepřiřazenou ani cross-event session;
- více než 100 dotazů se dočte bez ztráty či duplicity;
- nový dotaz neposune právě čtený obsah;
- feed nemá žádnou mutační moderátorskou akci;
- po 401/403 se citlivý obsah okamžitě odstraní.

### BYZON-SPEAKER-03 — Speaker follow-up backend

**Závislosti:** AQ-01, QA-02

**Vlastnictví:** speaker question service/API

Úkoly:

- implementovat vlastní session feed a answer publish/edit;
- vynutit linked speaker vazbu, čas a question mode;
- anonymizovat autora;
- vyřešit multi-speaker konkurenci pomocí unique constraint a verze;
- doplnit integrační a authorization testy.

Akceptace:

- samotná role `speaker` bez session vazby nestačí;
- před `endsAt` speaker žádný text neobdrží;
- speaker nevidí jméno autora ani cizí session;
- současné dva publish requesty vytvoří právě jednu odpověď;
- edit cizím speakerem nebo se stale verzí skončí 403/409 podle příčiny.

### BYZON-SPEAKER-04 — Speaker a author UI

**Závislosti:** SPEAKER-03

**Vlastnictví:** `/host/dotazy` UI a zobrazení odpovědi autorovi

Úkoly:

- přidat seznam skončených vlastních session s počtem;
- přidat unanswered/answered pohled a editor;
- zobrazit autorovi publikovanou odpověď a identitu speakera;
- doplnit empty/error/conflict stavy a komponentové testy.

Akceptace:

- UI nikdy nepoužije jméno autora v speaker kontextu;
- session před koncem je nepřístupná i přes deep link;
- conflict druhého speakera neztratí rozepsaný text;
- žádná odpověď se nezobrazí jinému participantovi.

### BYZON-QR-02 — QR target a serverové filtrování

**Závislosti:** AQ-01

**Vlastnictví:** `session-qr` service/routes/tests

Úkoly:

- přidat target `questions`;
- filtrovat single i ZIP podle capability a publication stavu;
- přidat manifest a deterministické filenames;
- zachovat obecný programový QR;
- doplnit bezpečnostní testy deep linku.

Akceptace:

- unsupported/draft/cancelled session nevydá Q&A QR;
- QR neobsahuje token, e-mail ani externí identifikátor;
- ZIP obsahuje přesně schválený whitelist;
- login return je interní a odolný proti open redirectu.

### BYZON-ADMIN-03 — Admin Q&A a QR UI

**Závislosti:** QA-02, QR-02

**Vlastnictví:** engagement workspace a content session list

Úkoly:

- filtrovat Q&A workspace;
- zobrazit coverage/preflight;
- přidat default-OFF follow-up toggle se samostatným speaker coverage preflightem;
- přidat per-row a bulk download přímo do seznamu přednášek;
- doplnit admin komponentové testy.

Akceptace:

- QR je dostupný jedním klikem ze seznamu;
- session mimo scope nenabízí Q&A toggle ani QR;
- admin nemůže crafted requestem přiřadit moderátora nepodporované session;
- podporované session a moderátory lze kompletně připravit s globálním flagem OFF;
- globální questions ON odmítne chybějící moderátory a ukáže konkrétní readiness chyby;
- follow-up ON odmítne chybějící linked speaker účty;
- admin nemá endpoint ani UI na čtení textů dotazů.

### BYZON-QA-05 — Integrační QA, security a rehearsal

**Závislosti:** všechny předchozí balíčky

**Vlastnictví:** průřezové testy, runbook a release evidence

Úkoly:

- E2E všech rolí;
- IDOR/cross-event/time/rate-limit/cache testy;
- mobilní a tabletová UAT;
- staging QR rehearsal s reálným telefonem a dvěma tablety;
- aktualizace route mapy, ADR, runbooku a scope checklistů.

Akceptace:

- kompletní testovací matice z kapitoly 11 je zelená;
- produkční zapnutí má jmenovaného operátora a rollback postup;
- nezůstane žádný dokument, který tuto funkci mylně označuje současně jako nepovolenou a dokončenou.

## 11. Povinná testovací matice

### Autorizace a soukromí

- participant A nečte dotaz ani odpověď participanta B;
- moderátor A nečte session moderátora B ani jiný event;
- speaker bez aktivní role, membership, profilu nebo session linku dostane 403/404 bez leakage;
- speaker nečte před koncem a nečte identitu autora;
- organizer admin bez moderator role nečte texty;
- revoked role přestane fungovat bez nového přihlášení;
- response headers jsou `private, no-store`; service worker data neukládá;
- logy, telemetry a audit neobsahují question/answer body.

### Lifecycle a integrita

- před startem, přesně na startu, těsně před koncem a na konci;
- vypnutý global flag, vypnutá session, unsupported, draft, cancelled a archived event;
- odpověď po vypnutí sběru je stále možná podle follow-up pravidel;
- vypnutý follow-up zastaví speaker operace, ale neskrývá autorovi existující odpověď;
- idempotentní participant submit;
- jeden dotaz/jedna odpověď a multi-speaker race;
- edit s aktuální a stale verzí;
- více než 100 dotazů a shodné timestampy;
- reconnect, skrytá záložka, 401/403 a změna eventu/účtu.

### Přístup programových spolupracovníků

- ruční vytvoření založí aktivní membership, participant profil, participant roli a interní kompatibilní ticket, ale invitation zůstane `not_sent`;
- participant ze SimpleShop importu;
- pokus ručně založit duplicitu již importovaného nebo ručního e-mailu;
- manual → pozdější SimpleShop import zachová jeden user/profile/membership a jednu participant roli;
- SimpleShop-first → manual create rozpozná duplicitu a admin může vybrat existující osobu;
- chybějící participant baseline;
- participant invitation ručního zdroje vede do `/app`, nikoli `/admin`;
- přidání programové role samo neodešle e-mail;
- pozvaný a dosud nepozvaný participant;
- block/reactivate funguje i nad manuálním interním ticketem;
- interní ticket nelze stáhnout jako credential QR, použít pro check-in ani pro programový entitlement;
- více odvozených schopností jednoho člověka;
- bezpečná částečná revokace scoped rolí bez zrušení participant membership;
- kouč bez speaker profilu;
- sdílená reservation group sobotního mastermindu;
- multi-session scope a jeho atomická náhrada;
- session- a room-scoped roster;
- přímé API obejití UI scope.

### QR a klient

- single SVG a bulk ZIP přesně pro whitelist;
- scan před startem, během, po konci a bez přihlášení;
- safe `returnTo` a open redirect negativní případy;
- ztráta sítě při psaní a submitu;
- 320/375/414/768/1024 px, portrait/landscape, 200% zoom, keyboard a axe.

## 12. Doporučené pořadí a paralelizace

```text
Wave 0: AQ-00 scope/ADR
             |
Wave 1: AQ-01 schema + contracts + migration  (jeden vlastník)
          /          |             \
Wave 2: DATA-02     QA-02         QR-02
          |          /  \            |
Wave 3: ACCESS-02  MOD-03 SPEAKER-03 ADMIN-03
          |                       |
Wave 4: ACCESS-03        SPEAKER-04 + QA-03
                              \     /
Wave 5:                       QA-05
```

Praktická pravidla pro agenty:

- každý agent si před změnou ověří `git status` a zachová cizí rozpracované změny;
- migration journal a společné question contracts mění pouze AQ-01;
- API agenti používají kontrakty z AQ-01, nevytvářejí vlastní paralelní typy;
- UI agenti neduplikují autorizační logiku; zobrazují serverem vrácené capability;
- každá změna přidá cílené testy a spustí minimálně lint/typecheck/test pro dotčený workspace;
- agent předá seznam změněných souborů, spuštěných příkazů, výsledků a známých rizik;
- případná změna závazných pravidel z kapitoly 3 se vrací jako decision request, ne jako tichá implementační volba.

## 13. Rozhodovací brány před implementací

Přístup vedoucích a speakerů ručním participant flow je potvrzený a není zde už decision gate. Pro implementaci zbývá potvrdit nebo dodat:

1. **Viditelnost písemné odpovědi.** Doporučeno: pouze autor dotazu. Alternativa: všichni přihlášení účastníci, ale pak formulář musí před odesláním transparentně sdělit možnost publikace otázky.
2. **Otevření sběru.** Doporučeno: přesně od startu do konce session. Alternativa: explicitní `questionsOpensAt`, pokud se mají sbírat otázky už předem.
3. **Editace odpovědi.** Doporučeno: speaker může editovat do archivace eventu, každá změna je verzovaná a auditovaná metadaty.
4. **Panel s více speakery.** Doporučeno: právě jedna odpověď, první úspěšný publish vyhrává.
5. **Přesný Q&A whitelist – potvrzeno 7. 9. 2026.** 17 přednáškových/panelových session dle inventáře; EB21 a „Jak na networking“ mimo. Registrace, pauzy, jídlo, společné bloky a večerní networking jsou mimo.
6. **Kanonický páteční networking – potvrzeno 7. 9. 2026.** Leadership Stage je rezervovatelná; projekce Networking a afterparty pouze informativní. Kladná kapacita zůstává provozní precondition.
7. **Lidé a účty.** Dodat finální e-maily vedoucích, speakerů a moderátorů. Vedoucí a speakeři se standardně založí ručně; pokud už někdo existuje ze SimpleShopu, znovu se použije.
8. **Invitation delivery.** Ověřit produkčního e-mail providera, sender doménu a SPF/DKIM/DMARC. Jde o blocker odeslání a přihlašovacího UAT, nikoli blocker ručního založení lidí a přípravy rolí.

### Volitelný entitlement track pro běžné účastníky

Pokud „páteční mastermind/networking, sobotní mastermind/workshopy“ znamená, že různé ticket produkty odemykají různé session, jde o další samostatný epic:

- stabilní entitlement codes, například `friday_mastermind`, `friday_networking`, `saturday_mastermind`, `saturday_workshop:<slug>`;
- mapování SimpleShop produktů na granty bez zveřejnění externích product IDs klientovi;
- owner-scoped `access.state = open | eligible | not_eligible` v programu;
- serverová kontrola add-to-agenda, reserve, release i waitlist operací;
- sdílený entitlement obou částí sobotního mastermindu;
- jasná policy networkingu a toho, zda se workshopy prodávají jako balíček nebo jednotlivě;
- `private, no-store` projection a IDOR testy.

Tento track se nesmí implementovat jen podle názvů session nebo odhadu produktů. Vyžaduje potvrzené SimpleShop mapování a obchodní pravidla.

Entitlement track se netýká ručního provisioningu koučů, vedoucích ani speakerů a zůstává neaktivní, dokud nevznikne nové samostatné produktové rozhodnutí.

## 14. Rollout a provoz

1. Nasadit expand migraci a kód s `questionsEnabled` i `questionFollowUpsEnabled` vypnutými.
2. Na stagingu importovat/potvrdit přesný Q&A whitelist.
3. Vedoucí a speakery založit ručně, případně znovu použít ty, kteří už přišli ze SimpleShop importu.
4. Připravit scoped role a speaker vazby, poté explicitně odeslat participant pozvánky a ověřit přihlášení/onboarding.
5. Ověřit preflight každé podporované session a přiřadit moderátory.
6. Stáhnout a fyzicky naskenovat každý QR; zkontrolovat session kontext a login return.
7. Projít rehearsal: participant submit → tablet feed → konec session → speaker answer → odpověď jen autorovi.
8. Zapnout per-session toggles a globální questions flag až v dohodnutém provozním okamžiku; follow-up flag až po speaker/author UAT.
9. Během eventu sledovat pouze technické metriky: latency, rate-limit a chybovost; ne obsah dotazů.
10. Při problému vypnout nový sběr globálním flagem. Historie a follow-up zůstanou čitelné; data se nemažou.

## 15. Definition of Done

Funkce je hotová až když platí vše:

- všichni potvrzení vedoucí a speakeři vzniknou ručním participant flow nebo SimpleShop importem, dostanou participant pozvánku a nevzniknou duplicitní identity;
- každý vidí jen vlastní role-aware nástroje a přesně scoped roster;
- Q&A lze provozně zapnout jen na explicitně podporovaných pátečních session;
- QR je jedním klikem dostupný ze seznamu přednášek a vede přímo do správného dotazového prostoru;
- submit je otevřen jen během session;
- moderátor má stabilní read-only tabletový feed bez workflow navíc;
- speaker vidí anonymizované dotazy až po vlastní session a může publikovat jednu písemnou odpověď;
- odpověď vidí jen autor původního dotazu;
- žádný dotaz ani odpověď se neobjeví na projekci, veřejné stránce, cizím účtu, v cache nebo v logu;
- staging mobile/tablet rehearsal, authorization testy, accessibility testy a rollback drill jsou doložené;
- ADR, route map, runbook a scope inventory odpovídají skutečně nasazenému chování.
