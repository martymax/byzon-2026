# Datový model

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Integrace »](./04-integrace.md)

---

## Datový model (schéma) – event-management + event-day aplikace BYZON 2026

Tento návrh definuje relační schéma (cíl: **Supabase/Postgres**, viz technický podklad). Klíčová zásada: **`content.json` zůstává single source of truth pro marketing web a build.py**; aplikace data **importuje** seed skriptem do DB. Read-only obsah (program, řečníci, partneři) se do DB zrcadlí kvůli foreign keys na stavové entity (agenda, Q&A, schůzky), ale autoritativní zdroj zůstává v repu. Stavové entity (účty, schůzky, networking, Q&A) žijí **pouze v DB**.

### 0. Konvence napříč schématem

| Konvence | Volba | Důvod |
|---|---|---|
| Primární klíč | `uuid` (`gen_random_uuid()`) u stavových entit; `slug`/stabilní `id` u importovaných (speaker, session) | UUID se nedá uhodnout (důležité pro QR tokeny); slug umožní idempotentní re-import z `content.json` |
| Časová razítka | `created_at`, `updated_at` (`timestamptz`, default `now()`) na všech tabulkách | Audit, retence, řazení |
| Časy akce | vždy `timestamptz` v `Europe/Prague`, ne `time` string | Stávající `event.time` je jen řetězec → při migraci převést na plné `timestamptz` (datum dne + čas) |
| Soft delete | `deleted_at timestamptz NULL` u entit s GDPR výmazem (profily, zprávy) | Právo na výmaz vs. referenční integrita |
| Tenancy | `edition` (FK na `Edition`, např. "byzon-2026") na všech stavových entitách | Opakování akce ročně bez migrace; filtruje data ročníku |
| RLS | Row-Level Security policy na každé tabulce s osobními daty | Supabase pattern; účastník vidí jen povolené |

---

### 1. Identita, vstupenky, role

#### `Edition` (ročník)
Obálka pro multi-tenancy (2026, 2027…). Drží konfiguraci akce.
- `id` (slug, PK, "byzon-2026"), `name`, `starts_at`, `ends_at`, `venue`, `simpleshop_form_id`, `simpleshop_campaign_id`, `feature_flags jsonb`.
- Vztahy: `Edition 1:N` vše ostatní (volně, přes `edition_id`).

#### `User` / `Account`
Identita účastníka/řečníka/admina. Auth řeší **Supabase Auth** (magic-link, bez hesel – ladí s "žádné účty" filozofií), tato tabulka je profilová nadstavba (`id` = `auth.users.id`).

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid (PK = auth.uid) | |
| `email` | citext, unique | párovací klíč na SimpleShop |
| `full_name` | text | |
| `phone` | text NULL | |
| `locale` | text default 'cs' | |
| `created_at`, `last_seen_at` | timestamptz | |

- **Role** řeš zvlášť (1:N), ne enum na User – jeden člověk může být zároveň speaker i attendee.

#### `UserRole` (N:M User↔Role v rámci Edition)
- `user_id` (FK), `edition_id` (FK), `role` (enum: `attendee`, `speaker`, `partner_rep`, `organizer`, `admin`, `staff_checkin`, `moderator`), `granted_at`, `granted_by`.
- PK složený (`user_id`, `edition_id`, `role`). Index na (`edition_id`, `role`).

#### `Order` (objednávka ze SimpleShop)
Zrcadlo platby. Plněno **webhookem "po platbě"** + dotažením přes SimpleShop API (Basic auth, backend-only).

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `simpleshop_order_code` | text, unique | párovací/verifikační token |
| `email` | citext | párování s User |
| `user_id` | uuid FK NULL | doplní se po prvním přihlášení |
| `status` | enum (`pending`,`paid`,`cancelled`,`refunded`) | |
| `amount`, `currency` | numeric, text | |
| `coupon_code` | text NULL | |
| `custom_fields` | jsonb | dotazníková data ze SimpleShop (firma, IČ, dieta, networking opt-in) |
| `raw_payload` | jsonb | celý webhook/API payload pro audit |
| `paid_at`, `created_at` | timestamptz | |

- Vztah: `Order 1:N Ticket`. `Order N:1 User` (přes email/code).

