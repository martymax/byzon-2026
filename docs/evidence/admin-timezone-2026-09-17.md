# Kontrola časů v administraci — 17. 9. 2026

Přehled aktivit v `/admin/rezervace` zobrazoval `startsAt.slice(11, 16)`.
API přitom správně vrací absolutní čas v UTC (`toISOString()`), takže
v září byl zobrazený čas o dvě hodiny dříve než v Europe/Prague.
Společný výpis se používá i pro koučovací zónu a Mastermind.

Oprava používá `Intl.DateTimeFormat` s `eventTimezone` z administračního
kontextu. Převod automaticky respektuje letní i zimní čas. Databázové časy,
rezervace ani API kontrakt se nemění.

## Rozsah kontroly

Prohledány administrační routy, komponenty, pomocné funkce a serverové
serializace času. Program a obsah, přehled, interakce, oznámení, e-mailová
historie, audit, exporty a publikace používají explicitní časovou zónu.
Pozvánky, import účastníků, účastnický detail a přístup k programu používají
explicitně Europe/Prague. Zadávání časů programu a časové filtry auditu
a exportů převádí lokální čas pomocí `zonedLocalToIso` v zóně akce.
Nebyla nalezena další stejná chyba ve zobrazení času administrace.

UTC ve `formatProgramDay` je záměrné: formátuje kalendářní datum
`localDate`, nikoli okamžik začátku aktivity. Serverové ISO UTC hodnoty
jsou transportní formát a nevyžadují změnu.

## Regresní ověření

- Nové browser testy před opravou: tři chybné případy reprodukovaly problém.
- Po opravě: 51 browser kontrol rezervací, kapacit, auditu a exportů
  na desktopu, tabletu a telefonu prošlo.
- Nové případy ověřují UTC vstup v létě i zimě, vstup s explicitním
  offsetem a jinou časovou zónu akce.
- 27 testů časových převodů a programových filtrů prošlo, včetně
  neexistujících a nejednoznačných časů při změně letního času.
- Typecheck a ESLint upravených souborů prošly.
