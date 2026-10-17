# RS a SBK podle schválených originálů

## Stav tohoto balíku

Vznikly dva **neaktivní návrhy pro obsahovou kontrolu**, nikoli nové produkční šablony. Použitý je existující striktní DOCX renderer. Není zaveden druhý document model, upload ani renderer. Nebyla změněna pilotní obchodní data, schválení šablon, výchozí šablona ani nastavení projektu.

Schválení zdrojového Wordu není schválením parametrizované verze. Tento balík neprohlašuje dokončení runtime generování právní RS/SBK. Zbývající bezpečnostní a datové podmínky níže musí být vyřešeny před jeho zapnutím.

## Právní zdroje

| Smlouva | Schválený originál | SHA-256 |
| --- | --- | --- |
| RS | Rezidence Dejvice RS vzor 26-02-02.docx | `b57cfd799b64e79641c6cc78684cbfd053f14439102447d09e08d83e3af721bd` |
| SBK | Dejvice SBK vzor 26-02-05.docx | `bc79743f8c9561a51f015a02a8a083416a3b12d32918875f2a974bce2a22c160` |

Adam výslovně potvrdil originál SBK. Dne 17. 10. 2026 schválil datum narození namísto rodného čísla také pro SBK a jako první výslovně zvolil kompletní variantu příslušenství. Oba nové návrhy tedy používají datum narození; pole pro RČ ani zástupná hodnota RČ v nich nejsou. Toto rozhodnutí nemění ani neodstraňuje historické dokumenty.

Předchozí technická RS `backend/templates/rs/rezidence-dejvice-rs-v1.docx` není obsahovým zdrojem tohoto balíku. Její zjednodušené generované odstavce se nepřebírají.

## Výstupy a způsob parametrizace

- `backend/templates/review/rs-dejvice-original-review.docx`: 35 přesných změn textových úseků, 32 různých parametrů.
- `backend/templates/review/sbk-dejvice-original-review.docx`: 42 přesných změn textových úseků, 37 různých parametrů.
- Ke každému souboru patří manifest s hashem zdroje, hashem návrhu, povinnými poli, původním textem každé změny a kontrolními součty původních odstavců i částí balíku.
- Aktuální vyplněné technické vzorky jsou v `outputs/contract-review/rs-review-filled.docx` a `outputs/contract-review/sbk-review-filled-2026-10-17.docx`. Starší SBK vzorek ze 16. 10. je překonaný a nepoužije se k aktivaci.

Změny probíhají pouze uvnitř původních textových uzlů Wordu. Odstavce, styly, číslování, záhlaví, zápatí, vztahy, obrázky, rozměry stran a další netextové části se nepřestavují. Jediná změna pevného popisku v každé smlouvě je výslovně schválené `RČ` → `Datum narození`. Po vrácení parametrů na původní text je kontrolní součet každého odstavce totožný s originálem.

Oba vzorky byly vykresleny a všechny strany vizuálně zkontrolovány: RS 4 strany, SBK 11 stran, stejné počty jako originály. Žluté zvýraznění a původní podpisové linky zůstávají podle zdroje. Nejde o právní posouzení významu textu ani o otevření v desktopovém Microsoft Wordu.

## Field-gap a mapování

