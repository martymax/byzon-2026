# BYZON 2026 – inventář v6 scope alignmentu

> Stav k 16. srpnu 2026: `P0-10` dokončen pro schéma, runtime kontrakty,
> permissions, syntetické fixtures, mockované UI a route graf.
>
> Lifecycle: scope-aligned kontrakty a preview nejsou produkční integrace ani
> UAT. Otevřené integrační úkoly a blockery zůstávají v
> [`AI_IMPLEMENTATION_PLAN.md`](../AI_IMPLEMENTATION_PLAN.md).

## Metoda

Audit porovnal všechna rozhodnutí `SCOPE-2026-01` až `SCOPE-2026-12` s:

- Drizzle schématem a dopřednými migracemi v `packages/database`;
- Zod kontrakty, rolemi a permissions v `packages/domain`;
- contract-validovanými fixtures v `packages/test-support`;
- produkčními routes, komponentami, typed porty a dev/test mocky v
  `apps/conference`;
- route mapou, ADR a frontendovým handoverem.

Vyřazená funkce nesmí mít produkční route, kladnou kontraktovou větev, CTA ani
oprávnění. Starší enum hodnota může zůstat ve fyzickém schématu pouze kvůli
historickým datům, pokud ji aktuální doménový kontrakt nepřijímá a nevydává.
Tím se před akcí neprovádí destruktivní přepis consentů nebo session historie.

## Výsledek podle rozhodnutí

| Rozhodnutí                                               | Schéma a feature flags                                                        | Kontrakt/permission                                                                                  | Route, fixture a UI                                                                                       | Výsledek                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `SCOPE-2026-01` menší Gate A, bez social wall            | `social_wall_enabled` je jen historické pole, default `false`                 | bez social-wall kontraktu a permission                                                               | žádná route ani fixture                                                                                   | aligned                                                                      |
| `SCOPE-2026-02` networking jen Priority B adresář        | profilová DB pole jsou retenční základ; flag zůstává vypnutý pro Gate A       | pouze directory read/moderation; žádné connection/message/report permission                          | žádné spojení, zprávy, meetingy ani reporting routes/CTA                                                  | aligned pro Gate A; Priority B `P11` nezačala                                |
| `SCOPE-2026-03` řečník bez portálu                       | `speaker` enum a publikované profily mohou zůstat kvůli historii/obsahu       | legacy `speaker` dostává jen běžná participant oprávnění; žádné materials/answer permission          | pouze veřejný participant obsah `/app/recnici`; bez `/speaker`                                            | aligned                                                                      |
| `SCOPE-2026-04` partner bez role/portálu                 | partnerský obsah je publikovaná entita                                        | bez partner role a permission                                                                        | `/app/partneri` pouze loga/odkazy; bez partner účtu                                                       | aligned                                                                      |
| `SCOPE-2026-05` prosté dotazy bez votes/polls/projection | historický `polls_enabled` default `false`; otázky jsou Priority B            | žádný vote/poll/answer kontrakt                                                                      | žádná questions/moderator/projection route; `P12` nezačala                                                | aligned pro Gate A                                                           |
| `SCOPE-2026-06` jen kritická oznámení                    | `announcements_enabled` je per event                                          | severity pouze `critical`, audience pouze event nebo dotčené sessions, send jen admin                | participant inbox a admin preview/send nemají info/important/reminder větev                               | aligned jako `UI ready (mocked)`; server `P8` otevřen                        |
| `SCOPE-2026-07` bez plánku, materiálů a self-exportu     | nový nullable `participant_profiles.phone`; historické legal enumy se nemažou | profil má validovaný dobrovolný E.164 telefon; privacy mutation jen výmaz; bez own-export permission | `/app/profil` telefon, `/app/soukromi` zveřejněný support kontakt a deletion; bez map/material/export CTA | aligned jako kontrakt/preview; migrace `0005_charming_black_cat.sql`         |
| `SCOPE-2026-08` rezervace a FIFO                         | historický `capacity_mode=registration_estimate` zůstává jen ve storage enumu | agenda DTO/action estimate odmítá; rezervace/waitlist zůstávají                                      | estimate fixture, mock handler a CTA odstraněny                                                           | neblokovaná část aligned; networking čeká na `RES-01`, promotion na `RES-04` |
| `SCOPE-2026-09` 30min coaching                           | 26 source-verified reservation sessions, kapacita 1, cutoff v začátku         | společný canonical agenda/reservation kontrakt, bez identity rezervujícího                           | dvě řady Radim Roček / Stanislava Maunová podle `Pátek!G1:I18`                                            | `F3-06`/`P5-06` integrated; před publikací znovu ověřit snapshot             |
| `SCOPE-2026-10` read-only roster vedoucího               | bez attendance/no-show evidence v novém slice                                 | `reservation:assigned:read`, minimální `CS-ROSTER-01`; žádný attendance write                        | `/host/aktivity` preview jen jméno, firma, stav a přiřazené sessions; žádný globální export               | `UI ready (mocked)`; server a IDOR testy v `P5-08`                           |
| `SCOPE-2026-11` obecný QR a e-mailový přístup            | bez změny                                                                     | existující activation/recovery kontrakty neodvozují secret z URL                                     | žádná nová ticket/app QR větev v tomto kroku                                                              | beze změny; `P4-14`/`P4-15` otevřené                                         |
| `SCOPE-2026-12` web jako content baseline                | DB zůstává autorita po publikaci dle ADR-008                                  | content kontrakt beze změny                                                                          | veřejný web zachován                                                                                      | reconciliation `P3-11` zůstává otevřená do 31. 8.                            |