#### `Ticket` (jednotlivá vstupenka)
Jedna objednávka může obsahovat víc lístků (firemní nákup).

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid FK | |
| `attendee_user_id` | uuid FK NULL | komu lístek patří (může se lišit od kupujícího) |
| `ticket_type` | enum (`early_bird`,`standard`,`late_bird`,`speaker`,`partner`,`staff`,`vip`) | |
| `qr_token` | uuid, unique, indexed | check-in identifikátor (ne pořadové číslo!) |
| `checked_in_at` | timestamptz NULL | |
| `checked_in_by` | uuid FK NULL | staff |

- **Identita pro check-in:** sken čte `qr_token`, ověří proti DB, zapíše `checked_in_at`. UUID brání podvržení.

---

### 2. Networking profil a propojení

#### `AttendeeProfile` (1:1 s User, jen pro účastníky s opt-inem)
Srdce networkingu. **Privacy-by-default (GDPR čl. 25):** profil existuje, ale `visibility` default `hidden`, dokud účastník nedá explicitní souhlas.

| Atribut | Typ | Pozn. |
|---|---|---|
| `user_id` | uuid PK/FK | |
| `edition_id` | uuid FK | |
| `headline` | text | "CEO @ firma" |
| `company` | text | |
| `position` | text | |
| `bio` | text NULL | |
| `photo_asset_id` | uuid FK→File NULL | |
| `links` | jsonb | {linkedin, web, instagram} |
| `visibility` | enum (`hidden`,`attendees_only`,`public`) default `hidden` | stavový flag, ne implicitní |
| `looking_for` | text NULL | "hledám" (intent) |
| `offering` | text NULL | "nabízím" (intent) |
| `consent_networking_id` | uuid FK→ConsentRecord | prokazatelný souhlas |

- Vztahy: `AttendeeProfile N:M Interest` (přes `ProfileInterest`).

#### `Interest` / `Tag` + `ProfileInterest` (N:M)
Číselník zájmů/oborů pro matchmaking a filtry.
- `Interest`: `id`, `slug`, `label`, `category` (obor/téma/role).
- `ProfileInterest`: (`user_id`, `interest_id`) – PK složený. Slouží matchmakingu (skóre = překryv zájmů + intent).

#### `Connection` (N:M User↔User, networking spojení)
Symetrické spojení (jako LinkedIn connect).

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `requester_id`, `addressee_id` | uuid FK | |
| `status` | enum (`pending`,`accepted`,`declined`,`blocked`) | |
| `created_at`, `responded_at` | timestamptz | |

- Constraint: unique (`least(requester,addressee)`, `greatest(...)`) – zabránit duplicitě obou směrů. Index na (`addressee_id`,`status`) pro "moje žádosti".

#### `Meeting` (schůzka 1:1 / malá skupina)
Řízený networking – core pozicování. Slot + meeting point.

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `edition_id` | uuid FK | |
| `organizer_id` | uuid FK | kdo navrhl |
| `starts_at`, `ends_at` | timestamptz | sloty v networking blocích |
| `location` | text / FK→`Room` NULL | meeting point |
| `status` | enum (`proposed`,`confirmed`,`declined`,`cancelled`,`completed`) | detekce zrušení → náhrada |
| `managed_by_organizer` | bool | VIP/hosted schůzky řízené pořadatelem (Brella model) |
| `note` | text NULL | |

- `Meeting N:M User` přes **`MeetingParticipant`** (`meeting_id`,`user_id`,`response` enum `accepted/declined/tentative`). Index na (`user_id`,`starts_at`) pro detekci kolizí ve slotu.

#### `Thread` + `Message` (chat 1:1)
- `Thread`: `id`, `edition_id`, typ (`direct`), `created_at`. `Thread N:M User` přes `ThreadParticipant`.
- `Message`: `id`, `thread_id` FK, `sender_id` FK, `body` (šifrovat at-rest – GDPR), `sent_at`, `read_at` NULL, `deleted_at` NULL.
- Index na (`thread_id`,`sent_at`). Retence: smazat ~30–90 dní po akci.

---

### 3. Program (rozšíření stávajícího modelu)

Stávající `content.json`: `program.days[] → stages[] → events[]{time,title,type,meta,span}`. **Anonymní eventy bez ID** → pro stavové vazby (agenda, Q&A, kapacita) je nutné dát každému eventu **stabilní `id`** už v `content.json` (např. `s1-09-00-keynote`). Migrace doplní ID a build.py je začne emitovat (zachová single source).

#### `Stage` (importováno z `stages[]`)
- `id` (slug), `edition_id`, `name` ("BYZON Stage","Leadership Stage"), `order`, `color`.

