# DeveloCRM – Quality / Stability / Consistency Pass

Datum auditu: 15. září 2026  
Výchozí commit: `5392da9`  
Bezpečnostní omezení: bez změn pilotních dat, bez nasazení, bez Security Phase 1 a bez SharePoint implementace.

## A) Executive summary

Audit pokryl hlavní stránky, projektové a jednotkové záložky, detailní obrazovky, tabulky, filtry, sloupcové volby, kontextová menu, formuláře a klíčové repository/API kontrakty. Publikované preview bylo ověřeno read-only pod účtem Adam Lipták. Kritické mutace byly ověřeny pouze automatizovanými izolovanými testy.

Nalezené jednoznačné chyby byly opraveny v commitu `c416e80`:

- aplikace před dokončením načtení krátce zobrazovala prototypovou identitu a fixture data;
- notifikace smluv mohly po refreshi obchodních dat zůstat zastaralé;
- routovací synchronizace nereagovala na změnu query parametrů ve všech případech;
- kontext plateb závisel na nestabilním objektu filtrů;
- portálová menu se při scrollování stránky nepřepočítávala;
- náhled jednotky a záložka Úkoly obsahovaly syntetický obsah;
- několik viditelných CTA nemělo skutečnou operaci;
- v kódu zůstal duplicitní nepoužívaný formulář dokumentu a mrtvé CSS půdorysu.

Security Phase 0 je zdokumentována jako uzavřená v commitu `ca368c2`. Žádná část Security Phase 1 nebyla zahájena.

## B) Nalezené bugy

| Závažnost | Modul | Root cause | Stav | Commit |
|---|---|---|---|---|
| HIGH | Start aplikace / identita | Shell se renderoval z `prototypeSession` dříve, než doběhla identita, katalog, klienti a obchodní projekce. Při pomalejším deep linku byl krátce vidět jiný uživatel a fixture data. | Opraveno fail-closed readiness bránou a bezpečným error stavem. | `c416e80` |
| MEDIUM | Notifikace | Memo notifikací sledovalo reload key, ale ne skutečnou verzi právě aplikované obchodní projekce. | Opraveno vazbou na `commercialDataVersion`. | `c416e80` |
| MEDIUM | Deep links | Synchronizační efekt používal query parametry, ale neměl je v závislostech. | Opraveno. | `c416e80` |
| MEDIUM | Platby | Efekt kontextového seznamu závisel na nově vytvářeném objektu filtrů; to mohlo způsobovat nadbytečné requesty nebo zastaralou projekci. | Opraveno závislostí na stabilních skalárních hodnotách. | `c416e80` |
| MEDIUM | Menu `...` / Sloupce | Portálové menu mělo fixní souřadnice přepočítané jen při otevření/resize a callback mohl zachytit starý počet položek. | Opraveno memoizovaným callbackem a přepočtem při scrollu i resize. | `c416e80` |
| MEDIUM | Úkoly jednotky | Záložka používala dva pevně zadané ukázkové úkoly místo task repository. | Opraveno načtením skutečných úkolů a filtrem na UUID jednotky. | `c416e80` |
| MEDIUM | Půdorys / náhled jednotky | Bez média se vykresloval generovaný fiktivní půdorys s vymyšlenými místnostmi a plochami. | Odstraněno; bez média se zobrazuje skutečný empty state. | `c416e80` |
| LOW | Projekty / smlouvy / poznámky | `Export ceníku`, projektová `Nová smlouva` a `Přidat poznámku` pouze předstíraly akci nebo neměly handler. | Odstraněno. Legitimní smlouva se dál vytváří z workflow jednotky. | `c416e80` |
| LOW | Dokumenty | V souboru zůstal nepoužívaný druhý create modal s technickým polem sales case. | Odstraněno, testy přesměrovány na používaný modal. | `c416e80` |

## C) Nekonzistence UX

Opraveno:

- portálové row-action a column-picker menu nyní drží pozici i při scrollování;
- viditelné akce bez implementace byly odstraněny;
- náhled jednotky už nezobrazuje duplicitní „doporučený další krok“ ani fiktivní plán;
- projektový klientský seznam používá explicitní permission-gated callback pro `Přidat klienta`;
- jednotkové úkoly mají loading, error a empty stav nad skutečnými daty.

Ověřeno bez změny:

- Úkoly: `Sloupce`, menu `...` a otevření editace fungují;
- Dokumenty se otevřely bez zamrznutí, s hlavičkovými filtry a empty stavem;
- tabulkové hlavičky, hodnoty, statusy a volitelné sloupce používají sdílenou centrovací vrstvu;
- dlouhé seznamy nepoužívají klasické stránkování a zachovávají stránkový vertikální scroll;
- datumy ve viditelném preview byly lokalizované bez raw ISO a bez sekund.

## D) Nekonzistence dat a business stavů

Na ustáleném publikovaném preview byly pro Rezidenci Dejvice shodně načteny aktuální hodnoty:

- 19 jednotek celkem;
- 6 prodaných včetně rezervovaných;
- 2 předrezervované;
- 11 volných;
- prodejní výkon 6/19, tedy 32 %;
- 13 klientů, 11 smluv, 7 platebních povinností a 4 předání v projektovém kontextu;
- globální smluvní přehled rovněž evidoval 11 smluv.

Sdílené testy potvrdily konzistenci projektové agregace, cen jednotek a příslušenství, smluvního CTA RS → SBK → KS, platebních stavů, předání a project scope. Nebyla provedena žádná živá právní ani finanční mutace.

## E) Technický dluh

