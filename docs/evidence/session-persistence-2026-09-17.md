# Přihlášení na 48 hodin a instalovaná aplikace

## Příčina a rozsah

- Manifest spouští `/`, která dříve vždy zobrazovala přihlášení, i když měla
  aplikace stále platnou session cookie. Opětovné spuštění zástupcem tak
  vypadalo jako odhlášení.
- Volání `auth.api.getSession({ headers })` obnovovala relaci v PostgreSQL,
  ale vlastní API odpovědi ani serverové stránky nepředávaly obnovovací
  `Set-Cookie` do klienta. Expirace databáze a prohlížeče se mohly rozejít.
- Po přechodu z přímého stagingového přihlášení na e-mailové odkazy se navíc
  projevuje oddělené úložiště nainstalované aplikace a prohlížeče. Odkaz
  otevřený v prohlížeči nepřihlásí existující aplikaci v Docku. Automatické
  otevření externího odkazu v PWA řídí operační systém/prohlížeč.

## Změna

- `expiresIn` zůstává 172 800 sekund. Better Auth používá
  `deferSessionRefresh: true`: serverové GET čtení platnost neprodlužuje.
- Klient obnovuje relaci přes stejnooriginový POST `/api/auth/get-session`
  při otevření stránky, návratu do okna, obnovení připojení a každých pět
  minut ve viditelném okně. Každý úspěšný POST nastaví současně nových 48 hodin
  v databázi i HttpOnly cookie. Tím srovná i cookies ze starší implementace.
- Úvodní stránka a `/prihlaseni` po ověření existující relace pokračují na
  bezpečnou návratovou adresu nebo do dosavadního role-aware rozcestníku.
  Stránka potvrzení konkrétního odkazu se automaticky nepřesměrovává.
- Výpadek sítě neprovádí odhlášení. Expirovaná nebo odvolaná relace se
  neobnoví. Session se neukládá do localStorage/sessionStorage.
- Instalovaná aplikace nabízí jako výchozí přihlášení šestimístným kódem
  doručeným e-mailem. V běžném prohlížeči je kód dostupný jako alternativa.
  Ověření proběhne přímo v tom okně, kde uživatel kód zadá.
- Kódy spravuje Better Auth Email OTP: platnost 10 minut, tři chybné pokusy,
  hashované uložení, jednorázové ověření, bez automatického zakládání účtů.
  V e-mailovém archivu je kód nahrazen neplatným zástupným textem.
  Nové endpointy nezpřístupňují změnu e-mailu ani obnovu hesla.
- Stávající pozvánky, magic linky a ochrana před spotřebováním tokenu
  e-mailovým skenerem zůstávají podporované. Nová DB migrace ani změna
  autentizačního tajemství nejsou potřeba.

## Ověření

- Izolovaný PostgreSQL 17 s aktuálními migracemi a syntetickým seedem.
- Posun hodin na 47 hodin: platná relace; po 48 hodinách bez obnovy je
  odmítnuta. Obnova po 47 hodinách vrací `Max-Age=172800`, současně mění DB
  a relace platí i po původním termínu. Revokace ji nadále okamžitě ukončí.
- HTTPS cookie obsahuje Secure, HttpOnly, SameSite=Lax a Max-Age=172800;
  jiná instance autentizačního serveru se stejným tajemstvím relaci přijme.
- Kód vytvoří relaci ve volajícím klientovi; opakované použití, expirace a
  vyčerpání pokusů selžou. Neznámá adresa nedostane kód ani nový účet.
- Komponentové testy v Chromium: mobil, tablet a desktop, včetně návratu
  do aplikace, safe redirect, offline recovery, rušení požadavků, periodické
  obnovy, kódu ve standalone režimu a kontroly přístupnosti přihlášení.
- Chování macOS/iOS při externím otevírání URL nelze garantovat webovým
  manifestem; kód tuto závislost odstraňuje. Fyzické zařízení Apple nebylo
  součástí automatizovaných testů.

Produkční build prošel včetně kontroly offline shellu a nepřítomnosti mocků.
Ověřeno 59 serverových/route testů, 66 browserových komponentových testů a
46 testů e-mailů, dále TypeScript, ESLint a formátování změněných souborů.
Skutečný lokální Next.js server s produkčním buildem prošel HTTP scénářem:
OTP přihlášení, Secure cookie na 48 hodin, POST obnova, GET bez prodloužení,
odmítnutí opakovaného kódu a odmítnutí expirované relace.

## Zdroje

- https://better-auth.com/docs/concepts/session-management
- https://better-auth.com/docs/plugins/email-otp
- https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
