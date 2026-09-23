# DeveloCRM — Fáze 1 readiness (23. 9. 2026)

## Verdikt před finálním release

Aktuální zdrojový stav je **READY WITH LIMITATIONS**. V lokálně ověřené verzi není známý P0 blocker hlavního CRM provozu. Obchodní proces, alternativní smluvní cesty, platby a vratky, předání, příslušenství, klientské změny, reklamace, úkoly, oprávnění, audit a nové vazby dokumentů mají automatizované pokrytí. Finální release s migracemi 0044 a 0045 však ještě není v pilotu nasazený.

Jediné zásadní funkční omezení mimo běžný CRM provoz je skutečná SharePoint integrace: backendová managed identity nemá Graph aplikační roli/site grant a Container App nemá cílovou Graph/SharePoint konfiguraci. CRM proto může evidovat metadata a business vazby dokumentů, ale zatím nemůže bezpečně provádět produkční upload ani generování Word dokumentů do SharePointu. Toto omezení neblokuje používání CRM pro evidenci obchodu, smluv, plateb, úkolů a předání, ale blokuje prohlášení dokumentového toku za dokončený.

Pilotní obchodní data nebyla během dokončování měněna.

## Současný stav

| Oblast | Stav | Poznámka |
| --- | --- | --- |
| Dashboard, projekty, jednotky, KPI | Připraveno | Databázová projekce odvozuje `Volný / V jednání / Prodaný` ze současného aktivního obchodu, smluv a plateb; dashboard, projekt i tabulka jednotek používají stejný výsledek. |
| Klienti a kupující | Připraveno | Aktuální kupující vychází z aktivních účastníků současného sales case, respektuje postoupení a nevrací historické kupující. |
| Sklepy, parkování, wallboxy | Připraveno | Podpora volného, předpřiřazeného a přiřazeného inventáře bez vytvoření sales case. |
| Smlouvy | Připraveno | RS, SBK, KS, verze, podpis, zrušení, dodatky a postoupení; RS i SBK jsou volitelné. |
| Alternativní smluvní cesty | Připraveno | Automatizovaně ověřeno `RS → SBK → KS`, `RS → KS`, `SBK → KS` a přímá `KS`. |
| Platby a vratky | Připraveno | Předpisy, částečné úhrady, allocations, splatnost, overdue, refund decision a skutečné vratky. |
| Předání | Připraveno | Jeden doménový objekt pro globální i jednotkový pohled, stavy a historie. |
| Klientské změny | Připraveno pro interní pilot | Řízené stavy, odpovědná osoba, termín, poznámky, historie a vazby dokumentů. Fakturace se automaticky nezakládá. |
| Reklamace | Připraveno pro interní pilot | Řízený stav, odpovědná osoba, termín, historie a vazby dokumentů. |
| Úkoly a interní notifikace | Připraveno | Moje úkoly, po termínu, dnes, tento týden a kontextová upozornění. |
| Role, RBAC, RLS, audit, outbox | Připraveno | Backendové vynucení a integrační testy včetně izolace projektu/tenantu. |
| Dokumentová metadata a vazby | Připraveno lokálně | Dokumenty lze navázat na klientskou změnu, reklamaci a předání; migrace 0044 čeká na release. |
| SharePoint upload a Word generování | Externě blokováno | Chybí Graph `Sites.Selected`, site-level write grant a runtime konfigurace. |

## Implementované balíky

- `2b7bc32` — izolovaný integrační test hlavní obchodní cesty.
- `638e717` — pražské termínové pohledy úkolů a UI klientských změn.
- `a892a29` — migrace 0040, řízené stavy klientských změn a auditní historie.
- `fadba01` — migrace 0041, jednoduchý reklamační workflow.
- `5a2bb95` — migrace 0042, odpovědná osoba a idempotentní poznámky klientské změny.
- `7e0d6ab` — notifikace nezávislé na aktuálním filtru úkolů.
- `a06f5d8` — dokumentace cílové SharePoint knihovny a šablon.
- `aa55fe9` — připravený Graph token provider pro user-assigned managed identity a ověření opravy KS.
- `24904e3` — schválená business pravidla Fáze 1 a migrace 0043.
- `0df18fa` — migrace 0044, dokumentové vazby klientských změn, reklamací a předání včetně UI, auditu a outboxu.
- finální release — migrace 0045, centrální projekce aktuálního kupujícího a manažerského stavu jednotky a jednotná invalidace UI po mutaci.

## Migrace

- Pilotní matching release `24904e3` používá migrace do 0043.
- Finální lokální release přidává aditivní migrace `0044_phase1_document_workflow_links.sql` a `0045_unit_business_projection.sql`.
- 0044 vytváří tři vazební tabulky, projektově bezpečné cizí klíče, RLS/FORCE RLS, audit, outbox a idempotentní příkazy.
- 0045 zavádí jedinou čtecí projekci pro aktuální kupující a KPI `Volný / V jednání / Prodaný`. Prodaná je podepsaná RS s plně uhrazeným rezervačním poplatkem, přímo podepsaná SBK/KS nebo předaná jednotka; zrušené a historické případy se nezapočítají.
- Migrace nemažou ani nepřepisují existující obchodní data.

