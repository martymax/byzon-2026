# ADR-017: Programoví spolupracovníci a soukromé Q&A odpovědi

- Stav: Přijato pro implementaci; nasazení a UAT nejsou dokončené
- Datum: 7. 9. 2026
- Zdroj: [implementační plán](../participant-access-and-live-qa-implementation-plan.md), zahájení realizace a upřesnění uživatele 7. 9. 2026
- Mění: ADR-016 bod 2 pro programové spolupracovníky; `SCOPE-2026-03`, `05`, `13` a původní omezení `P12-05`/`09`

## Kontext

Ruční participant flow, živý sběr dotazů, moderátorský feed a programové QR již
existují. Starší zákaz speaker odpovědí a výlučný SimpleShop vstup neodpovídají
novému zadání. Rozšiřujeme existující aplikaci o úzké schopnosti; obecný speaker
portál, materiály, veřejná registrace a check-in zůstávají mimo rozsah.

## Rozhodnutí

1. Vedoucí a speakeři se primárně přidávají existujícím ručním participant flow.
   SimpleShop je alternativní zdroj. Obě cesty mají jeden účet, aktivní event
   membership, participant profil a aktivní roli `participant`. Pozvánka do
   `/app` je samostatný admin krok. Přidání doplňkové role nezakládá identitu
   ani neodesílá e-mail. Interní kompatibilní ticket ručního flow zůstává pro
   invitation/support; jeho hash/suffix není uživatelský credential, QR,
   check-in ani programový entitlement.
2. `speaker`, `room_operator` a `moderator` jsou doplňkové role. Roster vyžaduje
   explicitní session/room scope `room_operator`; speaker vazba jej sama
   nezpřístupňuje. Jeden grant může atomicky pokrýt více session, zejména oba
   díly sobotního mastermindu. Odebrání role neruší participant membership.
   Také moderátor v host shellu potřebuje participant baseline.
3. Q&A capability `questionMode` má default `disabled`; jediný další režim je
   `moderated_follow_up`. [Přesný inventář](../evidence/participant-access-live-qa-inventory.md)
   obsahuje 17 pátečních přednáškových/panelových session na dvou stage.
   EB21 a „Jak na networking“ jsou výslovně vyloučené. Za běhu se capability
   nikdy neodvozuje z názvu, dne či obecného typu session.
4. Živý sběr vyžaduje oba provozní přepínače, publikovanou podporovanou session
   a serverové UTC okno `now < endsAt + 30 minut`. Autoritativní runtime
   context musí promítnout admin změnu bez nové publikace programu.
   Moderátory i session toggles lze připravit při globálním OFF; přechod na
   ON vyžaduje coverage preflight.
5. Moderátor má pouze read-only chronologický feed přiřazených session,
   včetně jména autora; bez votes, merge, pořadí podle relevance či ručního
   „zodpovězeno“. Feed zůstává dostupný po konci i vypnutí sběru.
6. Od konce session může aktivní linked speaker při eventu `live`/`ended`
   číst anonymizované texty a publikovat odpověď. Potřebuje vlastní
   default-OFF `questionFollowUpsEnabled` a permission s ověřenou session
   vazbou. Samotná role nestačí. Historický `speakerPortalEnabled` zůstává OFF.
7. Písemná odpověď je soukromá jen pro autora otázky. Admin vidí pouze
   provozní metadata a počty. Speaker nevidí identitu autora. UI říká
   „Bez písemné odpovědi“, protože ústní odpovědi systém neeviduje.
8. Na otázku připadá jedna odpověď. První publish vyhrává pomocí databázové
   unikátnosti; druhý vrací 409. Edituje pouze publikující speaker s aktuální
   verzí, do archivace eventu nebo ztráty oprávnění. Obecný audit obsahuje
   metadata, nikdy text. Owner read publikované odpovědi nezávisí na collection
   ani follow-up přepínači. E-mailové notifikace nejsou součástí MVP.
9. Q&A SVG/ZIP rozšiřuje stávající QR službu targetem `questions` do
   `/app/interakce/:sessionId`, pouze pro publikované podporované session.
   Obecný programový QR zůstává. Auth return musí být bezpečný interní odkaz.
10. Kanonická rezervovatelná projekce pátečního networkingu je **Leadership
    Stage, 19:00–21:00**. Projekce „Networking a afterparty“ je pouze
    informativní. DATA-02 doplní explicitní `tomas-reznicek` link a rezervovatelný
    typ; otevření vyžaduje adminem zadanou kladnou kapacitu. Kapacitu nehádáme.

## Důsledky a hranice

Implementace pokračuje podle závislostí AQ-01 → DATA-02/QA-02/QR-02 a navazujících
balíčků. AQ-00 potvrzuje lokální inventář, nikoli skutečné účty, UUID, publikaci
či readiness stagingu. Existující import zachovává historické slugy; databázové
mapování je nutné ověřit přes event-scoped provenance před backfillem.

Vše se nasazuje defaultně vypnuté. Před zapnutím je nutné ověřit přiřazené
moderátory, linked speaker účty, soukromí, souběžné odpovědi, QR/login návrat a
mobilní/tabletový rehearsal. Produkční invitation delivery zůstává samostatný
provozní gate. Nové ticket entitlementy nejsou tímto ADR povolené.