#### `Room` (nové – mapa Clarionu)
Fyzický prostor (sál, workshopová místnost, networking point). Nutné pro PWA mapu a meeting pointy.
- `id`, `edition_id`, `name`, `floor`, `capacity`, `map_x`,`map_y` NULL.
- `Stage N:1 Room` (stage probíhá v sále).

#### `Session` / `Event` (rozšíření `events[]`)
Centrální entita programu. Importuje se z `content.json`, **rozšířená o stavové atributy**.

| Atribut | Typ | Zdroj |
|---|---|---|
| `id` | text PK (slug) | **nově doplnit do content.json** |
| `edition_id` | uuid FK | |
| `stage_id` | text FK | z `stages[]` |
| `room_id` | uuid FK NULL | nové |
| `title` | text | z `events[].title` |
| `type` | enum (`shared`,`talk`,`panel`,`workshop`,`break`,`meal`,`discussion`,`networking`,`gala`) | z `events[].type` |
| `starts_at`, `ends_at` | timestamptz | derivováno z `events[].time` + den |
| `span` | int | z `events[].span` (vizuální) |
| `meta` | jsonb | z `events[].meta` |
| `description` | text NULL | nové |
| `capacity` | int NULL | nové – jen workshopy (řízení kapacity) |
| `requires_registration` | bool default false | nové – workshopy/limitované |
| `slides_asset_id` | uuid FK→File NULL | sdílení prezentací |
| `qa_enabled`, `poll_enabled` | bool | nové |

- Vztahy: `Session N:M Speaker` (přes `SessionSpeaker`), `Session N:M Tag` (přes `SessionTag`), `Session 1:N Question/Poll/WorkshopRegistration/AgendaItem`.

#### `SessionSpeaker` (N:M)
- (`session_id`,`speaker_id`,`role` enum `speaker/moderator/host`). PK složený.

#### `SessionTag` (N:M Session↔Interest/Tag)
- Pro doporučování sessions dle profilu a filtry.

#### `AgendaItem` (N:M User↔Session – osobní agenda)
"Moje agenda"/bookmark.
- `user_id` FK, `session_id` FK, `added_at`, `reminder_optin` bool. PK (`user_id`,`session_id`).
- Index na (`user_id`) pro "moje agenda", na (`session_id`) pro popularitu/analytiku.

#### `WorkshopRegistration` + waitlist
Workshopy s `capacity` – řízená registrace + pořadník.

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | FK | jen `requires_registration=true` |
| `user_id` | FK | |
| `state` | enum (`registered`,`waitlisted`,`cancelled`) | |
| `position` | int NULL | pořadí ve waitlistu |
| `registered_at` | timestamptz | |

- Unique (`session_id`,`user_id`). Kapacitu vynutit **transakčně** (advisory lock / `SELECT … FOR UPDATE` na count) – jinak race condition při souběžné registraci. Při uvolnění místa promote prvního z waitlistu.

---

### 4. Řečníci a sběr podkladů

#### `Speaker` (importováno z `content.json speakers[]`)
Autoritativní zdroj zůstává `content.json` (marketing web). DB drží kopii kvůli FK.

| Atribut | Typ | Zdroj |
|---|---|---|
| `id`/`slug` | text PK | z `speakers[].slug` |
| `edition_id` | uuid FK | |
| `name`, `role` | text | content.json |
| `photo` | text (URL/path) | content.json |
| `bio` | text[] / jsonb | `speakers[].bio[]` |
| `links` | jsonb | `{linkedin,web,instagram,youtube}` |
| `user_id` | uuid FK NULL | propojení na účet (pro speaker portál) |

#### `SpeakerSubmission` (speaker upload portál)
Self-service příjem podkladů s deadliny – odlehčí tým.

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `speaker_id` | FK | |
| `session_id` | FK NULL | k jaké přednášce |
| `type` | enum (`bio`,`photo`,`slides`,`tech_rider`,`headshot`,`consent`) | |
| `asset_id` | uuid FK→File NULL | nahraný soubor |
| `text_value` | text NULL | u bio |
| `status` | enum (`requested`,`submitted`,`approved`,`rejected`,`revision`) | schvalování |
| `due_at` | timestamptz | deadline → připomínky |
| `reviewed_by` | uuid FK NULL | |

- Vztah: `Speaker 1:N SpeakerSubmission`. Index (`status`,`due_at`) pro dashboard "co chybí".

---

### 5. Interakce: Q&A, ankety

