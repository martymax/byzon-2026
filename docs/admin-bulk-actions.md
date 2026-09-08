# Hromadné úpravy v administraci

V příslušných přehledech otevřete **Hromadné úpravy**, vyberte položky a akci. Před provedením se zobrazí seznam dotčených položek, nové hodnoty a případně důvod změny. Výsledky rozlišují dokončené změny, chyby a neprovedené položky.

| Oblast          | Hromadné operace                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Účastníci       | Pozvánky, blokování a obnovení přístupu; společná firma či pracovní pozice; skrytí a zrušení skrytí v networkingu; vypnutí networkingu. |
| Program a obsah | Změna stavu, obnova z archivu, archivace, navazující pořadí. U dnů lze odstranit dny bez navázaného programu.                           |
| Body programu   | Navíc typ programu, místnost, posun začátku i konce v minutách, přidání či odebrání konkrétního řečníka.                                |
| Řečníci         | Navíc společná firma a pracovní pozice.                                                                                                 |
| Místnosti       | Navíc přiřazení místa a informační kapacita.                                                                                            |
| Partneři        | Navíc kategorie a úroveň partnerství.                                                                                                   |
| Stránky a FAQ   | Druh stránek a kategorie FAQ.                                                                                                           |
| Rezervace       | Nastavení stejné kapacity aktivit, zvýšení či snížení o počet míst, zrušení vybraných aktivních rezervací.                              |
| Tým             | Pozvánky, administrátorský přístup, přiřazení provozní role pro konkrétní oblast, odebrání členů.                                       |
| Provozní role   | Odebrání vybraných oprávnění.                                                                                                           |
| Interakce       | Povolení či zákaz otázek, přiřazení či odebrání konkrétního moderátora u více přednášek.                                                |

Import vstupenek, publikace obsahu a cílená oznámení nadále používají vlastní existující hromadné postupy. Jedinečné údaje, například jména, e-maily, názvy a adresy stránek, se upravují jednotlivě. Networking se hromadně nezapíná; zrušení moderátorského skrytí zachovává volbu účastníka.

## Rozsah a ověření

- Výběr zahrnuje jen zobrazené a načtené položky. U stránkovaných přehledů nejprve načtěte další položky. Vyhledávání uvnitř hromadného výběru předchozí výběr vymaže.
- Nevhodné položky se do potvrzované dávky nezahrnou; jejich počet se ukazuje před potvrzením. Pozvánky mají limit 25 příjemců v jedné dávce.
- Každá změna prochází stávajícím serverovým oprávněním, validací a auditem. Kapacity se kontrolují vůči obsazenosti. Změny veřejného obsahu vyžadují následnou kontrolu a zveřejnění.
- Dávka používá jednotlivé požadavky v pořadí. Není jednou databázovou transakcí: potvrzené změny zůstávají uložené i při selhání další položky.
- Při změně verze, ztrátě oprávnění, omezení počtu požadavků nebo nejasném výsledku se další zápisy zastaví. Po dokončení se obnoví přehled. Nejasný požadavek se automaticky neopakuje.
- Týmové operace navazují na sdílenou verzi potvrzenou předchozí odpovědí. Úpravy profilů načtou detail, ověří původní verzi a zachovají ostatní údaje.

Automatické kontroly pokrývají pořadí požadavků, částečné selhání, zastavení dávky, zachování nesouvisejících údajů, potvrzení výběru, přístupnost, režim pouze pro čtení, navazování týmových verzí a kontrolu kapacit před zápisem.
