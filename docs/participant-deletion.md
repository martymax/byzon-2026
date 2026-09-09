# Trvalé smazání účastníka

V administraci otevřete detail účastníka a zvolte **Smazat účastníka**. Dialog
uvádí jméno, e-mail a rozsah smazání; vyžaduje potvrzení nevratnosti. Operace
vyžaduje oprávnění `ticket:any:manage`. Archivované akce zůstávají pouze pro čtení.

Smazání se vztahuje k účasti na vybrané akci. Uživatelský účet se odstraní,
pokud už nemá jiné vazby. Aktivní role speakera či člena týmu, veřejný program
a účast na jiné akci zůstávají zachované. Pokud členství potřebuje pouze
historický provozní záznam a už nemá další aktivní roli, členství zůstane
odvolané a přístup účastníka zanikne.

## Databázové vazby

Všechny změny probíhají v jedné PostgreSQL transakci. Výjimka vrátí celou
operaci zpět; nejsou potřeba změny schématu ani změkčení cizích klíčů.

| Záznamy                                                                                      | Výsledek                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `participant_profiles`                                                                       | Smazání profilu včetně kontaktních a networkingových údajů.                                                                                                                                                                                                                                                           |
| `event_roles`                                                                                | Smazání aktivních i historických rolí `participant` pro tuto akci; ostatní role zůstávají.                                                                                                                                                                                                                            |
| `event_memberships`                                                                          | Smazání, pokud členství nepotřebuje jiná role ani provozní vazba. Jinak zachování, případně odvolání přístupu a změna offline revokačního identifikátoru.                                                                                                                                                             |
| `participant_agendas`, `agenda_items`                                                        | Smazání celé osobní agendy a jejích položek.                                                                                                                                                                                                                                                                          |
| `reservations`, `waitlist_entries`                                                           | Smazání aktivních i historických záznamů. Uvolněná místa se obsadí stávající logikou automatické čekací listiny, včetně kontroly termínu, kapacity a kolizí.                                                                                                                                                          |
| `questions`, `question_answers`, `ratings`                                                   | Smazání vlastních otázek včetně soukromých odpovědí a jejich provozních odkazů, dále hodnocení akce i aktivit. Odpovědi napsané v roli řečníka jiným účastníkům zůstávají; potřebné členství se zachová.                                                                                                              |
| `consent_records`, `privacy_requests`                                                        | Smazání záznamů účastníka pro danou akci; společné právní dokumenty zůstávají.                                                                                                                                                                                                                                        |
| `announcement_recipients`                                                                    | Smazání přečtených i nepřečtených doručení. Společné oznámení zůstává ostatním.                                                                                                                                                                                                                                       |
| `announcement_previews`                                                                      | Odstranění účastníka z JSON seznamu příjemců, přepočet počtu a zvýšení verze. Dřívější potvrzení náhledu nelze použít pro změněný seznam.                                                                                                                                                                             |
| `email_deliveries`                                                                           | Smazání všech stavů doručení, včetně uloženého příjemce a vyrenderovaného obsahu pro opakované odeslání.                                                                                                                                                                                                              |
| `tickets`, `ticket_events`, `check_ins`, `checkin_lookups`                                   | Smazání všech vlastněných vstupenek a souvisejících historických i aktuálních záznamů.                                                                                                                                                                                                                                |
| Převody vstupenek                                                                            | Následná vstupenka jiného člověka zůstává; zruší se pouze odkaz `transferred_from_ticket_id` na smazaný zdroj.                                                                                                                                                                                                        |
| `ticket_source_participants`, `ticket_import_rows`                                           | Smazání účastnických záznamů SimpleShopu a řádků se shodnou externí identitou nebo HMAC vstupenky. Číslo objednávky se nepoužívá k mazání: jedna objednávka může obsahovat více lidí.                                                                                                                                 |
| `ticket_import_batches`                                                                      | Společná dávka a souhrn původního importu zůstávají. Starý náhled s odstraněnými řádky již nelze znovu aplikovat; pro další import je potřeba nový náhled.                                                                                                                                                            |
| `outbox_events`                                                                              | Odstranění událostí odkazujících na účastníka či jeho smazané záznamy, i přes vnořený JSON.                                                                                                                                                                                                                           |
| `idempotency_keys`                                                                           | Odstranění starých uložených odpovědí obsahujících účastníka či smazané záznamy a jeho vlastních účastnických požadavků pro tuto akci. Potvrzení samotného smazání obsahuje pouze identifikátory a výsledek, s platností 24 hodin.                                                                                    |
| `audit_logs`                                                                                 | U souvisejících záznamů se odstraní identifikátor cíle, důvod a původní datové snímky. U osobních účastnických akcí se anonymizuje i autor; autorství týmových operací zůstává. Zůstane provozní historie a nové potvrzení smazání bez jména, e-mailu či identifikátoru smazaného cíle.                               |
| `operational_export_requests`                                                                | Již připravené exporty auditu této akce se zneplatní a jejich obsah se smaže. Generování exportu a mazání používají společný zámek, aby se starý obsah nevrátil. Souhrnné exporty bez osobních údajů zůstávají.                                                                                                       |
| `user`, `session`, `account`, `verification`                                                 | U samostatného účtu se smaže identita, relace, autentizační účty a ověřovací záznamy včetně magic linků, jejichž příjemce je uložen uvnitř JSON hodnoty. U sdíleného účtu zůstávají přihlášení pro další oprávněné použití.                                                                                           |
| `speaker_profiles`, `session_speakers`, `assets`, `content_publications`, provozní autorství | Zachování veřejného programu, souborů a historie týmových operací. Bez další aktivní role se volitelné odkazy na autorství/vlastnictví nastaví na `NULL`; povinné historické vazby zachovají odvolané členství. Všechny zbývající cizí klíče se před mazáním členství a identity ověří přímo proti definici schématu. |
| `ticket_claim_attempts`                                                                      | Tabulka nemá odkaz na účastníka a aplikace do ní nyní nezapisuje. Existující anonymní bezpečnostní hashe podléhají své vlastní expiraci.                                                                                                                                                                              |

