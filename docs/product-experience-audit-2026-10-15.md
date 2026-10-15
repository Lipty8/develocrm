# DeveloCRM – Product Experience & Workflow Integration

Výchozí stav: GitHub `79a8d6f`, backend `archive-cd31d90`, Sites 131, migrace 0059. Audit je evidence k tomuto checkoutu, nikoli tvrzení, že každé CTA prošlo živým testem. Pilotní obchodní data neměnit.

## Stav a navigační návrh

Zachovat projekt → jednotka jako pracovní kontext. Globální seznamy slouží průřezové práci. Odkazy identifikují entity UUID; označení a jméno jsou jen popisky. Chybějící vazba nikdy neznamená první záznam seznamu. Klient může mít několik projektů, jednotek, obchodů a smluv. Jeho detail nesmí omezit obchodní data na první nalezený projekt.

Jednotka zůstává rozdělená na Přehled, Smlouvy, Platby, Dokumenty, Předání, Úkoly a historii. Centrální sales projection je autoritou pro etapu/CTA, finanční projection pro částky a signed document evidence pro podpis. Nepřidávat druhý panel s duplicitními mutacemi. Stav → potřebná informace → jedna přirozená akce v příslušné záložce.

## Nálezy podle priority

| Priorita | Konkrétní scénář a důkaz | Řešení / stav |
| --- | --- | --- |
| P0 | `CRMApp.tsx`: klient, smlouva, platba, dashboard a předání používají `units.find(code) ?? units[0]`. Chybějící jednotka otevře cizí první záznam; stejné číslo ve dvou projektech není jednoznačné. | Odstranit náhradní první jednotku, odkazy UUID nebo jednoznačný code+projekt. |
| P0 | Klient otevřený UUID se promítá do `selectedClientName` a znovu vybírá shodou jména. Dva stejně pojmenovaní klienti otevřou první profil. | Výběr podle ID, jméno pouze prezentace. |
| P1 | `catalogProjectId` na detailu klienta bere první projekt katalogu; následný commercial snapshot neobsahuje jeho smlouvy v jiném projektu. | Klient není projektově scoped detail; každý repository dále vynucuje vlastní backendová oprávnění. |
| P1 | Globální hledání prochází mutable `projects/units/clients/contracts` aktuální obrazovky, ne celý autorizovaný pracovní prostor. Z detailu projektu nenajde jiný projekt. | Oddělený unscoped read-only snapshot z existujících autorizovaných repositories; neměnit data otevřené obrazovky. |
| P1 | Hledání vytváří výsledek typu Dokument ze smlouvy a otevírá smlouvu, nikoli dokument. | Odstranit falešný typ výsledku; v tomto balíku hledat skutečné projekty/jednotky/klienty/smlouvy. |
| P1 | ClientDetail má jednotky a dokumenty, samostatnou PaymentContextTable, ale chybí přímý seznam jeho smluv; odkazy na klienta používají jméno. | Seznam smluv podle `contract_parties.partyId`, odkazy na party UUID. |
| P1 | „Sdílet odkaz“ jednotky pouze zobrazuje toast o zkopírování, clipboard se nemění. | Skutečný zápis kanonické URL do clipboardu, úspěch až po dokončení, zvlášť chyba. |
| P1 | Živé E2E: ukončená RS 417 spouští generation readiness, ta vrací nenalezenou RS; průběh přitom označuje V přípravě za aktuální krok. | Druhý malý UI balík: uzavřené smlouvy nemají aktivní průběh, generation ani běžné CTA změny stavu. Historie, verze, evidence a platby beze změny. |
| P1 | Dashboard `today-events` vypisuje pevně „Bez naplánovaných událostí / Rezidence Dejvice“ a activity dotaz bere první projekt. | Backlog: kalendář z existujících handovers/tasks a průřezová activity query; nepovažovat za skutečný globální kalendář. |
| P1 | Některé request efekty mění globální pole i po abortu při přechodu mezi projekty. | Guard před změnou sdílených polí; širší odstranění mutable stores není součást tohoto malého balíku. |
| P1 | `SalesRepository.getDirectory` vrací `unitContexts` klíčované pouze kódem jednotky. V globálním snapshotu se dvě stejná čísla z různých projektů mohou přepsat. | Vyžaduje samostatný matching API/UI balík s UUID klíči a testem dvou projektů; není opraveno pouhou opravou odkazů. |
| P1 | Seznam klientů při chybě/timeoutu serverového filtrování přejde na lokální snapshot a nezobrazí, že výsledek není aktuální. | Samostatně změnit na explicitní error/retry a ochránit souběh lazy-loading stránek. |
| P2 | U smlouvy je projekt prostý text, aktuální smluvní strany nejsou odkazy. | Přímé projekt/party odkazy, zachovat historii stran. |
| P2 | Živé E2E: podepsaná TECH57-GEN-RS při čekání na úspěšný readiness GET (200, req-48p) krátce tvrdí, že dokument nelze ověřit. | Samostatný loading stav, žádná falešná chyba ani předčasné povolení otevření/podpisu. |
| P2 | UnitContracts obsahuje technickou a již zastaralou větu o budoucí aktivaci šablon. | Odstranit, nikoli slibovat dostupnost SBK/KS generování. |
| P2 | Informace o interním storage/source, logické verzi, řízených operacích zůstávají v několika formulářích. | Postupně odstranit po ověření významu; nezaměnit za business varování. |
| P2 | Katalog vrací užitečná UUID, ale commercial ContractItem vrací jen kód jednotky + UUID projektu; document relations jsou textové seznamy. | Bezpečně kvalifikovat existující vazbu; budoucí malé DTO rozšíření bez nových tabulek. |
| P3 | Celý hlavní frontend zůstává v rozsáhlém CRMApp; samostatný tsc má starší diagnostiky. | Technický dluh; žádný masivní přepis pro tuto etapu. |