## Validace finálního zdrojového stavu

- Backend: **175/175 testů prošlo**.
- Frontend statické/regresní testy: **127/127 prošlo**.
- Interaction testy: **15/15 prošlo**, včetně úspěšné i odmítnuté mutace bez browser reloadu.
- ESLint: **0 chyb**, 3 dříve existující upozornění na `<img>`.
- Backend production build: **prošel**.
- Frontend production build: **prošel**; zůstává pouze neblokující upozornění na velikost chunku.
- Čistá PGlite databáze aplikuje migrace do 0045.
- Integračně jsou pokryté alternativní smluvní cesty, dokumentové vazby, audit, outbox, idempotence a 11 stavů centrální business projekce.
- Úspěšné POST/PATCH/DELETE požadavky vyvolají jednu sdílenou invalidaci katalogu, klientů, smluv, dokumentů, plateb, předání a úkolů; dotčené obrazovky se obnoví bez ručního reloadu.

## Read-only kontrola pilotu

- Aktivní backend revize: `ca-develocrm-api-pilot--phase1-24904e3`.
- Revize je Healthy a provisioning je Succeeded.
- `/health` vrací 200.
- `/ready` vrací 200 a databáze je dostupná.
- Autentizovaný smoke potvrdil dashboard, projekty, Rezidenci Dejvice, jednotku 417, klienty, smlouvy, platby, předání, úkoly a dokumenty.
- Rezidence Dejvice má 19 jednotek; read-only UI ukazuje 5 jednotek `V jednání` a 0 prodaných. Tento stav nebyl automaticky opravován ani reinterpretován.
- V pilotu jsou dva aktivní projekty (Rezidence Dejvice a Hrdlička); Hrdlička nebyla bez důkazu považována za demo data.
- Dokumenty korektně zobrazují stav „SharePoint nepřipojen“ místo předstírání funkční integrace.

## SharePoint a vzory

Cílový web a testovací knihovna jsou dostupné přihlášenému uživateli. V knihovně `Dejvice TEST` jsou vzory RS, SBK a KS.

Kontrola KS odhalila staré údaje prodávajícího. Opravená verze nyní používá:

- `Rezidence Dejvice 2 s.r.o.`
- IČ `241 06 119`
- vložku `439 174`

Opravený DOCX byl vyrenderován a vizuálně ověřen na všech sedmi stranách. Přímý SharePoint konektor však vrací `403 Access denied` a bezpečné browserové nahrání je blokované systémovým file-pickerem této relace; cílový soubor proto zatím nebyl automaticky přepsán.

Backendová user-assigned identity `id-develocrm-api-pilot` nemá žádný Graph app-role assignment. Správce Microsoft 365 musí:

1. přidělit managed identity aplikační oprávnění Microsoft Graph `Sites.Selected`,
2. udělit této identitě `write` pouze k webu `/sites/DeveloCRM`,
3. dodat do Container App cílovou site/library konfiguraci bez secrets,
4. následně ověřit upload, otevření, verze a generování na testovacím dokumentu.

## Provozní readiness

Security Phase 0 zůstává uzavřená. Health/readiness, Azure probes a alerty jsou aktivní. Finální release musí být proveden koordinovaně v pořadí:

1. push přesného zdrojového commitu,
2. build immutable migration a API image z čistého `git archive`,
3. migration job s obrazem obsahujícím 0044 a 0045,
4. ověření migration jobu a dostupnosti DB,
5. backend deploy přes immutable digest,
6. health/readiness/logy,
7. matching Sites frontend,
8. autentizovaný read-only smoke bez změny pilotních obchodních dat.

## Zbývající rizika

### Neblokuje zahájení interního CRM provozu

- SharePoint upload/generování ještě není aktivní; soubory je nutné do udělení oprávnění spravovat mimo CRM.
- Opravenou KS je nutné ručně nebo po obnovení konektoru uložit do testovací knihovny.
- 3 lint upozornění na `<img>` a velikost frontendového chunku jsou technický dluh, ne provozní blocker.

### Blokuje úplné prohlášení dokumentové části Fáze 1 za hotovou

- chybějící Graph `Sites.Selected` a site-level grant,
- chybějící runtime zapojení SharePoint adapteru,
- neověřený řízený Word generation flow nad schválenými šablonami.

## Finální klasifikace

Po nasazení migrací 0044 a 0045 a matching backend/frontend verze může být hlavní DeveloCRM provoz klasifikován jako **READY WITH LIMITATIONS**. Omezení se týká pouze SharePoint/Word dokumentového toku; hlavní obchodní, smluvní, finanční a provozní workflow je připravené pro interní pilot.
