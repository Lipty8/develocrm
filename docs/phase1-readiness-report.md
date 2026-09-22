# DeveloCRM — Fáze 1 readiness (22. 9. 2026)

## Verdikt

Fáze 1 zatím **není nasazená ani provozně ověřená**. Lokální implementace a regresní testy pokryly základní obchodní cestu i nové interní workflow, ale pilotní Azure backend stále běží na revizi `ca-develocrm-api-pilot--refund-7ac7b88`. Nové migrace 0040–0042 a matching backend/frontend se do pilotu nedostaly. Cílový SharePoint web a tři Word vzory byly 22. 9. dodány, ale backendová identita nemá přidělenou Graph aplikační roli a generování Word není implementováno; dokumentové schopnosti proto nelze prohlásit za hotové. Pilotní obchodní data nebyla při této práci měněna.

## Výchozí stav a doplněné práce

Výchozí commit byl `b69999be52819f4bd1a47754c03e5be37505dea2` (uzavřený refund UX). Již existovaly izolace tenantů, RLS/RBAC, hlavní sales/contract/payment/handovers doménové operace, audit/outbox, správa příslušenství a preview adaptér. Nepřepisoval se model úhrad ani vratek.

| Oblast | Stav pro Fázi 1 | Důvod / otevřený bod |
| --- | --- | --- |
| Dashboard, projekty, jednotky, příslušenství, klienti | Částečně | Existující implementace; nová verze neověřená v publikovaném pilotu. |
| Předrezervace, sales cases, RS, SBK, KS, verze, dodatky, postoupení | Částečně | Doménová cesta otestovaná na izolované DB; celý průchod běžným publikovaným UI ještě neověřen. |
| Platby, vratky | Hotovo v dosavadním pilotu | Refund workflow nebyl v této práci měněn. |
| Dokumenty, SharePoint, generování Word | Chybí pro cílový rozsah | Existuje Graph adapter a metadata model, ale backend jej nepoužívá jako produkční úložiště. Cílový web a vzory jsou dodané; zbývá oprávnění backendové identity, integrace a řízené mapování Word vzorů. |
| Předání | Částečně | Doménová cesta otestovaná; předávací protokol / dokumentace závisí na dokumentové integraci. |
| Klientské změny | Částečně | Přidán řízený stav, odpovědná osoba, poznámky a historie. Přílohy dosud chybí. Fakturace je otevřené business rozhodnutí. |
| Reklamace | Částečně | Přidán jednoduchý řízený workflow s odpovědnou osobou, termínem a historií. Fotografie/přílohy dosud chybí. |
| Úkoly, interní notifikace | Částečně | Přidány pohledy po termínu/dnes/tento týden a kontextové notifikace pro moje úkoly, po splatnosti a blížící se předání; vyžaduje autentizovaný smoke. |
| Uživatelé, role, oprávnění, audit/historie | Částečně | Existující RLS/RBAC a audit mají testy; nové operace mají doménová pravidla, ale nejsou nasazené. |
| Vyhledávání, tabulky, filtry, navigace, session/cache | Částečně | Existující funkcionalita a regresní testy; aktuální matching preview nebylo publikováno. |
| Data Rezidence Dejvice | Neověřeno novým release | Lokální testy používají fixture; reálná pilotní data nebyla měněna ani migrována v této práci. |
| Interní provozní připravenost | Blokováno | Chybí koordinované migrace, backend/frontend release, health/readiness, logy a autentizovaný read-only smoke. |

## Priority

- **P0 před označením Fáze 1 za hotovou:** bezpečně nasadit 0040–0042 a matching release; ověřit běžné UI na izolovaném testovacím obchodě; připravit reálný SharePoint/document tok a schválené Word šablony, pokud jsou generování a přílohy povinné hned od prvního dne.
- **P1 během interního pilotu:** přílohy klientských změn a reklamací, předávací protokol, ověřené interní notifikace, rozšířený UX smoke všech pracovních rolí.
- **P2 / odložit:** GDPR/DSAR, SaaS billing a onboarding, veřejný tenant provisioning, rozsáhlý notification framework (Fáze 2).

## Lokální změny