| Oblast | Co už existuje | Co chybí nebo není bezpečně odvoditelné | Řešení před runtime |
| --- | --- | --- | --- |
| Výběr smlouvy | `contracts`, `contract_versions`, `sales_cases`, přesná vazba na dokument | Současná RS služba zná starý soubor celých odstavců, nikoli nové skalární schema; SBK business generátor není zapojen | Rozšířit existující služby o explicitní profil/variantu, nepřidávat paralelní engine |
| Prodávající | Projektové smluvní nastavení: název, IČO, sídlo, rejstřík, zástupce, kontakty, účet, banka | Samostatný podpisový tvar jména, doručovací adresa a účet klientských změn; opakované údaje v těle SBK a cíle e-mailových hyperlinků zatím zůstávají původní | Rozšířit současné projektové nastavení jen o potřebná pole; stejný údaj mapovat ve všech výskytech, příjemce postoupených pohledávek nezaměňovat automaticky s bankou účtu |
| Kupující FO | `parties`, person details, oslovení, jméno, datum narození, kontakty, adresy | Doplnění aktuálních hodnot klienta; datum narození je schválené pro RS i SBK | Autorizovaný backend kontext, readiness; žádná libovolná render data z UI |
| Doručovací adresa | `party_addresses` podporuje korespondenční adresu | Současný RS zdroj načítá pouze bydliště | Převzít existující adresní model, ne nový sloupec s duplicitou |
| RČ v budoucí jiné variantě | `party_private_identifiers` s ciphertext, hashem a key version | Pro tyto nové varianty není potřebné a není součástí schema | Neimplementovat sběr RČ kvůli těmto šablonám. Případná budoucí právně odůvodněná varianta vyžaduje samostatně ověřené zabezpečení |
| Firma / více kupujících | Company details, `contract_parties`, `sales_case_parties`, podíly | Dodané identifikační bloky jsou pro jednu FO, přesto SBK dále zmiňuje více osob | Neodvozovat vlastní právní znění. Pro jiné kupující vyžadovat odpovídající zkontrolovanou variantu |
| Jednotka | Kód, podlaží, plochy, dispozice, cenová historie a cenový snapshot smlouvy | Rozdíl mezi kódem podlaží a číslovkou před pevně napsaným „NP“; přesné právní přiřazení ploch | Typované mapování; např. nevložit celé „3. NP“ před další „NP“ |
| Příslušenství | Inventář, typy, ceny, aktuální přiřazení, historie | Současná klasifikace v RS částečně odhaduje garáž podle popisu/podlaží; libovolné kombinace a více parkingů nejsou v tomto skalárním vzorku pokryté | Nepřidělovat příslušenství odhadem. Readiness zastaví nepodporovanou kombinaci; připravit konkrétní varianty ke kontrole |
| Garážový podíl | Podíly osob již existují | Nejde o totožný pojem jako právní podíl na garáži | Zachovat text originálu. Nezaměňovat s podílem kupujícího ani s aktuálním počtem inventárních položek |
| Kupní cena | Canonical cenová projekce a smluvní snapshot, historie verzí | Aktuální autorizovaná změna musí být odlišena od historicky podepsané RS | Zobrazit rozdíly, nový snapshot nové SBK; podepsanou RS nepřepisovat |
| Rezervační poplatek | Povinnost, transakce, allocations a refunds | Předpis není důkaz platby; SBK výslovně potvrzuje platbu před podpisem | Ověřit skutečně přijatou a nevrácenou částku ve správném obchodu, nesplněné tvrzení zablokuje generování |
| Splatnost RS | Skutečné podpisy a jejich evidence existují | Starý create flow požaduje budoucí splatnost už při založení; `payment_obligations.due_at` je povinné | Koordinovaná změna stávajícího platebního modelu pro čekání na podpis. Nepoužívat fiktivní datum ani změnu starých předpisů |
| Kalendář | Časové údaje podpisu | Sdílený kalendář českých pracovních dnů zatím nenalezen | 3 pracovní dny od skutečného podpisu, víkendy i české svátky; testy Velikonoc, Vánoc a časových pásem |
| Splátky SBK | Finance a přesné částky lze číst v backendu | Autoritativní datum doručení výzvy a jeho evidence; bezpečné zaokrouhlení schváleného plánu | 20 % z kupní ceny, 80 % minus zaplacený poplatek podle originálu. Nevytvářet splatnost doplatku z data generování |
| Pevné projektové údaje | Některé obecné údaje projektu | Parcely, LV, stavební povolení, příjemce postoupených pohledávek, termíny 2027/2028 a přílohy nejsou kompletně ve smluvním nastavení | Tyto návrhy jsou vázané na konkrétní originál Dejvic, nikoli univerzální šablony pro jiný projekt/developera |
| Přílohy | Dokumentový model, SharePoint | V dodaných souborech jsou pouze seznamy příloh; samotné přílohy nejsou vložené | Dodat konkrétní schválené přílohy a jednoznačné verze/vazby; neoznačovat samotný Word jako úplný smluvní balík |

## Schéma prvního návrhu

Přesný strojově čitelný seznam je v odpovídajícím `*-review-manifest.json`; všechna uvedená pole jsou povinná pro tuto konkrétní variantu. Tokeny jsou prosté `{{entity.field}}`, bez výrazů a spouštění kódu.

Společné skupiny:

- `seller`: `name`, `address`, `registryEntry`, `registrationNumber`, `representative`, `email`, `dataBox`, `bankAccount`, `bankName`, `signatureName`.
- `buyer`: `salutation`, `name`, `address`, `birthDate`, `email`, `phone`; RS dále `dataBox`; SBK dále `deliveryAddress`.
- `unit`: `code`, `floorNumber`, `outdoorSpaceCase`, `outdoorParkingCode`, `cellarCode`, `cellarFloor`, `garageCode`, `garageFloor`, `variableSymbol`; SBK také `area`, `outdoorSpaceArea`, `gardenArea`.
- `contract`: `totalPriceAmount`, `totalPriceWords`, `sellerPlannedDate`, `buyerPlannedDate`.
- `payment`: RS `reservationFeeAmount`, `reservationFeeWords`; SBK `reservationFeePaidAmount`, `firstInstallmentAmount`, `finalInstallmentAmount`.
- SBK dále `seller.clientChangesBankAccount`.

Podpisová data ve vzorku jsou **plánované hodnoty pro kontrolu dokumentu**, nikoli důkaz skutečného podpisu a nikoli začátek platební lhůty.

### Co má doplnit systém a co člověk

Automaticky ze stávajících autorizovaných entit: prodávající z projektového nastavení, konkrétní kupující z daného obchodu, identifikace a adresa klienta, jednotka a aktuální příslušenství, schválený cenový snapshot, skutečné úhrady, odvozené částky splátek a čísla slovem. Chybějící trvalý údaj se má doplnit na příslušné kartě klienta/projektu/jednotky, ne přepisovat při každém generování.

