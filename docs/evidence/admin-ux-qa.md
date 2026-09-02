# AUX-12 — cross-route QA evidence

> Datum: 2026-09-02  
> Prostředí: Node 24.18.0, Playwright 1.61.1, Chromium, axe-core 4.12.1  
> Reprodukovatelné příkazy: `pnpm test:admin-ux`, `pnpm report:admin-bundles`

## Automatizovaná matice

- 11 admin rout × 7 viewportů: 320×720, 375×667, 414×896, 768×1024,
  1024×768, 1280×800 a 1440×900.
- Celá matice po doplnění max-page trace: 17 průchodů a 18 záměrných skipů
  perf/reflow scénářů mimo jejich jediný stabilní 1280×800 projekt.
- Každá kombinace ověřuje nulový horizontální page overflow, právě jeden
  `main`, právě jednu `h1`, jeden skip link, logickou posloupnost nadpisů a
  nulový serious/critical axe nález.
- Keyboard smoke ověřuje skip link a fokus hlavního obsahu, desktopovou
  navigaci, mobilní drawer včetně `Escape` a navrácení fokusu, filtr auditu a
  disclosure technických údajů.
- Režim 1280×800 používá 200% CSS reflow a `prefers-reduced-motion: reduce` na
  routách obsah, rezervace a audit. Ověřuje nulový page overflow a nulovou
  aktivní animaci/transici.
- Screenshot průřez obsahuje všech 11 rout na 320, 768 a 1440 px. Ručně byly
  zkontrolovány alespoň rezervace/320, obsah/768 a audit/1440. Kontrola našla a
  opravila chybějící styl souhrnných metrik rezervací a nadpisy navigačních
  skupin, které předcházely stránkové `h1`.

Automatický výsledek není vydáván za manuální screen-reader test. Fyzický
VoiceOver/NVDA smoke navigace, error summary, dialogu, statusu a tabulky zůstává
součástí release UAT.

## Výkon

Měření běží přes `PerformanceObserver` na stejném Chromium runneru. Kumulativní
CLS při načtení auditu i rezervací byl `0.03246` (limit `<0.1`). Po resetu
long-task observeru vytvořil filtr + detail auditu i filtr + detail rezervace
maximální user-triggered long task `0 ms` (limit `≤50 ms`). Nejdelší load task
auditu byl `87 ms`; load task není vydáván za interakční výsledek.

Reprodukovatelný příkaz
`ADMIN_QA_MAX_TRACE=1 pnpm exec playwright test --config=playwright.admin.config.ts --project=admin-1280 --grep "contract-maximum"`
vytváří Chromium trace nad kontraktními maximy: 100 auditních položek, 100
rezervací/kapacit, 50 obsahových položek, 500 řádků ticket preview a 5 support
výsledků. Všechny scénáře měly CLS `0.032461608505249026`; filtr, otevření
detailu/editoru, načtení a render i klávesnicová další stránka měly finální
maximální long task `0 ms`.

První měření ticket preview odhalilo `128 ms`: komponenta současně renderovala
500 tabulkových řádků i 500 mobilních karet. Preview dál drží celý kanonický
500řádkový payload a souhrn, ale zobrazuje přístupné klientské stránky po 25.
Navigace má pojmenovaný landmark, živý rozsah „Zobrazeno X–Y z 500“, nativní
tlačítka Předchozí/Další a prošla axe i klávesnicovým Enter průchodem. Po
opravě stejný trace naměřil `0 ms` pro load/render, filtr i další stránku.

Technická akceptace `12C-1` je hotová. Tracker `AUX-12C` zůstává `[~]` pouze
proto, že jeho dependency `AUX-12A` čeká na fyzický VoiceOver/NVDA smoke.

## Bundle budget

Baseline je [admin-ux-bundle-baseline.json](./admin-ux-bundle-baseline.json),
aktuální čísla a delty jsou v
[admin-ux-bundle-current.json](./admin-ux-bundle-current.json). Shared admin JS
je 129 454 B gzip, tedy +360 B (+0,28 %; budget +10 %). Od baseline narostly
obsah/tickets/announcements jen o 231/217/324 B; žádná route se nepřiblížila
20KiB limitu. Přímé route importy odstranily nechtěné přibalování legacy
barrelů:

| Route     | Baseline gzip | Aktuálně gzip |     Delta |
| --------- | ------------: | ------------: | --------: |
| Rezervace |      25 825 B |       5 176 B | −20 649 B |
| Tým       |      22 775 B |       4 927 B | −17 848 B |
| Reporty   |      22 775 B |      17 483 B |  −5 292 B |
| Audit     |      25 825 B |      17 443 B |  −8 382 B |
| Nastavení |      25 825 B |       3 271 B | −22 554 B |

Budget gate selže při route přírůstku nad 20 KiB gzip nebo při růstu shared
admin chunku nad 10 %.

## Privacy a security review mockované vrstvy

- Produkční build spouští source i build mock-boundary kontrolu; žádný browser
  mock adapter se nedostává do produkčního grafu.
- Admin porty používají `private, no-store`, korelují event scope a support P3/S
  term posílají v POST body, ne v URL.
- Permission/session failure vyvolá bezpečný wipe; stale odpovědi jsou
  oploceny generací requestu a změnou autority.
- Serverové integrační testy pokrývají cross-origin, unauthorized, cross-event,
  reused-key a negativní permission cesty. Mock port navíc ověřuje canonical
  event scope a privátní cache hlavičky.
- Technické identifikátory jsou pouze v explicitním disclosure a PII není
  zapisováno do URL ani testovací telemetrie.

Tento review uzavírá `AUX-12D` pro mockovanou vrstvu; nenahrazuje produkční
security gate jednotlivých `AUX-13*` integrací.
