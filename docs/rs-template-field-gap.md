# Rezervační smlouva RS field gap

## Zdroj

- Referenční dokument: `Rezidence Dejvice RS vzor 26-02-02.docx`
- SHA-256: `d90487591386a29a4584ecafe253af86d7b1beba6365720f441b8ebc55e08152`
- Čtyři strany A4, jedna sekce, původní dokument zůstává nezměněný.

## Údaje dostupné v CRM

- projekt, jednotka, podlaží, dispozice a evidované plochy;
- aktuální cena jednotky a aktivního příslušenství;
- aktivní sales case a jeho kupující;
- fyzická nebo právnická osoba, jméno/název, datum narození/IČO;
- primární adresa, e-mail, telefon a datová schránka;
- aktivní sklepy, parkovací stání a wallboxy;
- výše a splatnost rezervačního poplatku na smlouvě;
- dokumenty, jejich business verze a SharePoint metadata.

## Nedostatečně normalizované údaje

- `projects.project_company` je pouze volný text a nestačí pro právní identifikaci prodávajícího.
- Rodné číslo existuje pouze jako šifrovaný privátní identifikátor bez provozního read/decrypt portu. První schválená šablona proto používá datum narození; změna zpět na rodné číslo vyžaduje samostatné bezpečnostní a právní rozhodnutí.
- Projektové katastrální a stavební údaje jsou součástí konkrétní neměnné šablony Dejvice. Nejsou zatím obecnou doménovou konfigurací pro libovolný projekt.

## Chybějící údaje

- normalizované smluvní nastavení projektu: prodávající, sídlo, IČO, zápis v rejstříku, zástupce, kontakty, datová schránka, bankovní účet, banka a standardní rezervační doba;
- stav schválení a datum účinnosti neměnné verze šablony;
- přímá vazba konkrétní business verze smlouvy na vytvořenou dokumentovou verzi.

## Systémově odvozené hodnoty

- projekt, jednotka, podlaží, kupující a jeho aktivní kontakty/adresa;
- aktuální přiřazené příslušenství;
- cenový snapshot smlouvy a částka slovy;
- variabilní symbol z označení jednotky;
- datum generování a rok plánovaného dokončení;
- reference, pořadí a vazby contract/document version.

## Ručně zadané hodnoty

- výše a splatnost rezervačního poplatku při založení RS, pokud nejsou převzaty z uložené smlouvy;
- žádné libovolné placeholder hodnoty se neposílají z frontendu.

## Placeholder mapování v1

| Oblast | Placeholdery | Zdroj |
| --- | --- | --- |
| Prodávající | `seller.name`, `seller.address`, `seller.registryEntry`, `seller.registrationNumber`, `seller.representative`, `seller.email`, `seller.dataBox`, `seller.bankAccount` | `project_contract_settings` konkrétního projektu |
| Kupující | `buyer.salutation`, `buyer.name`, `buyer.address`, `buyer.birthDate`, `buyer.email`, `buyer.phone`, `buyer.dataBoxLine` | aktuální `contract_parties` + party detail, primární adresa a aktivní kontakty |
| Projekt | `project.name`, `project.completionYear` | projekt a plánované dokončení |
| Jednotka | `unit.subjectClause`, `unit.balconyClause`, `unit.gardenClause` | jednotka a její uložené plochy |
| Příslušenství | `unit.outdoorParkingClause`, `unit.cellarClause`, `unit.garageClause` | cenový snapshot smlouvy obohacený inventářem příslušenství |
| Obchod | `contract.reservationPeriodDays`, `payment.reservationFeeClause`, `contract.totalPriceClause`, `contract.date` | projektové nastavení, cenový snapshot smlouvy, uložený poplatek a jeho splatnost, datum generování |

Název banky je součástí normalizovaného projektového nastavení a vstupuje do serverem sestavené věty `payment.reservationFeeClause`; frontend jej ani jiné render hodnoty neposílá.

## Omezení první verze RS

Skutečná dodaná šablona obsahuje jednu smluvní pozici kupujícího a text pro fyzickou osobu. První verze proto bezpečně podporuje právě jednoho aktivního kupujícího fyzickou osobu. Právnická osoba a více kupujících jsou blokovány readiness validací, dokud nebude schválena odpovídající varianta právní šablony.

Stejná verze neobsahuje právní popis wallboxu. Pokud je wallbox součástí cenového snapshotu smlouvy, generování se zastaví a vyžádá schválenou rozšířenou šablonu místo vytvoření neúplného dokumentu.