Člověk musí zaznamenat skutečné události, které systém nezná: datum podpisu poslední požadované strany (případně přesná data stran), skutečné doručení výzvy, rozhodnutí o schválené změně proti RS a konkrétní schválení šablony/příloh. Plánovaná data ve Wordu musejí být jasně oddělená. Nelze je vydávat za skutečný podpis nebo doručení.

## Pravidla, která nesmějí být domyšlena

1. RS čl. VI stanoví účinnost podpisem poslední strany. Přesto je nutné v UI jasně odlišit skutečná data podpisů jednotlivých stran od data evidence v CRM; při neúplné evidenci lhůtu neodhadovat.
2. Adam potvrdil nejprve kompletní variantu příslušenství. U bytu bez zahrady či parkingu nelze pouze nahradit jejich označení pomlčkou a ponechat tvrzení, že je kupuje. Automatické vypouštění právních odstavců není v tomto balíku zapnuté; další varianty se připraví zvlášť ke kontrole.
3. Originál SBK má RČ, ale Adam 17. 10. výslovně schválil jeho nahrazení datem narození. Toto již není otevřená otázka; obsahové schválení celého parametrizovaného návrhu nadále chybí.
4. Pevné právní údaje a opakovaná identita v těle SBK jsou zatím vázané na původní Dejvice. Změnu prodávajícího nelze bezpečně provést pouze změnou úvodního bloku.
5. Původní text obsahuje odkazy na přílohy i bankovní/finanční ujednání. Tento balík je neopravuje ani nesjednocuje vlastní právní interpretací.

## Navazující technické kroky

1. Obsahová kontrola vyplněných Wordů pro jednoho kupujícího a kompletní variantu příslušenství, s datem narození v RS i SBK.
2. Explicitní profil nového scalar schema ve stávajícím katalogu. Staré schválené verze nesmějí být tiše přeinterpretovány novým mapperem.
3. Doplnění skutečně chybějících polí do existujícího modelu, autorizovaný RS/SBK kontext a readiness včetně platební evidence a příloh.
4. Splatnosti od skutečných událostí v jedné řízené doménové transakci; historie a původní platby beze změny.
5. Rozšířit stávající přípravu smlouvy o SBK, rozdíly proti RS, generování přes existující upload service, audit, snapshot a exact-version evidence podpisu.
6. Izolační, idempotentní, PostgreSQL concurrency a autentizované browser E2E testy pouze na technických datech.
7. Nasadit technické změny; teprve po výslovném schválení konkrétní parametrizované verze povolit její aktivaci pro projekt.

## Reprodukce kontroly

`backend/scripts/prepare-reviewed-contracts.py` přijímá dva originály a cílový adresář. Odlišný source hash odmítne. `backend/scripts/render-reviewed-contracts.ts` používá existující `renderDocxTemplate` a odmítne aktivní nebo nesyntetický review manifest. `backend/tests/legal-template-review.test.ts` kontroluje původ, neaktivní stav, schema, všechna zachovaná data balíku, přesný text všech odstavců, render a chybové stavy.

Výsledky tohoto balíku:

- 12 nových testů právních review šablon: prošlo.
- Celý backend: 307 prošlo, 0 selhalo, 2 volitelné nativní PostgreSQL testy přeskočeny bez nastavené testovací DB. Nový balík nemění databázové operace ani zámky.
- Frontend: 143 prošlo; interaction: 58 prošlo.
- TypeScript frontend i backend: prošlo.
- Lint: prošlo; pouze informační Babel upozornění na velikost stávajícího `CRMApp.tsx`.
- Produkční frontend build: prošel, existující upozornění na velikost chunků. Backend build: prošel.
- Word render: RS 4/4 stran a SBK 11/11 stran zkontrolováno proti stejně dlouhým originálům, bez zjištěného překryvu či oříznutí textu.
- Živý generation/upload/browser E2E nové právní šablony **neproběhl**; zatím nejde o napojené runtime profily. Obsahová kontrola ani předchozí technický E2E jej nenahrazují.

V tomto balíku není runtime změna ani migrace a není důvod kvůli samotným neaktivním souborům restartovat pilotní backend nebo publikovat jiný frontend. Produkční integrace RS/SBK zůstává rozpracovaná.

### Doplnění 17. 10. 2026

Po potvrzení obou business rozhodnutí byla SBK znovu vytvořena s `buyer.birthDate` a popiskem `Datum narození`. Schema již neobsahuje `buyer.birthNumber`. První kontrolovaná varianta nadále obsahuje veškeré původní příslušenství; nejde o souhlas s jeho automatickým vypouštěním u jiných variant.

Opakovaně prošlo 21 cílených testů (12 review + 9 renderer), backendový TypeScript build a lint změněných TypeScript souborů. Nový Word má stále 11 stran, všechny byly vizuálně zkontrolovány. Změna nezasáhla runtime, DB, obchodní data ani aktivaci šablon. Celkové testy uvedené výše pocházejí z předchozího balíku ze 16. 10.; toto doplnění je nevydává za nově spuštěné.
