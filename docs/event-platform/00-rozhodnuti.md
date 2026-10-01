# Rozhodnutí a zvolený stack (závazné)

> Plán: **BYZON — event platforma** · [⌂ Přehled](./README.md) · Další: [Katalog funkcí »](./01-funkce.md)

---

Tento dokument zaznamenává **závazná rozhodnutí** k 27. 6. 2026 a **má přednost** před odlišnými doporučeními v ostatních dokumentech (zejména v [02 — Architektura](./02-architektura.md), kde byly Supabase / SvelteKit / Slido jen *zvažované varianty*). Ostatní dokumenty zůstávají platné v částech, které těmto rozhodnutím neodporují.

**Kontext:** vše se cílí na **ročník 2026** (akce 18.–19. 9. 2026). Staví to **jeden člověk s pomocí AI coding agentů (Claude Code + Codex)**. Aplikaci **vlastní zadavatel**; doména `byzon.cz` patří organizátorovi konference (ENJOiT).

## 1. Hlavní rozhodnutí (z dotazníku)

| # | Oblast | Volba | Důsledek |
|---|---|---|---|
| A | **Strategie dodání** | Vertikální řezy dle priority | Stavíme v pořadí must-have → nice-to-have; každý řez = funkční přírůstek hned nasazený live. Jádro hotové a otestované brzy; okrajové funkce se přidávají až do akce. |
| B | **Tech stack** | **Next.js + PostgreSQL na Railway**, **Cloudflare** na DNS | Vlastní full-stack aplikace (žádný BaaS). Maximální podpora od AI agentů, plná kontrola a vlastnictví dat. |
| C | **Doména aplikace** | Subdoména **`app.byzon.cz`** | Jednotný brand a důvěra. Potřeba od organizátora **jeden DNS záznam** (delegace/CNAME na Cloudflare). |
| D | **Q&A a živé ankety** | **Vlastní** (ne Slido) | Vlastní data i brand, jeden ekosystém. Moderaci a anti-abuse stavíme sami → viz riziko v §5. |

## 2. Odvozený technický stack

| Vrstva | Volba | Poznámka |
|---|---|---|
| **Aplikace (FE+BE)** | **Next.js** (App Router, Route Handlers / Server Actions, TypeScript) | Jeden repo, jeden deploy. Největší trénovací korpus pro AI agenty. |
| **Databáze** | **PostgreSQL na Railway** (region **EU – Amsterdam**) | Managed Postgres, zálohy. EU region kvůli GDPR (ověřit při zřízení). |
| **Hosting aplikace** | **Railway** (deploy z GitHubu) | PaaS vhodný pro solo; app i Postgres na jednom místě. |
| **DNS / edge** | **Cloudflare** (DNS pro `app.byzon.cz`, SSL, CDN, ochrana) | Cloudflare před Railway. |
| **Autentizace** | **Auth.js (NextAuth) – e-mail magic-link**, Postgres adapter | Bez hesel. Párování se vstupenkou (viz §4). |
| **ORM / migrace** | **Prisma** | Nejlépe podporované AI agenty; typová bezpečnost, migrace. |
| **Úložiště souborů** | **Cloudflare R2** (S3-kompatibilní) | Prezentace, fotky. EU jurisdikce, bez egress poplatků; ladí s Cloudflare. |
| **Realtime (Q&A, ankety, live agenda)** | **SSE + Postgres `LISTEN/NOTIFY`** (primárně); fallback **Pusher/Ably** | Plně vlastní řešení bez dalšího vendora — viz §3. |
| **Transakční e-mail** | **Resend** nebo **Postmark** (rozhodnout dle EU/DPA) | Aktivace, připomínky, schůzky. Doručitelnost + EU residency. |
| **Web Push** | `web-push` (VAPID) | Event-day notifikace; součást PWA. |
| **PWA** | **Serwist** / `next-pwa` | Instalace, offline cache, push. |
| **Analytika** | **Plausible** nebo **Cloudflare Web Analytics** | Privacy-friendly, bez cookies. |
| **CI/CD** | Railway auto-deploy z GitHubu + preview prostředí | Staging = preview deploy; prod = `main`/release. |

## 3. Realtime — řešení nesrovnalosti

V dotazníku byla volba „vlastní Q&A“ označená jako *(Supabase Realtime)*, ale zvolený stack Supabase nepoužívá. Náhrada na Railway + Postgres:

- **Primárně: Server-Sent Events (SSE) napojené na Postgres `LISTEN/NOTIFY`.** Pro Q&A a ankety stačí jednosměrný tok serveru → klient (nové dotazy, upvoty, výsledky anket). Plně vlastní, žádný další vendor, levné, dobře zvládnutelné AI agenty. Nutné ověřit, že běhové prostředí Railway udrží dlouhé SSE spojení (Next.js Route Handler se streamem / malý samostatný Node proces).
- **Fallback: managed pub/sub (Pusher nebo Ably).** Pokud SSE/`LISTEN-NOTIFY` bude na škálu nestabilní, přepneme na hostovanou realtime službu (velkorysé free tiery, triviální integrace). Drobná závislost navíc + DPA.

➡️ **K potvrzení v technické specifikaci** (default: SSE + `LISTEN/NOTIFY`).

## 4. Co se mění oproti původnímu návrhu

| Bylo (návrh v dok. 02) | Nově (závazně) |
|---|---|
| Supabase (Auth + Realtime + Storage + RLS) | Next.js + Postgres na Railway; **Auth.js** (auth), **R2** (storage), **SSE/LISTEN-NOTIFY** (realtime), **app-level autorizace + RLS dle uvážení** místo Supabase RLS |
| SvelteKit + Cloudflare Pages | **Next.js + Railway**, Cloudflare jako DNS/edge |
| Q&A přes Slido embed (2026) | **Vlastní Q&A/ankety** |
| Redukované MVP, zbytek 2027 | **Plný rozsah cílený na 2026**, dodávaný vertikálními řezy dle priority |

> Pozn. k bezpečnosti: bez Supabase RLS přebírá ochranu dat **autorizační vrstva aplikace** (Auth.js session + kontroly v každém Route Handleru / Server Action, ideálně doplněné o Postgres Row-Level Security na úrovni DB rolí). Princip *„never trust the client“* z [05 — Bezpečnost a GDPR](./05-bezpecnost-gdpr.md) platí beze změny.

## 5. Otevřená sub-rozhodnutí a rizika k hlídání

1. **SimpleShop – API vs. CSV (neověřeno).** Default: **CSV/JSON import jako primární cesta** párování vstupenka → účet; webhook/API doplnit, až se ověří tarif. Doplnit do formuláře `0MnNQ` chybějící pole (e-mail účastníka, firma, případně dieta, networking opt-in) **dříve, než skončí Early Bird**.
2. **Hromadné / firemní vstupenky** – jak přiřadit jména účastníků (nutné pro check-in a jmenovky). *Rozhodne se později* — do té doby počítat v modelu s oddělením „kupující“ vs. „účastník“.
3. **E-mail provider** – Resend (EU region) vs. Postmark (doručitelnost, US + DPA). Rozhodnout dle EU residency a ceny.
4. **Realtime mechanismus** – potvrdit SSE + `LISTEN/NOTIFY` vs. Pusher/Ably (viz §3).
5. **EU data residency** – ověřit EU region u Railway (Postgres), R2 jurisdikci a EU u e-mailu; uzavřít **DPA** s Railway, Cloudflare a e-mail providerem.
6. **Riziko plného rozsahu solo + AI za ~12 týdnů.** Mitigace = strategie A (vertikální řezy): pořadí must → nice tak, aby akce měla funkční jádro, i kdyby na okrajové funkce nezbyl čas. Tvrdý „event-ready“ milník stanovit min. 2 týdny před akcí (freeze + zátěžový test na reálných lidech).
7. **Provoz mezi ročníky** – Railway projekt, secrets (SimpleShop, R2, VAPID, e-mail), doména a GDPR retence mají jasného vlastníka (zadavatel). Mimo sezónu lze app i Postgres uspat/škálovat dolů.

## 6. Nejbližší další krok

Na základě těchto rozhodnutí dává smysl jako další dodávka **technická specifikace + scaffold Fáze 0**: datové schéma (Prisma) odvozené z [03 — Datový model](./03-datovy-model.md), Auth.js magic-link, seed `content.json` → DB, kostra Next.js PWA s brandovými tokeny a CSV import vstupenek. Pořadí vertikálních řezů a milníky vázané na 18.–19. 9. 2026 viz [06 — Roadmapa](./06-roadmapa.md).