## Permission matrix po alignmentu

| Role                                 | Nově závazné minimum                                                         | Explicitně nemá                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `participant`                        | vlastní profil/privacy, agenda/rezervace, vlastní announcement read          | self-export, connection/message, speaker workflow                  |
| legacy `speaker`                     | stejný participant baseline; žádné zvláštní UI                               | materials, answers, speaker dashboard                              |
| `moderator`                          | publikovaný program a přiřazená session moderation                           | announcement send, globální questions feed                         |
| `room_operator` („Vedoucí aktivity“) | `reservation:assigned:read` jen s assigned session/room contextem            | attendance write, kontakt, globální roster/export, admin rezervace |
| `organizer_admin`                    | Priority A admin, kritické announcement send, auditované organizační výjimky | participant self-export a vyřazené networking metriky              |

Autoritativní strojově testovaná matice je v
`packages/domain/src/permissions.ts`; frontendové guardy nejsou náhradou
serverové autorizace.

## Záměrně ponechané historické storage hodnoty

- `capacity_mode.registration_estimate` v PostgreSQL enumu;
- `legal_document_type.networking_consent|other` a starší consent rows;
- role `speaker` a event flags `speaker_portal_enabled`, `polls_enabled`,
  `social_wall_enabled`.

Aktuální doménové kontrakty tyto větve Gate A nepřijímají ani nevydávají a
neexistuje pro ně route/API permission. Fyzické odstranění bude samostatná
expand/contract migrace až po retenční a produkční datové kontrole; není to
release gate ani důvod mazat auditní historii před akcí.

## Otevřené hranice

- `F3-07` je částečně dokončen: estimate je odstraněn, ale networkingovou
  kapacitu nelze implementovat bez `BLOCKER-RES-01` a jediný promotion režim
  nelze vybrat bez `BLOCKER-RES-04`.
- `/host/aktivity` je pouze development/test preview nad validovanou fixture.
  Produkční endpoint, assignment autorizace a negativní cross-session testy
  vlastní `P5-08`.
- Scope alignment nemění status žádné capability na `integrated` nebo `UAT`.

## Regresní kontrola

Audit se opírá o negativní parser/permission testy a produkční mock-boundary.
Při další změně scope se kontrolují alespoň tyto řetězce v produkčním grafu:

```text
networking:connection:message
attendance:assigned:write
mark_attended | undo_attendance
data_export | exportRequest
registration_estimate
severity info | severity important
```

Výskyt v historické migraci nebo v záporném testu je přípustný; kladný runtime
kontrakt, permission, fixture, CTA nebo route je regrese.
