# BYZON — Event management & event-day platforma

Plán rozšíření webu [byzon.cz](https://byzon.cz) o **aplikaci pro správu akce** (před akcí) a **event-day aplikaci** (během akce). Cílem je proměnit pozicování *„Lidskost jako konkurenční výhoda“* a *řízený networking* z claimu na reálnou funkci: personalizovaná agenda, networking a domlouvání schůzek, živá interakce (Q&A, ankety), sběr podkladů od řečníků, check-in a sdílení prezentací.

> **Status:** rozsah a stack **odsouhlaseny** — viz **[00 — Rozhodnutí (závazné)](./00-rozhodnuti.md)**. Tohle je stále plánovací dokumentace, **ne kód**; navazovat bude technická specifikace a scaffold Fáze 0.

---

## TL;DR — zvolený směr

Závazná rozhodnutí jsou v **[00 — Rozhodnutí](./00-rozhodnuti.md)**. Cíl: **plný rozsah pro ročník 2026** (akce 18.–19. 9. 2026), staví **jeden člověk s AI agenty (Claude Code + Codex)**, aplikaci **vlastní zadavatel**.

| Oblast | Volba |
|---|---|
| **Vztah k webu** | Marketingový web (`build.py` → `content.json` → FTP) **zůstává beze změny**. Aplikace samostatně na **subdoméně `app.byzon.cz`**. `content.json` = zdroj pravdy pro program/řečníky (seed do DB). |
| **Stack** | **Next.js + PostgreSQL na Railway**, **Cloudflare** na DNS. Vlastní full-stack, plná kontrola dat, max. podpora AI agentů. |
| **Auth / storage / realtime** | **Auth.js** magic-link (bez hesel) · **Cloudflare R2** (soubory) · **SSE + Postgres `LISTEN/NOTIFY`** (realtime). |
| **Frontend** | **PWA** (Next.js + Serwist) — instalovatelná, offline, web push; brand Khand/Inter, `#f5218e`. |
| **Přihlášení** | Magic-link e-mailem, párovaný se zaplacenou vstupenkou; **CSV import** ze SimpleShopu jako primární cesta (API neověřeno). |
| **Q&A / ankety** | **Vlastní** (na Postgres + SSE), ne Slido. |
| **Soukromí** | Privacy-by-default: networking opt-in **vypnutý**, data minimization, autorizace na úrovni app + DB, retence + výmaz po akci. |
| **Strategie 2026** | **Vertikální řezy dle priority** — must-have → nice-to-have, každý přírůstek hned live. |

---

## ⚠️ Otevřená sub-rozhodnutí (neblokují start)

Hlavní rozhodnutí padla; zbývá doladit (detail v [00 §5](./00-rozhodnuti.md#5-otevřená-sub-rozhodnutí-a-rizika-k-hlídání)):

1. **SimpleShop** — webhook/API vs. CSV (neověřeno → jedeme CSV-first). Doplnit do formuláře chybějící pole **před koncem Early Bird**.
2. **Hromadné/firemní vstupenky** — přiřazení jmen účastníků (rozhodne se později).
3. **E-mail provider** — Resend (EU) vs. Postmark.
4. **Realtime mechanismus** — potvrdit SSE + `LISTEN/NOTIFY` vs. Pusher/Ably.
5. **EU data residency + DPA** — Railway / R2 / e-mail.

---

## Jak je plán organizovaný

| # | Dokument | Co obsahuje |
|---|---|---|
| ★ | **[Popis pro stakeholdery](./STAKEHOLDER-popis.md)** | Lidsky srozumitelný popis (k připomínkám) pro vedení, partnery a business ownery. Bez žargonu. *(Sdílí se jako Google Doc.)* |
| 00 | **[Rozhodnutí (závazné)](./00-rozhodnuti.md)** | Odsouhlasený rozsah a stack; má přednost před staršími doporučeními. **Číst první.** |
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