## Zmapované oblasti – implementace versus limity

- Projekty/inventář: skutečný katalog, cenová projection, importy, accessory assignments, archivační operace s auditem, lifecycle nezávislý na archived_at. Předchozí E2E archivace je samostatný report, není nahrazen tímto auditem.
- Klienti: canonical party, kontakty/adresy, duplicate check, projektové vztahy, historie zájmů a aktivit, archivace, stránkované API/automatické načítání. Neexistuje samostatná plnohodnotná obrazovka každého sales case; jednotka a smlouva tvoří jeho současný UI kontext.
- Obchod: centrální `next-contract-action` a `unit-sales-workflow`, řízené zájmy/holds, expiry runtime, ochrana smluvní rezervace. Existující obecná evidence SBK/KS neznamená onboardovanou právní šablonu a generování těchto smluv.
- RS/dokumenty: readiness → schválená immutable template version → generation snapshot → existující SharePoint upload → exact document version → evidence podpisu. Signed evidence, idempotence a doménové audit/outbox operace v tomto UX balíku neměnit.
- Platby: obligation/transaction/allocation/refund model, existující filtered API a PaymentContextTable. Částky/stavy nepočítat jinak pro nové klientské odkazy. Refund CTA zůstává na detailu povinnosti.
- Předání: schedule/update/history, unit UUID, dokončení oddělené od plánování. Navigace kalendáře/listu musí mířit na správnou jednotku; nový kalendářový model není potřeba.
- Úkoly: repository-backed seznamy, scope, shared columns/actions; vazby neznamenají oprávnění k cílové entitě. Backend je dále vynucuje.
- Dokumenty/šablony: existující lists, document relations, správa template lifecycle, approved gate a SharePoint. Nezavádět druhé úložiště ani falešný výsledek dokumentu ze smlouvy.
- Oprávnění: existující Entra membership + projektové permission queries/RLS zůstávají autoritou. Žádné rozšíření Graph, žádný nový grant ani admin bypass. Vyhledávání nesmí používat preview seed při chybě pilotního API.

## Rozsah prvního implementačního balíku

Bezpečné entity odkazy, ID klienta, víceprojektový klient, přímé smlouvy klienta, oddělené workspace hledání, odstranění falešných dokumentových výsledků, funkční clipboard, ochrana abortovaných odpovědí. Pouze frontend; bez migrace a bez změny právních/finančních pravidel. Nové generování SBK/KS, podpisová integrace a změny obchodních dat vyloučeny.

## Ověření

