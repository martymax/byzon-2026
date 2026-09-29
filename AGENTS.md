# Práce s repozitářem a nasazení

- Před změnami spusť `git fetch origin`, zkontroluj pracovní strom a porovnej
  aktuální HEAD s `origin/main`. Změny stav na aktuálním `main`.
- Je-li lokální checkout pozadu nebo obsahuje rozpracované změny, zachovej je
  a použij samostatný worktree z `origin/main`. Nepřenášej změny naslepo;
  ověř současnou implementaci dotčené funkce.
- Produkce se nasazuje výhradně přes GitHub integraci z větve `main`.
  Nepoužívej `railway up` ani force push. Railway CLI slouží ke kontrole stavu.
- Před pushem znovu načti vzdálený stav, zkontroluj výsledný diff a spusť
  odpovídající testy a build. Po nasazení ověř commit webu i workeru,
  `/health/ready` a dotčené stránky; samotné HTTP 200 není funkční ověření.
- Provozní kontext a ochranu existujících dat popisuje
  `docs/runbooks/railway-staging.md`.