- `2b7bc32` — izolovaný end-to-end doménový test sales cesty.
- `638e717` — pražské termínové pohledy úkolů a UI klientských změn.
- `a892a29` — migrace 0040, řízené stavy klientských změn s auditní historií.
- `fadba01` — migrace 0041, jednoduchý reklamační workflow.
- `5a2bb95` — migrace 0042, odpovědná osoba a idempotentní poznámky klientské změny.
- `7e0d6ab` — oznámení nezávislá na aktuálním filtru úkolů, včetně blížících se předání.

## Validace

- Čistá lokální PGlite databáze aplikuje migrace včetně 0040–0042; izolované scénáře klientských změn, reklamací a hlavního obchodu prošly.
- Kompletní backendová a frontendová testovací sada prošla; frontend má 124 běžných a 13 interakčních testů. Backend a frontend production build prošly.
- ESLint: 0 chyb, 3 dříve existující upozornění na `<img>`.
- Reálná PostgreSQL migrace, publikovaný Sites build, autentizovaný browser smoke a pilotní datová konzistence **dosud neověřeny**.

## Externí vstupy a business otázka

SharePoint web `https://immobusiness1.sharepoint.com/sites/DeveloCRM` existuje. Odkaz od vlastníka produktu míří do knihovny `Dejvice TEST`; read-only Graph kontrola potvrdila, že v jejím kořeni jsou vzory RS, SBK a KS. Vlastník potvrdil, že vzory jsou schválené a knihovna `Dejvice TEST` je pouze testovací. Lokální DOCX mají běžný obsah, ale žádné Word content controls ani zjevné strojové zástupné značky; při generování je nutné nejdřív vytvořit a ověřit řízené mapování polí bez změny právního textu.

Kontrola vzoru KS odhalila staré údaje prodávajícího (`Rezidence Dejvice s.r.o.`, IČ `056 06 675`, vložka `267218`). Vlastník potvrdil, že jde o chybu; správné údaje podle RS a SBK jsou `Rezidence Dejvice 2 s.r.o.`, IČ `241 06 119`, vložka `439 174`. Byla vytvořena samostatná opravená kopie KS s přesně čtyřmi textovými změnami a vizuálně porovnána s původní sedmistránkovou verzí. Původní OneDrive soubor ani kopie v `Dejvice TEST` zatím nebyly přepsány. Automatické generování KS nesmí použít starou kopii v SharePointu; nejdříve je nutné uložit a schválit opravenou verzi v cílové knihovně.

Pilotní Container App má přiřazenou user-assigned identity `id-develocrm-api-pilot`, ale read-only kontrola jejího Entra service principal vrátila prázdné Graph app-role assignments. Současný účet nemá oprávnění číst site permissions (`accessDenied`), takže site grant nelze potvrdit. Správce Microsoft 365 musí identitě povolit `Sites.Selected` a přidělit jí `write` jen k určenému webu. V Container App zatím není Graph/SharePoint konfigurace. Bez tohoto přístupu nelze ověřit reálný upload, verze ani generování. Secrets nepatří do tohoto reportu.

Lokálně je připraven provider pro Graph token ze spravované identity Azure Container Apps. Používá konkrétní user-assigned client ID, krátkou časovou cache a při chybě selže uzavřeně; nedrží žádný Graph secret. Tři izolované testy tokenového toku prošly. Provider zatím není zapojen do serveru ani nasazen, protože chybí Graph role/site grant, cílová konfigurace a samotná řízená dokumentová operace. Pouhá existence provideru neznamená funkční SharePoint integraci.

Otevřená business otázka: mají se schválené klientské změny ve Fázi 1 pouze evidovat, nebo mají automaticky zakládat platební povinnost? Doporučení: zatím pouze evidence, protože pravidla ceny, schvalování a splatnosti nejsou specifikována; finanční zápis by mohl reálně ovlivnit pilotní účetnictví.

## Deployment

Nic z výše uvedených nových commitů nebylo pushnuto ani nasazeno. Azure read-only kontrola ukázala běžící revizi `ca-develocrm-api-pilot--refund-7ac7b88`; nebyla spuštěna žádná migrace ani změna pilotních obchodních dat. Koordinovaný release vyžaduje nejdříve audit SQL migrací na PostgreSQL, následně migration job, matching backend a matching Sites frontend, pak health/readiness/logy a autentizovaný read-only smoke. Nelze bezpečně nasadit jen frontend.