## Souběh a opakování

Endpoint `DELETE /api/v1/admin/events/:eventId/participants/:participantId`
přijímá JSON `{ participantId, expectedProfileVersion, confirm: true }` a
vyžaduje hlavičku `Idempotency-Key`, přihlášení a shodný `Origin`. Oprávnění se
znovu kontroluje uvnitř transakce pod zámkem správy rolí. Zastaralá verze vrací
`409 STALE_VERSION`; neexistující profil `404 SUPPORT_RECORD_NOT_FOUND`.

Transakce sdílí zámky s úpravou profilu, pozvánkami, agendou, rezervacemi,
importem a správou rolí, náhledy a odesíláním oznámení a generováním exportů.
Cizí klíče a zámky řádků chrání odstranění členství a účtu. Při ztracené odpovědi
rozhraní opakuje stejný požadavek se stejným klíčem; již provedené smazání se
podruhé nespustí. Po úspěchu se údaje účastníka odstraní i ze zobrazeného detailu.

## Externí systémy a ověření

Tato funkce nemění objednávku v SimpleShopu. Nový explicitní import z původního
zdroje může účastníka znovu přidat. Již odeslané e-maily a kopie exportů stažené
mimo aplikaci nejsou součástí databázového smazání; již probíhající doručení
předané poskytovateli e-mailu nelze vzít zpět.

Integrační testy `participant-deletion.integration.test.ts` používají pouze
`TEST_DATABASE_URL` a syntetická data. Pokrývají vazby, izolaci jiných lidí a akcí,
role a veřejný program, čekací listinu, souběžná oznámení a exporty, autorizaci,
verzování, idempotenci a rollback. Komponentové testy ověřují potvrzení, zrušení,
opakování po timeoutu, skrytí osobních údajů a přístupnost na telefonu, tabletu
a desktopu.