- 143 frontendových testů pass; 45 interakčních pass, včetně duplicitních jmen/čísel, víceprojektového klienta, hledání mimo aktuální projekt a technického selhání bez seed fallbacku.
- Backend regression: 275 celkem, 274 pass, 1 volitelný skutečný PostgreSQL concurrency skip, 0 fail. Backendový kód ani model tento balík nemění.
- Frontend production build pass; cílený lint 0 errors / 0 warnings (jen informační Babel poznámka k velikosti CRMApp).
- Celoprojektový samostatný tsc zůstává nezelený. Nezměněný baseline má stejné kategorie diagnostik v CRMApp, Cloudflare a testech; nejsou opravovány nesouvisejícím přepisem. Nové entity-navigation/workspace-search komponenty nemají vlastní typovou diagnostiku.
- Matching deployment a autentizovaný read-only browser E2E doplnit po provedení. Soukromé preview při kontrolním otevření vyžaduje nové přihlášení vlastníka; žádný bypass ani rozšíření sdílení.

### První živé ověření (Sites 132)

Po standardním přihlášení Adam Lipták / Administrátor: Dejvice → globální hledání `hrdlicka` → Hrdlička UUID; z prázdné Hrdličky hledání `417` → jednotka Dejvice UUID i skutečné RS/SBK výsledky. Žádné falešné Dokument výsledky.

Jednotka 417 → aktuální kupující F&F → zpět na přesnou jednotku; jednotka → RS 417 → smluvní strana Monika → její dvě smlouvy. Reload klienta zachová správné UUID, obě smlouvy a dvě platební povinnosti. Z klienta otevřen detail rezervačního poplatku (3 263 000 Kč), jeho odkazy míří přesně na jednotku/klienta/RS. Klik platba → smlouva prošel. Žádná mutace obchodu, podpisu, platby ani vratky nebyla potvrzena.

Nové zjištění mimo tento UI balík: jednotka 417 má po načtení projekce etapu SBK, ale její zobrazené RS i SBK jsou ukončené. Nesmí se řešit přepisem ostrých dat ani domýšlením právního rollbacku SBK. Vyžaduje diagnostiku aktuálního case versus historických smluv v dalším workflow balíku. Také při načítání kontextových plateb souhrny krátce ukazují nuly; ty nejsou důkazem nulové pohledávky. Po načtení hodnoty odpovídají evidenci.

Druhý UI balík otestován: 143 frontendových + 46 interakčních testů pass, lint bez errors/warnings, produkční build pass. Finální E2E uzavřených smluv ověřit po jeho publikaci.

### Ověření dokumentové větve

Existující technická TECH57-GEN-RS → Dokumenty → skutečný dokument `8a3e6838-007c-48bc-b00c-ee737f501d77` → zpět na stejnou smlouvu funguje. Žádné generování ani nová dokumentová verze nebyly spuštěny. Readiness backend GET vrací 200 (req-48p), po načtení lze otevřít přesnou podepsanou verzi. Browser skutečně stáhl existující `technical-rs-0057-ue Oct 13 2026.docx` tlačítkem Otevřít přesný dokument ze SharePointu. Nebyl procházen libovolný storage key ani získáván browser token.

Původní chybové hlášení při prvním zobrazení tedy nebylo chybou persistence/Graph: panel dostával documentReady=false po dobu kontroly a vydával čekání za nedostupnost. Oprava předává explicitní verifying a testuje přechod čekání → ověřený dokument. Celkem finálně 47 interakčních testů pass; finanční/smluvní backend beze změny.

## Doporučené navazující malé balíky

1. Dokončit read-only E2E bezpečných odkazů, workspace hledání a klientských smluv na publikované verzi; při chybě nevydávat component test za E2E.
2. Kanonické UUID pro unitContexts a navazující výběry obchodních případů; stejné číslo jednotky ve dvou projektech nesmí měnit kupujícího ani CTA.
3. Klientské lazy-loading výsledky: fail-closed chyba/retry místo tichého starého snapshotu, zrušení starých requestů.
4. Dashboard: skutečné naplánované události a průřezová autorizovaná aktivita, bez přidávání nových metrik/modelů.
5. Dokumentové relations doplnit o bezpečné identifikátory pro obousměrné odkazy; navázat klientské předání přes existující parties/sales case, nikoli shodou jména.

Tato fáze je průběžný integrační pass, nikoli certifikace celého CRM jako kompletně dokončeného produktu. Uvedené otevřené nálezy zůstávají explicitním backlogem.