1. `CRMApp.tsx` zůstává velmi rozsáhlý monolit. Bez změny architektury nebyl v tomto passu rozdělován.
2. Frontend build upozorňuje na client chunk větší než 500 kB. Funkčnost to neblokuje, ale před širším rolloutem je vhodný cílený code-splitting.
3. Lint ponechává tři `no-img-element` warningy u autorizovaných/blob media URL. Převod na `next/image` vyžaduje návrh, který zachová chráněný media tok.
4. Část frontendových regresních testů je source-contract testování. Kritická backendová doménová pravidla jsou behaviorální a databázová; frontend by do budoucna profitoval z většího počtu render/interakčních testů.
5. Browser preview adaptéry stále obsahují vývojové fixture identity a data, ale produkční/pilotní režim je fail-closed a implicitní fallback je testem zakázaný.
6. Síťový dependency advisory audit nebyl dokončen: přístup k externímu registru byl bezpečnostní vrstvou odmítnut, protože by odeslal metadata produkčních závislostí. Lokální `pnpm list` navíc narazil na read-only SQLite index runtime cache. Lockfile, frozen install a oba buildy zůstaly beze změny ověřené existujícími quality gates.

## F) Testy přidané nebo upravené

- nový regresní soubor `tests/quality-stability.test.mjs` hlídá odstranění syntetických úkolů, fiktivního půdorysu, mrtvých CTA, duplicitního dokumentového formuláře a stale-closure chyby portálů;
- session recovery test nově hlídá readiness bránu všech čtyř základních datových zdrojů a fail-closed chybový stav;
- dokumentové a MVP workflow testy byly aktualizovány na skutečně používaný formulář a permission-gated klientskou akci;
- existující behaviorální backendová sada ověřila RLS/RBAC, smlouvy, ceny, příslušenství, klienty, platby, předání, média, audit a outbox.

## G) Výsledky quality gate

| Kontrola | Výsledek |
|---|---|
| Frontend production build | PASS |
| Frontend testy | PASS – 123/123 |
| Backend production build | PASS |
| Backend testy | PASS – 158/158 |
| ESLint | PASS – 0 errors, 3 známé media warnings |
| `git diff --check` | PASS |
| Dependency advisory audit | BLOCKED externím síťovým oprávněním; nebyl obcházen |

## H) Změny připravené k nasazení

- `ca368c2` – dokumentace uzavření Security Phase 0;
- `c416e80` – readiness/error gate, reaktivita dat, portálová menu, odstranění syntetických UI dat a mrtvých akcí, regresní testy.

Publikované preview zatím tyto dva commity neobsahuje. Nasazení nebylo provedeno, protože tento pass výslovně neautorizoval další deployment rozhodnutí.

## I) BUSINESS QUESTIONS FOR ADAM

### Blokující

Žádná otázka neblokuje připravené technické opravy.

### Důležité

1. Jaké je závazné pravidlo číslování a okamžiku vzniku dodatků k RS, SBK a KS? UI je správně nechává nedostupné, dokud nebude pravidlo schválené.
2. Mají být interní poznámky smlouvy samostatnou auditovanou entitou, nebo mají být zapisovány jen jako událost do historie? Nefunkční CTA bylo odstraněno, datový model nebyl svévolně doplněn.
3. Jaký má být přesný proces částečně uhrazeného rezervačního poplatku po zrušení RS: ruční vratka, nealokovaný kredit, nebo samostatná záporná transakce? Současná logika částku zachovává a automatickou vratku nevytváří.

### Nice-to-have

1. Má budoucí správa šablon vzniknout až se SharePoint integrací, nebo před ní jako čistě metadata katalog?
2. Má být přesný technický timestamp dostupný v administrátorském tooltipu, nebo postačí log/audit export?

## J) Doporučených 5 dalších kroků

1. Publikovat ověřené commity jako jeden matching frontend release po samostatném deployment schválení a provést autentizovaný read-only smoke test readiness brány.
2. Doplnit render/interakční testy pro loading/error/unauthorized stavy a portálová menu; snížit závislost frontendové sady na source assertions.
3. Rozdělit velký client bundle podle modulů bez změny uživatelského designu a změřit LCP/INP.
4. Rozhodnout tři důležité business otázky výše a teprve poté doplnit dodatky, poznámky a storno/vratkové workflow.
5. Po explicitním schválení přístupu k registru spustit síťový produkční dependency advisory audit a uložit jeho výsledek k release evidence.

## Inventurní checklist

| Oblast | Read-only preview | Automatizované testy | Poznámka |
|---|---:|---:|---|
| Dashboard | ano | ano | KPI, aktivita, termíny, platby |
| Projekty / detail projektu | ano | ano | souhrn a všechny projektové záložky |
| Jednotky / detail jednotky | ano | ano | všech osm záložek pokryto zdrojem/testy |
| Sklepy / parkovací místa | ano | ano | inventář, ceny, assignment invariants |
| Klienti / detail klienta | ano | ano | duplicate check, archivace a vazby v izolovaných testech |
| Smlouvy / detail smlouvy | ano | ano | workflow, verze, podpis, postoupení, zrušení |
| Platby / detail platby | ano | ano | částečné úhrady, scope, idempotence |
| Předání / detail předání | ano | ano | vytvoření až dokončení v izolovaných testech |
| Dokumenty | ano | ano | otevření bez zamrznutí, filtry, verze, vazby |
| Klientské změny | ano | ano | create/archive a project scope |
| Úkoly | ano | ano | Sloupce, `...`, edit modal; bez živého uložení |
| Administrace | ano | ano | Entra profil, role, oprávnění a layout |

