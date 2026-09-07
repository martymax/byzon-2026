# Přístup spolupracovníků a Q&A — evidence lokálního ověření

Datum: 7. 9. 2026. Prostředí: Node 24.18, pnpm 11.15, PostgreSQL 17 v izolovaném lokálním clusteru, Chromium component browser runner. Nejde o důkaz staging ani produkčního nasazení. [Testovací a provozní návod](../runbooks/participant-access-live-qa.md).

## Implementační commity

| Balíček    | Commit                           | Výsledek                                                                              |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| AQ-00      | `9aabf0f`                        | ADR a potvrzený inventář 17 přednášek; EB21 a networking instruktáž vynechány.        |
| AQ-01      | `4b76089`                        | Schéma, migrace 0028, DTO, soukromé odpovědi a permissions.                           |
| DATA-02    | `b8801d4`                        | Stabilní source slugs, speaker vazby, kanonický networking, readiness CLI.            |
| ACCESS-02  | `1e45ec9`                        | Serverový participant setup, preview, hash, verze, audit a idempotency.               |
| ACCESS-03  | `4cff19e`                        | Admin průvodce, role-aware navigace, odstranění implicitního speaker rosteru.         |
| QA-02      | `4fb6ebf`                        | Autoritativní čas a přepínače, submit, owner historie.                                |
| QA-03      | `4e434b0`                        | Participant formulář a soukromá historie s bezpečným návratem a retry.                |
| MOD-03     | `647028b`                        | Rozcestník a tablet feed, úplné stránkování, reconnect a security wipe.               |
| SPEAKER-03 | `c2c4ace`                        | Soukromé speaker API po konci, první odpověď vítězí, optimistic edit.                 |
| SPEAKER-04 | `c2a40d5`                        | Speaker UI, filtry, retry, soukromé odpovědi a řešení konfliktu.                      |
| QR-02      | `c908720`                        | Q&A target, whitelist publikací, SVG a ZIP manifest.                                  |
| ADMIN-03   | `e397c7f`                        | Coverage, samostatné vypínače, preflight, QR v Obsahu a Interakcích.                  |
| QA-05      | Commit obsahující tento dokument | Finální regresní kontroly, upgrade rehearsal, privacy hardening, runbook a route map. |

## Provedené kontroly

| Kontrola                                                                            | Výsledek                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                                                                 | Prošlo; včetně normalizace generovaných Drizzle JSON metadat.                                                                                                      |
| `pnpm test:static`                                                                  | 48 HTML stránek a 76 assetů prošlo smoke kontrolou.                                                                                                                |
| `pnpm lint`                                                                         | Všech 8 workspace balíčků prošlo.                                                                                                                                  |
| `pnpm typecheck`                                                                    | Všech 8 workspace balíčků prošlo.                                                                                                                                  |
| Database testy na čisté migrované a seedované DB                                    | 129/129, 19 souborů.                                                                                                                                               |
| Domain testy                                                                        | 208/208, 22 souborů.                                                                                                                                               |
| Conference kompletní unit/integration sada s `TEST_DATABASE_URL` a `--maxWorkers=2` | 861/861, 124 souborů.                                                                                                                                              |
| Navazující finální security/roster/admin testy                                      | 20/20; zahrnují cross-event speaker request, membership a session-link revokaci, foreign origin a baseline rosteru.                                                |
| Celý handler řetězec admin → participant → moderator → speaker → owner → oba OFF    | 1/1 (`question-rehearsal.integration.test.ts`), přidaný po kompletní sadě.                                                                                         |
| Test-support fixtures a kontrakty                                                   | 37/37.                                                                                                                                                             |
| Worker unit testy                                                                   | 8/8.                                                                                                                                                               |
| Nové collaborator/participant/moderator/speaker browser scénáře                     | 21/21 na 375, 768 a 1280 px včetně axe.                                                                                                                            |
| Moderátor po závěrečné úpravě reconnect indikace                                    | 3/3, všechny viewporty.                                                                                                                                            |
| Admin workspace + content browser regrese                                           | 247/249 na první pokus; dva časové timeouty starších tabletových capacity scénářů. Cílené opakování všech 4 příslušných/admin-Q&A scénářů na 3 viewportech: 12/12. |
| `pnpm build`                                                                        | Conference produkční Next build, produkční mock boundary, offline shell manifest a worker bundle prošly.                                                           |
| Upgrade rehearsal                                                                   | Reálný upgrade 0027 → 0028: 17 podporovaných session, 2 nepodporované, starý slug přes provenance, collection OFF, follow-up OFF, opakovaná migrace bez změny.     |

Po produkčním buildu byly znovu vygenerovány Next route types a odstraněna zastaralá lokální dev type cache; následný conference typecheck prošel.

Samostatné Q&A integrační testy ověřují přesný začátek/konec, živé přepínače navzdory immutable snapshotu, idempotentní replay po konci, historii jen vlastníkovi, admin bez přístupu k textům, 125 otázek se shodným časem, first-wins souběh panelistů, edit jen autorem s platnou verzí a oddělené vypnutí follow-up. Browser testy ověřují text a klíč při ztracené odpovědi, security wipe, page draining, konflikt a accessibility. Nejde o skutečnou emailovou aktivaci či fyzické skenování QR.

První společný testovací běh používal DB s již importovaným konferenčním programem. Dva starší database schema testy narazily na již existující den seedovaného eventu, nikoli na testovaný constraint. Ověření proto bylo zopakováno na čisté samostatné DB a prošlo 129/129. Neomezený souběžný conference běh byl při přetížení lokálního prostředí ukončen a kompletně zopakován s dvěma workers; dokončil se bez vynechaných testů. Testovací očekávání nebyla kvůli těmto výpadkům oslabena. Čekání na CSS animace před axe toleruje standardní zrušení nahrazené animace; samotné axe kontroly zůstaly zapnuté.

## Co zůstává provozní podmínkou

- Nebyl proveden push, deploy, změna produkčních přepínačů ani odeslání skutečných pozvánek.
- Skutečné participant účty, speaker vazby a moderátory musí potvrdit pořadatel na cílové DB. Lokální [readiness inventář](program-readiness-local.json) správně hlásí nepropojené účty a dosud nenastavenou kapacitu networkingu.
- Fyzický staging rehearsal telefon + dva tablety, email transport, QR v reálné projekci a rollback drill nejsou provedené. [Runbook](../runbooks/participant-access-live-qa.md) obsahuje přesnou matici i očekávané výsledky.
- Před produkčním zapnutím musí release záznam jmenovat operátora a zálohu. Nový kód tuto volbu neprovádí a neaktivuje `speakerPortalEnabled` ani check-in.

Automatická implementační část QA-05 je dokončená; úplné provozní Definition of Done plánu se uzavírá až doložením uvedených externích kontrol.