#### `Question` (Q&A per session – Sli.do styl)
- `id` uuid PK, `session_id` FK, `author_id` FK NULL (anonymní → NULL + `is_anonymous` bool), `edition_id`, `body` text, `status` enum (`pending`,`approved`,`answered`,`hidden`,`dismissed`), `upvote_count` int (denormalizováno), `created_at`, `answered_at` NULL.
- Moderace přes `status` + RLS (nepublikované vidí jen moderátor). Index (`session_id`,`status`,`upvote_count desc`) pro řazení dle hlasů.

#### `QuestionVote` (N:M User↔Question – upvoting)
- (`question_id`,`user_id`) PK složený – brání dvojhlasu. Trigger udržuje `upvote_count`.

#### `Poll` + `PollOption` + `PollVote`
Live ankety/kvízy.
- `Poll`: `id`, `session_id` FK NULL, `edition_id`, `question` text, `type` enum (`single`,`multiple`,`wordcloud`,`rating`,`quiz`), `status` enum (`draft`,`open`,`closed`), `opened_at`,`closed_at`.
- `PollOption`: `id`, `poll_id` FK, `label`, `is_correct` bool NULL (kvíz), `order`.
- `PollVote`: `id`, `poll_id` FK, `option_id` FK NULL (u wordcloud `text_answer` text), `user_id` FK NULL (anonymní), `created_at`. Unique (`poll_id`,`user_id`) u single-choice.
- Realtime: INSERT do `PollVote` → Supabase Realtime push agregace. Pro stovky účastníků agregovat server-side (materializovaný count), ne počítat na klientu.

---

### 6. Notifikace, oznámení

#### `Announcement` (broadcast od pořadatele)
- `id`, `edition_id`, `title`, `body`, `audience` enum (`all`,`attendees`,`speakers`,`partners`,`stage:<id>`), `publish_at`, `created_by`.
- `Announcement 1:N Notification` (fan-out při publikaci).

#### `Notification` (per-user doručení / push)
- `id`, `user_id` FK, `edition_id`, `type` enum (`agenda_reminder`,`announcement`,`meeting_request`,`connection_request`,`session_starting`,`workshop_promoted`,`message`), `payload` jsonb, `channel` enum (`push`,`inapp`,`email`), `read_at` NULL, `sent_at`, `created_at`.
- Index (`user_id`,`read_at`) pro badge počtu nepřečtených.

#### `PushSubscription` (Web Push / VAPID)
- `id`, `user_id` FK, `endpoint`, `p256dh`, `auth`, `user_agent`, `created_at`. Jeden user N zařízení. GDPR: vázáno na opt-in souhlas.

---

### 7. Partneři, leady, gamifikace

#### `Partner` / `Sponsor` (importováno z `stante-se-partnerem` dat)
- `id`/slug, `edition_id`, `name`, `tier` enum (`title`,`gold`,`silver`,`partner`,`media`), `logo_asset_id`, `description`, `links` jsonb, `booth_room_id` FK NULL.
- `Partner N:M User` přes `PartnerRep` (kdo skenuje leady za partnera).

#### `Lead` (lead retrieval)
Hodnota pro partnery balíčků – hmatatelné ROI.
- `id`, `partner_id` FK, `scanned_by` (user FK – rep), `attendee_user_id` FK (sken QR účastníka), `score` enum (`hot`,`warm`,`cold`) NULL, `note` text NULL, `qualifier` jsonb NULL (kvalifikační dotazník), `scanned_at`.
- **GDPR:** sken leadu = předání kontaktu partnerovi → nutný souhlas účastníka (opt-in na badge/v profilu). Index (`partner_id`,`scanned_at`) pro export.

#### `GamificationPoint` + `Badge` (COULD)
- `GamificationPoint`: `id`, `user_id`, `edition_id`, `action` enum (`checkin`,`session_attend`,`connection`,`poll_vote`,`booth_visit`), `points` int, `created_at`.
- `Badge`: číselník (`id`,`label`,`icon`,`criteria` jsonb). `UserBadge` (N:M, `awarded_at`).

#### `Rating` / `Feedback` (post-event + per-session)
- `id`, `edition_id`, `user_id` FK NULL, `target_type` enum (`session`,`speaker`,`event_overall`), `target_id` text, `score` int (1–5), `comment` text NULL, `created_at`. Index (`target_type`,`target_id`).

---

### 8. GDPR, audit, soubory

#### `ConsentRecord` (prokazatelný souhlas – GDPR čl. 7)
Každý opt-in jako samostatný záznam.

