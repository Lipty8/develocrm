# DeveloCRM — Fáze 1 readiness (aktualizace 3. 10. 2026)

## Verdikt před finálním release

Aktuální hlavní CRM provoz je **READY WITH LIMITATIONS**. V lokálně ověřené verzi není známý P0 blocker hlavního CRM provozu. Obchodní proces, alternativní smluvní cesty, platby a vratky, předání, příslušenství, klientské změny, reklamace, úkoly, oprávnění, audit a nové vazby dokumentů mají automatizované pokrytí. Migrace 0044 a 0045 byly v pilotu nasazené v release `03442e0`; aktuální backend byl následně bezpečnostně aktualizován na commit `b5dc850` a matching frontend je publikovaný v Sites verzi 114.

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
| Dokumentová metadata a vazby | Nasazeno | Dokumenty lze navázat na klientskou změnu, reklamaci a předání; migrace 0044 je součástí pilotního release `03442e0`. |
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
- `03442e0` — migrace 0045, centrální projekce aktuálního kupujícího a manažerského stavu jednotky a jednotná invalidace UI po mutaci; matching backend nasazený v pilotu.
- `73f876b` — bezpečný přechod na interaktivní Entra přihlášení po timeoutu tichého obnovení tokenu místo zobrazení technické MSAL chyby.
- `f9ef591` — kompatibilní opravy produkčních závislostí Next.js, Fastify, `fflate` a dotčených tranzitivních balíčků.
- `b5dc850` — aktualizovaný dependency audit a SBOM; produkční audit má 0 známých zranitelností.

## Migrace

- Pilotní matching release `03442e0` používá migrace do 0045. Odpovídající migrační obraz `phase1-03442e0` s digestem `sha256:fc80db6770242be83e5c9b0eb42f0d316b20dd0677ebe1f596d5b05cbe555fa0` doběhl 23. 9. 2026 se stavem `Succeeded`.
- Aditivní migrace `0044_phase1_document_workflow_links.sql` a `0045_unit_business_projection.sql` jsou součástí tohoto obrazu.
- 0044 vytváří tři vazební tabulky, projektově bezpečné cizí klíče, RLS/FORCE RLS, audit, outbox a idempotentní příkazy.
- 0045 zavádí jedinou čtecí projekci pro aktuální kupující a KPI `Volný / V jednání / Prodaný`. Prodaná je podepsaná RS s plně uhrazeným rezervačním poplatkem, přímo podepsaná SBK/KS nebo předaná jednotka; zrušené a historické případy se nezapočítají.
- Migrace nemažou ani nepřepisují existující obchodní data.

## Validace finálního zdrojového stavu

- Backend: **187/187 testů prošlo**.
- Frontend statické/regresní testy: **128/128 prošlo**.
- Interaction testy: **26/26 prošlo**, včetně úspěšné i odmítnuté mutace bez browser reloadu.
- ESLint: **0 chyb a 0 upozornění**.
- Backend production build: **prošel**.
- Frontend production build: **prošel**; zůstává pouze neblokující upozornění na velikost chunku.
- Produkční dependency audit: **0 známých zranitelností** po bezpečnostním upgradu Next.js, Fastify, `fflate` a dotčených tranzitivních balíčků.
- Čistá PGlite databáze aplikuje migrace do 0045.
- Integračně jsou pokryté alternativní smluvní cesty, dokumentové vazby, audit, outbox, idempotence a 11 stavů centrální business projekce.
- Úspěšné POST/PATCH/DELETE požadavky vyvolají jednu sdílenou invalidaci katalogu, klientů, smluv, dokumentů, plateb, předání a úkolů; dotčené obrazovky se obnoví bez ručního reloadu.

## Read-only kontrola pilotu

- Aktivní backend revize: `ca-develocrm-api-pilot--secdeps-b5dc850`.
- Aktivní backend image: `develocrm-api@sha256:8853228f218d1ea21b45e9fe8bb20f90a8f0398b12bcebdbb8bf739ca1c7802b`.
- Revize je Healthy a provisioning je Succeeded.
- `/health` vrací 200.
- `/ready` vrací 200 a databáze je dostupná.
- Publikovaný Sites frontend je verze 114, deployment `appgdep_6ac1473566e08191bc6a282ae5a7bb25`, zdrojový commit `762bfa712afc7899637c76773c6e705e55e694df`; deployment je `succeeded`.
- Autentizovaný smoke na Sites verzi 114 potvrdil přihlášení uživatele Adam Lipták, správný workspace a načtení dashboardu, projektů, Rezidence Dejvice, jednotek, klientů, smluv, plateb, předání, úkolů a dokumentů.
- Rezidence Dejvice má 19 jednotek; read-only UI k 3. 10. 2026 ukazuje 13 volných, 4 `V jednání` a 2 prodané. Tento stav nebyl automaticky opravován ani reinterpretován.
- Kontrola backendových logů po smoke testu neodhalila 5xx, RLS, startup ani error-level chyby; `/health` a `/ready` zůstaly 200. Sites logy obsahují pouze zrušené read-only GET požadavky při navigaci mezi obrazovkami a browser console je bez warning/error záznamů.
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

