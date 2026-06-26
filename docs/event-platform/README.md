# BYZON — Event management & event-day platforma

Plán rozšíření webu [byzon.cz](https://byzon.cz) o **aplikaci pro správu akce** (před akcí) a **event-day aplikaci** (během akce). Cílem je proměnit pozicování *„Lidskost jako konkurenční výhoda“* a *řízený networking* z claimu na reálnou funkci: personalizovaná agenda, networking a domlouvání schůzek, živá interakce (Q&A, ankety), sběr podkladů od řečníků, check-in a sdílení prezentací.

> **Status:** návrh k odsouhlasení. Tohle je plánovací dokumentace, **ne kód**. Vznikla nad reálným stavem repozitáře, ale samotná aplikace se zatím nestaví — nejdřív je potřeba odsouhlasit rozsah a zodpovědět [otevřené otázky](./07-otevrene-otazky-a-rizika.md).

---

## TL;DR — klíčová doporučení

| Rozhodnutí | Doporučení | Proč |
|---|---|---|
| **Vztah k webu** | Marketingový web (`build.py` → `content.json` → FTP) **zůstává beze změny** jako neměnné jádro. Aplikace žije samostatně na **subdoméně `app.byzon.cz`**. | Nerozbijeme to, co funguje a má nulovou údržbu. `content.json` zůstává jediným zdrojem pravdy pro program a řečníky — app si je naimportuje. |
| **Backend** | **Buy managed backend** → **Supabase** (Postgres + Auth + Realtime + Storage + RLS, **EU region Frankfurt**). | Malý tým, rychlost, realtime i GDPR/EU hosting „z krabice“. Mezi ročníky lze uspat na free tier. |
| **Frontend** | **Build vlastní** → **PWA** (SvelteKit / Cloudflare Pages), instalovatelná, offline, web push. Sladěná s brandem (Khand/Inter, `#f5218e`). | Event-day potřebuje offline a notifikace; PWA = bez app-storů, jeden kód. |
| **Přihlášení** | **Bez hesel** — magic-link / OTP e-mailem, párované se zaplacenou vstupenkou ze SimpleShopu. | Nejnižší tření = nejvyšší adopce. |
| **Q&A / ankety** | Pro 2026 **embednout Slido** (stejný vzor jako dnešní SimpleShop embed), vlastní řešení až 2027. | Moderaci a anti-abuse nestavět od nuly pár týdnů před akcí. |
| **Soukromí** | **Privacy-by-default**: networking opt-in **vypnutý**, data minimization, RLS místo „trust the client“, retence + výmaz po akci. | GDPR čl. 25, publikum jsou byznys profily — důvěra je podmínka adopce. |
| **Rozsah 2026** | **Redukovaný MVP** (registrace + agenda + check-in + oznámení/push + Slido). Plný rozsah (vlastní Q&A, pokročilý matchmaking, gamifikace) → **ročník 2027**. | Akce je za ~12 týdnů; full scope se do září reálně neodladí na stovkách lidí. |

---

## ⚠️ Začni tady: rozhodnutí, která blokují start

Než se napíše první řádek aplikace, potřebuje pořadatel (ENJOiT) rozhodnout několik věcí. Plný seznam s kontextem a doporučenou default volbou je v **[07 — Otevřené otázky a rizika](./07-otevrene-otazky-a-rizika.md)**. Nejdůležitější:

1. **Stavíme app už pro 2026, nebo až 2027?** (default: redukované MVP pro 2026)
2. **Rozpočet a kdo to staví** — interní kapacita vs. dodavatel.
3. **Kdo aplikaci vlastní a provozuje mezi ročníky** (doména, secrets, GDPR retence).
4. **SimpleShop**: máme reálně webhook + API, nebo jen CSV export? Sbírá formulář potřebná pole?
5. **Firemní/hromadné vstupenky** — jak přiřadit jména účastníků (nutné pro check-in a jmenovky).

---

## Jak je plán organizovaný

| # | Dokument | Co obsahuje |
|---|---|---|
| 01 | **[Katalog funkcí](./01-funkce.md)** | „Co by v tom mělo být.“ 7 funkčních domén, každá funkce s prioritou (MoSCoW) a odhadem složitosti. |
| 02 | **[Architektura](./02-architektura.md)** | Topologie, volba stacku (rozhodovací matice), PWA, realtime, build-vs-buy, prostředí, náklady. |
| 03 | **[Datový model](./03-datovy-model.md)** | Entity, vztahy a schéma napříč funkcemi; napojení na stávající `content.json`. |
| 04 | **[Integrace](./04-integrace.md)** | SimpleShop, kalendáře (ICS), e-mail, web push, QR, video, MCP nástroje týmu (Google Calendar, Canva, ClickUp, M365). |
| 05 | **[Bezpečnost a GDPR](./05-bezpecnost-gdpr.md)** | Auth & role, mapa osobních údajů, souhlasy, retence, DPA, moderace, incident response. |
| 06 | **[Roadmapa](./06-roadmapa.md)** | **Implementační plán**: fáze 0–3, MoSCoW tabulka, MVP, milníky vázané na 18.–19. 9. 2026, odhady, rizika, KPI. |
| 07 | **[Otevřené otázky a rizika](./07-otevrene-otazky-a-rizika.md)** | Blokující rozhodnutí pro zákazníka + kontrola úplnosti a rizik. |
| 99 | **[Příloha: rešerše](./99-reserse.md)** | Benchmark eventových platforem, SimpleShop/GDPR/CZ kontext, technické vzory. |

---

## Přehled funkčních domén

| Doména | Jádro funkcí | Klíčová priorita |
|---|---|---|
| **Registrace, účty, profily** | aktivace účtu z vstupenky, magic-link, profil pro networking, GDPR onboarding, role | MUST |
| **Personalizovaná agenda** | výběr sessions („Moje agenda“), kolize paralelních stagů, kapacity workshopů, export do kalendáře (ICS), připomínky | MUST |
| **Networking & schůzky** | adresář s filtry, matchmaking, žádost o spojení, 1:1 schůzky se sloty a meeting pointy, chat | SHOULD |
| **Live engagement** | Q&A s upvoty, ankety/hlasování, hodnocení sessions, NPS, gamifikace, oznámení | MUST (Q&A) / SHOULD |
| **Speaker portál** | self-service profil, sběr podkladů (bio/foto/slidy) s deadliny a připomínkami, schvalování, sdílení prezentací účastníkům | MUST |
| **Admin backoffice** | CMS programu, správa účastníků a řečníků, check-in/QR, hromadná komunikace, kapacity, analytika, role | MUST |
| **Další funkce** | mapa/wayfinding, praktické info, FAQ, materiály, fotogalerie, certifikáty, digitální vstupenka, lead retrieval pro partnery | mix |

---

## Fáze ve zkratce

- **Fáze 0 — Základy:** sdílené brand tokeny, PWA skeleton, EU Supabase, magic-link login, párování SimpleShop → účet, read-only program v app, RLS.
- **Fáze 1 — Pre-event:** onboarding + profil, „Moje agenda“ + kalendář, networking profily, speaker portál + sběr podkladů, admin CMS programu.
- **Fáze 2 — Event-day:** check-in/QR, live agenda + push, Q&A/ankety (Slido), networking schůzky, oznámení, mapa.
- **Fáze 3 — Post-event & pokročilé:** sdílení prezentací, hodnocení + NPS, záznamy, certifikáty, gamifikace, pokročilý matchmaking, analytika.

Detailní obsah fází, milníky (zpětně od data akce), odhady a rizika → **[06 — Roadmapa](./06-roadmapa.md)**.

---

## Vztah ke stávajícímu repozitáři

- **`build.py` + `data/content.json` + statické HTML zůstávají beze změny.** Tato dokumentace nic z toho neupravuje.
- Program a řečníci v `content.json` se stávají **seed daty** pro aplikaci (jednorázový import → DB). Pro plný event-day se model `events` rozšíří o stabilní `id`, ISO `start/end`, kapacity a tagy — návrh viz [datový model](./03-datovy-model.md) a [roadmapa](./06-roadmapa.md).
- Admin CMS programu může v cílovém stavu publikovat změny zpět do `content.json` přes GitHub API, takže marketing web i app čerpají z jednoho zdroje.

---

*Dokumentace vznikla jako podklad k rozhodnutí o rozsahu. Po odsouhlasení MVP a zodpovězení otevřených otázek na ni naváže technický návrh (schéma DB, API kontrakty) a samotná implementace.*