| Atribut | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | FK | |
| `purpose` | enum (`networking_profile`,`marketing_email`,`photo_marketing`,`lead_sharing`,`push_notifications`) | granulární |
| `granted` | bool | opt-in/odvolání |
| `consent_text` | text | znění, na které odsouhlasil |
| `version` | text | verze textu |
| `ip`, `user_agent` | text | prokazatelnost |
| `created_at` | timestamptz | timestamp souhlasu |

- **Append-only** (odvolání = nový záznam `granted=false`, nepřepisovat). Aktuální stav = poslední záznam per (`user`,`purpose`).

#### `File` / `Asset`
Úložiště Supabase Storage; tabulka = metadata.
- `id`, `edition_id`, `owner_id` FK NULL, `kind` enum (`speaker_photo`,`slides`,`partner_logo`,`profile_photo`,`event_photo`), `storage_path`, `mime`, `size_bytes`, `width`,`height` NULL, `created_at`.

#### `AuditLog` (append-only)
- `id` (bigserial), `edition_id`, `actor_id` FK NULL, `action` text, `entity_type` text, `entity_id` text, `diff` jsonb NULL, `ip`, `created_at`.
- Pro admin akce (smazání účastníka, schválení submission, refund). Index (`entity_type`,`entity_id`), (`actor_id`,`created_at`).

---

### 9. Textový ER diagram (Entity → vztahy)

```
Edition → 1:N vše (edition_id na stavových entitách)

User
 ├─ 1:N UserRole (N:M User↔Role v Edition)
 ├─ 1:1 AttendeeProfile
 ├─ 1:N Order (přes email), 1:N Ticket (attendee)
 ├─ N:M User (Connection: requester/addressee)
 ├─ N:M Meeting (přes MeetingParticipant)
 ├─ N:M Thread (přes ThreadParticipant) → 1:N Message
 ├─ 1:1 Speaker (NULL, pokud řečník)
 ├─ N:M Session (AgendaItem; WorkshopRegistration)
 ├─ 1:N Question, QuestionVote, PollVote
 ├─ 1:N Notification, PushSubscription
 ├─ 1:N ConsentRecord, GamificationPoint, UserBadge, Rating
 └─ N:M Partner (PartnerRep)

Order → 1:N Ticket;  Order N:1 User (email + order_code)
Ticket → N:1 Order;  qr_token → check-in

AttendeeProfile → N:M Interest (ProfileInterest); → 1 ConsentRecord(networking); → 0:1 File(photo)

Session → N:1 Stage → N:1 Room
Session → N:1 Edition
Session → N:M Speaker (SessionSpeaker)
Session → N:M Interest/Tag (SessionTag)
Session → 1:N AgendaItem, WorkshopRegistration, Question, Poll
Session → 0:1 File(slides)

Speaker → 1:N SpeakerSubmission → 0:1 File(asset)
Speaker → 0:1 User

Question → N:1 Session; → 1:N QuestionVote (N:M User)
Poll → 1:N PollOption; → 1:N PollVote;  Poll N:1 Session(NULL)

Announcement → 1:N Notification (fan-out)
Partner → 1:N Lead;  Lead → N:1 attendee(User), N:1 scanned_by(User/rep)
Partner → 0:1 Room(booth)

ConsentRecord, AuditLog → append-only
File ← referencováno z AttendeeProfile, Session, Speaker, Partner, SpeakerSubmission
```

---

### 10. Napojení na `content.json` – co migrovat, co nechat

| Data v `content.json` | Akce | DB cíl | Pozn. |
|---|---|---|---|
| `program.days[].stages[]` | **Import (zrcadlo)** | `Stage` | autoritativní zůstává repo |
| `program…events[]` | **Import + rozšíření** | `Session` | **nutno doplnit stabilní `id` do content.json** + odvodit `timestamptz` z `time`+den |
| `event.type/meta/span` | Import 1:1 | `Session.type/meta/span` | enum sjednotit |
| `speakers[]` | **Import (zrcadlo)** | `Speaker` | bio[]→jsonb, links→jsonb |
| Texty homepage, ceny, VOP, partneři (marketing copy) | **NEMIGROVAT** | – | zůstává čistě statické, build.py beze změny |
| Ceny vstupenek / SimpleShop embed | **NEMIGROVAT** | – | prodej dál přes SimpleShop iframe |

