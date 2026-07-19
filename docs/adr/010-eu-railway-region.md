# ADR-010: EU region pro provoz a data

- Stav: Přijato
- Datum: 20. července 2026

## Kontext

ENJOiT s.r.o. je správcem osobních údajů. Produktové zadání vyžaduje, aby
dodavatelské služby se zpracováním osobních údajů měly smluvně upravené
zpracování a provoz v EU nebo jiný předem právně schválený režim.

## Rozhodnutí

Produkční i stagingové Railway služby — web, worker, PostgreSQL, Redis a privátní
bucket — budou umístěny v jednom schváleném EU regionu. Prostředí mají oddělené
služby, data a credentials. PR prostředí nikdy nedostanou kopii produkčních
osobních údajů.

Externí provider, který zpracovává osobní údaje nebo citlivou telemetrii, se smí
produkčně zapnout až po potvrzení regionu, účelu, DPA a právního režimu.
Railway je pro tento účel také externí zpracovatel, nikoli interní výjimka.

## Důsledky

- Provisioning a runbooky musí region ověřit, ne pouze předpokládat z názvu služby.
- E-mail, error tracking, uptime a malware scanning zůstávají za adaptery do
  schválení konkrétního dodavatele.
- Zálohy, exporty a jejich lifecycle podléhají stejnému regionálnímu požadavku.
- Vývojová data jsou syntetická nebo anonymizovaná.

## Hranice

Tento ADR sám o sobě není právním schválením žádného externího providera a
neuzavírá `BLOCKER-INFRA-01`, `BLOCKER-VENDOR-01` ani `BLOCKER-VENDOR-02`.
Produkční osobní údaje se na Railway nepřenesou před schválením DPA, subprocesorů,
datové rezidence, bezpečnostního modelu a režimu záloh/obnovy. EU deployment
region sám o sobě toto schválení nenahrazuje.

## Vazby

- [Implementační plán](../../AI_IMPLEMENTATION_PLAN.md): §5.2, §17, `BLOCKER-INFRA-01` a `BLOCKER-VENDOR-01/02`.
- [Railway – Regions](https://docs.railway.com/deployments/regions).
- [Railway – Compliance a DPA](https://docs.railway.com/enterprise/compliance).