### Ověřený stav oprávnění k 1. 10. 2026

- managed identity client ID: `134a9cd1-c2d7-4386-b47c-c59260ad460c`,
- managed identity principal ID: `9162ffdb-2581-4f0c-95e5-c04dcc592199`,
- Microsoft Graph service principal: `9ce57c61-224a-41ab-a6d1-bcabb64bd193`,
- Graph role `Sites.Selected`: `883ea226-0bf2-4a8f-9f9d-92c9162a727d`,
- cílový site ID: `immobusiness1.sharepoint.com,5d133266-b0bc-4614-ab56-45ec53bc3821,815da7c9-ff7a-4dca-ad04-b6f9629186bc`,
- knihovna `Dejvice TEST`: `b!ZjITXbywFEarVkXsU7w4IcmnXYF6_8pNrQS2-WKRhrxKidhU_mTfRaBqO75Z5o7S`.

Pokus o přidělení `Sites.Selected` z aktuálního účtu skončil bezpečně chybou Microsoft Graph `Authorization_RequestDenied / Insufficient privileges`; žádné oprávnění nebylo změněno. Změnu musí provést Entra/Microsoft 365 správce s oprávněním spravovat aplikační role. Po app-role assignmentu musí SharePoint správce udělit této identitě pouze roli `write` k výše uvedenému webu. Globální `Sites.ReadWrite.All` není pro tento scénář přijatelné.

### Bezpečný základ Word generování

Commit `524d885` přidává striktní DOCX renderer pro explicitní pole. Renderer:

- nahrazuje pouze schválené tokeny `{{field.name}}` v těle, hlavičkách a patičkách,
- zvládá token rozdělený mezi více Word runs,
- odmítne chybějící hodnotu, neschválený token, chybějící povinné pole i zbylý token,
- odmítne staré ruční značky `[•]`, `[●]`, `[doplnit]` a `[vyplnit]`,
- nemění vztahy, ID ani jiné technické části DOCX archivu.

Všechny tři dodané vzory byly tímto guardem ověřeny read-only. RS a SBK neobsahují explicitní tokeny; KS navíc obsahuje ruční značky `[•]`/`[●]`. Generování proto správně zůstává fail-closed a zatím není vystavené přes API ani UI. Před aktivací je nutné právně schválené šablony jednorázově parametrizovat a určit mapování jejich povinných polí; nelze bezpečně odhadnout význam tečkovaných míst pouze z formátování dokumentu.

## Provozní readiness

Security Phase 0 zůstává uzavřená. Health/readiness, Azure probes a alerty jsou aktivní. Další release musí být proveden koordinovaně v pořadí:

1. push přesného zdrojového commitu,
2. build immutable migration a API image z čistého `git archive`,
3. migration job pouze pokud nový release obsahuje další migraci; 0044 a 0045 už jsou v pilotu,
4. ověření migration jobu a dostupnosti DB,
5. backend deploy přes immutable digest,
6. health/readiness/logy,
7. matching Sites frontend,
8. autentizovaný read-only smoke bez změny pilotních obchodních dat.

## Zbývající rizika

### Neblokuje zahájení interního CRM provozu

- SharePoint upload/generování ještě není aktivní; soubory je nutné do udělení oprávnění spravovat mimo CRM.
- Opravenou KS je nutné ručně nebo po obnovení konektoru uložit do testovací knihovny.
- Velikost frontendového chunku zůstává technický dluh, ne provozní blocker.

### Blokuje úplné prohlášení dokumentové části Fáze 1 za hotovou

- chybějící Graph `Sites.Selected` a site-level grant,
- chybějící runtime zapojení SharePoint adapteru,
- neověřený řízený Word generation flow nad schválenými šablonami.

## Finální klasifikace

Hlavní DeveloCRM provoz je po nasazení migrací 0044 a 0045, backendové revize `secdeps-b5dc850` a Sites verze 114 klasifikovaný jako **READY WITH LIMITATIONS**. Omezení se týká SharePoint/Word dokumentového toku; hlavní obchodní, smluvní, finanční a provozní workflow je připravené pro interní pilot. Striktní DOCX guard zatím není runtime funkcí a nevyžaduje databázovou migraci; Sites UI už omezení generování zobrazuje pravdivě.