**Migrační/seed proces (idempotentní):**
1. Build.py rozšířit, aby každý `event` měl `id` (deterministicky z stage+čas+slug titulu) → emituje se do HTML i do JSON.
2. Seed skript (`seed_from_content.py` / Supabase migration) čte `content.json` a **upsertuje** `Stage`, `Session`, `Speaker`, `SessionSpeaker` podle `id`/`slug` (re-run bezpečný).
3. Stavové tabulky se seedem **netýkají** – vznikají jen běhovým provozem app.
4. Změna programu = edit `content.json` → rebuild webu **i** re-seed DB (jedna změna, dvě konzumace). `content.json` zůstává single source of truth.

| Funkce | Co dělá | Hodnota | Priorita | Závislosti | Odhad |
|---|---|---|---|---|---|
| Doplnění `id` do events + seed Stage/Session/Speaker | Stabilní identita programu pro všechny stavové vazby | Bez ID nejde agenda, Q&A, kapacita | **MUST** | build.py úprava, content.json | **S–M** |
| User/Order/Ticket + SimpleShop párování | Identita + ověřená vstupenka | Vstup do app, check-in, QR | **MUST** | SimpleShop webhook/API, backend | **M** |
| AttendeeProfile + Consent + Interest | Networking základ s opt-inem | Core pozicování, GDPR-safe | **SHOULD** | User, ConsentRecord | **M** |
| Meeting/Connection/Thread | Řízený networking | Měřitelné ROI účastník/partner | **SHOULD** | Profile, Realtime | **L** |
| Question/Poll/Vote | Live interakce | Oživení stagů, data řečníkům | **SHOULD** | Session, Realtime | **M** |
| WorkshopRegistration + Waitlist | Kapacitní řízení workshopů | Logistika, férové pořadí | **SHOULD** | Session.capacity, transakce | **M** |
| Lead/Partner | Lead retrieval | ROI pro partnery | **SHOULD** | Ticket QR, consent | **M–L** |
| Gamification/Badge/Rating | Engagement, feedback | Retence, post-event data | **COULD** | běhové entity | **M** |

---

### 11. Poznámky k indexům a identitě

- **QR/check-in token = `uuid`, ne sekvenční číslo** – zamezí enumeraci a podvržení vstupenky. Unique index na `Ticket.qr_token`.
- **Párovací klíč SimpleShop:** `email` (primární) + `simpleshop_order_code` (verifikační). Unique na `order_code`; `email` jako `citext` (case-insensitive). Magic-link na e-mail z objednávky → bez hesel.
- **N:M tabulky** mají složený PK (žádný surrogate) tam, kde nehrozí potřeba samostatné reference: `ProfileInterest`, `SessionSpeaker`, `AgendaItem`, `QuestionVote`, `UserRole`. `Meeting`, `Connection`, `Message` mají vlastní `uuid` (jsou referencované / mají stav).
- **Connection deduplikace:** unique index na `(least(requester_id,addressee_id), greatest(...))` – jedna hrana bez ohledu na směr.
- **Časté dotazy → indexy:** `AgendaItem(user_id)`, `Session(edition_id, starts_at)`, `Question(session_id, status, upvote_count desc)`, `MeetingParticipant(user_id, starts_at)` (kolize slotů), `Notification(user_id, read_at)`, `Lead(partner_id, scanned_at)`, `Order(email)`, `UserRole(edition_id, role)`.
- **Denormalizace s triggerem:** `Question.upvote_count`, `Poll` agregace votů – udržovat triggerem/materializovaně, nepočítat za běhu (stovky souběžných hlasů).
- **RLS jako bezpečnostní hranice:** každý SELECT osobních dat filtrován dle `auth.uid()` a `visibility`/`status`. Skrytý profil (`visibility=hidden`) se v žádném dotazu ostatních nesmí objevit – vynutit policy, ne aplikační logikou.
- **Retence (GDPR) přes `deleted_at` + cron:** `Message`/`Thread`/`AttendeeProfile` mazat 30–90 dní po akci; `Order`/`Ticket` držet 10 let (účetnictví); `ConsentRecord`/`AuditLog` append-only do odvolání/legislativní lhůty.
- **Multi-edition:** `edition_id` na všech stavových entitách + ve většině indexů jako první sloupec → ročník 2027 bez schema migrace, čistá izolace dat.
- **Identita importovaných vs. stavových:** importované (`Stage`,`Session`,`Speaker`,`Partner`) klíčované **slugem** (idempotentní upsert z `content.json`); stavové (`User`,`Order`,`Meeting`…) klíčované **uuid** (generované DB). Tím se nikdy nekříží autorita repo vs. DB.
