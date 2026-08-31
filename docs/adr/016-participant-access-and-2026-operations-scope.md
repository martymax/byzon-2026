# ADR-016: Přístup účastníků a provozní rozsah 2026

- Stav: Přijato
- Datum: 31. 8. 2026
- Rozhodnutí: produkt + organizátor
- Dotčené části: `P4`, `P6`, `P8`, `P11`, `P12`, Railway staging
- Nahrazuje: ticket-claim a check-in části ADR-004/ADR-015 pro ročník 2026

## Kontext

Aplikace nemá kontrolovat vstupenky ani zajišťovat check-in. SimpleShop je
zdroj seznamu účastníků, ne credentialů skenovaných aplikací. Přístup do
aplikace musí vzniknout řízeně, bez volné registrace, a odeslání pozvánek
musí zůstat pod kontrolou administrátora.

## Rozhodnutí

1. Oprávněný administrátor spustí serverový import účastníků ze
   SimpleShop API. Import vytvoří nebo aktualizuje event-scoped identitu a
   membership; neimportuje ani nevydává ticket QR/credential.
2. Pozvánky se neodesílají automaticky při importu. Administrátor nad
   kanonickým preview výslovně spustí auditovanou, idempotentní dávku
   e-mailových pozvánek. Volná registrace a ruční tvorba běžného
   účastníka nejsou primární vstupní mechanismus.
3. Aplikace v roce 2026 nekontroluje vstupenky a neprovádí check-in. Aktivní
   navigace, dashboard, exporty ani provozní runbook nesmějí vyžadovat
   ticket QR, check-in zařízení nebo obsluhu. Již implementované interní
   check-in kontrakty mohou dočasně zůstat jako nedosažitelná kompatibilní
   vrstva, ale nejsou součástí release/UAT.
4. Networking pro celou akci zapíná administrátor. Každý účastník se
   navíc musí výslovně přihlásit; bez opt-in není jeho profil v adresáři
   zjistitelný. Po opt-in jsou viditelná všechna pole, která účastník
   vyplnil ve veřejném profilu. Opt-out skryje celý profil okamžitě.
5. Data se nemažou automaticky podle pevné lhůty. Případné odstranění
   nebo anonymizaci spouští organizátor podle schváleného postupu; systém
   nesmí mít aktivní produkční retention job s domyšleným defaultem.
6. Produkční platforma je Railway. Aktuální staging web běží na
   `https://byzonconference-staging.up.railway.app`; cílová produkční doména
   bude `https://app.byzon.cz` připojená přes Cloudflare.
7. Administrace řídí event-wide networking, otázky a hodnocení, samostatné
   povolení otázek pro každou přednášku a session-scoped moderátory. Vše
   je defaultně vypnuté a každá změna se audituje.

## Důsledky

- `BLOCKER-TKT-04`, `BLOCKER-TKT-05` a `BLOCKER-OPS-02` už neblokují launch;
  jejich původní credential/check-in scope je pro 2026 vyřazen.
- Otevřený zůstává provider transakčního e-mailu, odesílací doména a
  SPF/DKIM/DMARC. Do jejich schválení lze dokončit provider-neutral workflow
  a staging sink, ne produkční invitation delivery.
- SimpleShop stavové mapování se posuzuje jen pro způsobilost k importu a
  pozvání; neznámý, nezaplacený nebo stornovaný záznam zůstává fail-closed.
- Retenční automatizace zůstane vypnutá, dokud organizátor neschválí
  konkrétní ruční postup a právní texty.
