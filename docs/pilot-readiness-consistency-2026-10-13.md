# Pilot Readiness & Data Consistency Guardrails

Stav: implementace a živý read-only audit ověřeny; nový release ještě není nasazený. Referenční nasazený frontend je 2b69434 / Sites 128, backend evidence-7343678, DB 0057.

## Živý audit – 13. 10. 2026

Audit pokryl všech 5 projektů workspace včetně archivovaných projektů a historických smluvních verzí. Běžel explicitně READ ONLY, bez oprav obchodních dat. Runtime ověření použilo stávající user-assigned managed identity a Graph/SharePoint adapter, bez nových secrets nebo oprávnění.

- DB audit: `caj-develocrm-migrations-pilot-jj5omjs`.
- Ověření historického stáří: `caj-develocrm-migrations-pilot-icdyq3s`.
- Runtime fyzická kontrola: `job-develocrm-hold-expiry-u1lu231`.
- Další konektivita: `job-develocrm-hold-expiry-14irjcs`, potvrzeno v Log Analytics: `graphLeastPrivilege=true`, `rootRead=true`, `physicalEvidence=verified`.
- Fyzický audit run ID: `0e940b54-083e-4197-b28d-951cc5d3e663`.
- Výsledek: **0 kritických nálezů, 8 historických evidenčních výjimek, 1 upozornění**.
- Přesné SharePoint verze dostupných podepsaných dokumentů a všech schválených šablon byly načteny a jejich SHA-256 ověřeny. Nedoložených 8 verzí není označeno jako ověřené.
- Žádné další nálezy: rozporná RS rezervace, aktivní hold u volné jednotky, rezervovaná jednotka bez účinné smlouvy, vícenásobné aktivní holdy, aktivní expirovaná předrezervace, zastaralá předrezervační etapa, duplicitně označená počáteční cena, neshoda dokumentového kontextu, neshoda generation/contract snapshotu ani centrálních cenových projekcí.

### Historické výjimky

| Projekt | Smlouva | Verze | Současný stav smlouvy | Chybí |
|---|---|---:|---|---|
| Dejvice | DEJ-314-RS | 1 | Podepsaná | Přesný podepsaný dokument |
| Dejvice | SBK 311 | 1 | Podepsaná | Přesný podepsaný dokument |
| Dejvice | RS 101 | 1 | Zrušená | Historický podepsaný dokument |
| Dejvice | RS 205 | 1 | Zrušená | Historický podepsaný dokument |
| Dejvice | RS 311 | 1 | Zrušená | Historický podepsaný dokument |
| Dejvice | RS 417 | 1 | Ukončená | Historický podepsaný dokument |
| Dejvice | SBK 417 | 1 | Ukončená | Historický podepsaný dokument |
| SAFE56 | RS TECH-RS56 | 1 | Podepsaná | Technická historická evidence |

Všech osm verzí i jejich podpisů prokazatelně předchází nasazení 0057 (13. 10. 2026 12:24 Europe/Prague). Předchozí audit aktuálních podepsaných smluv našel pouze 3; rozšířená kontrola všech verzí navíc odhalila 5 dříve zrušených/ukončených smluv. Nejde o pět nových podpisů bez dokumentu.

Upozornění: SAFE56 / TECH-EXP56 nemá cenu ani cenovou historii. Jde o původní technický expirační test, nikoli známou chybu ceny skutečné jednotky. Cena nebyla vymyšlena ani doplněna.

## Checker a evidence stavy

`GET /v1/admin/consistency?physical=true` (volitelně `projectId=<UUID>`) je opakovatelná interní backendová operace, nikoli obchodní CTA. Vyžaduje aktivní membership stejného uživatele a `system.manage`, dále pro kontrolované projekty `unit.read`, `contract.read`, `documents.read`, `price.read`. Globální administrátor nemá automatický business bypass. Nepovolený konkrétní projekt je odmítnut; neúplné globální pokrytí nikdy nevytvoří úspěšnou release gate.

Checker používá jednu REPEATABLE READ / READ ONLY transakci pro DB snapshot, 30s SQL timeout a pouze read Graph operace pro přesné native versions. Vrací severity, invariant code, tenant/project, entity ID a bezpečný popis, run/correlation ID. Nevrací tokeny, Graph item/drive keys, souborové cesty, generation snapshoty ani osobní údaje klientů. Běhy jsou dohledatelné ve strukturovaném aplikačním logu; checker nezapisuje do business auditu/outboxu a nevytváří žádnou opravu.

Schválený legacy manifest v checkeru obsahuje přesná tenant/project/contract/version ID a původní datum podpisu. Je versionovaný ve zdrojovém kódu; nelze ho měnit requestem ani automaticky přidávat výjimky. Jiná verze, tenant, projekt, smlouva nebo datum znamená critical. Doplnění výjimek vyžaduje nový explicitní read-only audit a review změny.

Commercial DTO používá stejnou klasifikaci a vrací `documented / legacy_missing / invalid / pending`. Detail smlouvy rozlišuje historický podpis čekající na doložení od nedoloženého nekonzistentního podpisu. Samotný metadata stav documented není náhradou živého ověření souboru; otevření a evidence podpisu stále používají původní server-side exact-file validation.

## Release gate

Operator CLI `node backend/dist/diagnostics/run-readiness.js` používá stejné DB/RBAC a Graph vrstvy. Není to nový scheduler ani CI systém. Připojí se pouze ke knihovnám uloženým v tenantové konfiguraci.

Požadované proměnné (identifikátory, ne nové secrets): `READINESS_TENANT_ID`, `READINESS_USER_ID`, `READINESS_MEMBERSHIP_ID`, `READINESS_API_ORIGIN`, stávající `DATABASE_URL` a `SHAREPOINT_MANAGED_IDENTITY_CLIENT_ID`. `READINESS_FRONTEND_SMOKE_VERIFIED=true` je explicitní operator attestation až po autentizovaném matching UI smoke testu; default je false. CLI samo nesmí tvrdit, že browser UI otestovalo.

Gate ověřuje:

1. Kompletní seznam migrací a nezměněné checksums proti SQL souborům release image.
2. `/health` a `/ready` = 200.
3. Graph token z Azure MI obsahuje Sites.Selected, správné client/tenant ID a nikoli široké Sites.*.All / Files.*.All. Claims slouží pouze jako diagnostika oprávnění, nikoli jako náhrada Graph autorizace.
4. Read-only site → drive ownership → root listing skutečně projde.
5. Účinná approved RS šablona existuje; její skutečný zdroj je fyzicky ověřen checkerem. Technická šablona dokládá engine, nikoli právní schválení pro skutečný projekt.
6. Checker má úplné pokrytí, fyzickou kontrolu a žádný critical nález.
7. Explicitně doložený matching frontend smoke.

Při neúspěchu exit 1 a strukturované blockers. Legacy je samostatný počet, nikdy OK evidence. Warning neblokuje obecný release; konkrétní jednotka bez ceny se stále zastaví na původní RS readiness validaci.

Migrace 0058 zpřístupňuje read-only deployment metadata `schema_migrations` runtime roli a přidává označení algoritmu generation snapshot hash (`legacy-json` / `canonical-json-v1`) s immutable guardem. Nevytváří nový contract/document model. API image přibalí SQL manifest pro checksum gate.

Původní serializer hashoval JSON.stringify před uložením do JSONB; pořadí klíčů se v PostgreSQL nezachová. Proto jeho checksum nelze obecně nezávisle přepočítat. Nové generování používá jednu sdílenou funkci s jednoznačně seřazenými klíči; checker detekuje změnu hodnoty jako critical. Staré hash bytes ani snapshoty se nepřepočítávají, zůstávají explicitně `legacy-json` a checker upozorňuje na omezenou nezávislou ověřitelnost pouze u operací prokazatelně vytvořených před 0058. Nová legacy-json operace po 0058 je critical, nikoli automatická výjimka. Jejich konkrétní podepsané soubory a shodu generation/contract payloadu lze nadále ověřit. Živý výše uvedený audit 0/8/1 před touto migrací kontroloval původních 16 invariantů; nový warning na historický hash bude zahrnut po nasazení 0058.

Samostatný read-only inventory `caj-develocrm-migrations-pilot-uuetsoj` identifikoval 5 původních generation snapshotů: DEJ 2, RSTEST 2, TECH57 1. Po 0058 tedy očekáváme dalších 5 explicitních checksum warnings (celkem 6 warnings včetně TECH-EXP56), nikoli přepsání historických hashů nebo nové critical nálezy. Finální runtime gate musí tento očekávaný výsledek znovu ověřit.

## Budoucí ruční doložení historického dokumentu – neaktivováno

Navržený tok: najít skutečný podepsaný soubor → standardní upload → exact native document version a hash → explicitně auditovaná evidence původní contract version.

Současné signed-version triggery správně zakazují jakoukoli výměnu podepsané verze. Proto nebyla přidána obecná backdoor mutace ani vypnuty guardy. Před aktivací dedikované operace musí být transakčně prověřeno:

- `system.manage` + projektové `contract.manage` a `documents.upload`;
- přesná reviewed legacy fingerprint a stejný tenant/project/contract/unit/sales case;
- skutečný externí originál, nikoli dnešní generovaná náhrada;
- dokončený upload, exact native version, ověřený SHA-256;
- zachování původního signed_at a všech podpisů;
- nový audit kdo/kdy dokument doložil, run/correlation ID, document version;
- unit-first lock pořadí a idempotence (stejná vazba replay, jiný dokument konflikt).

`historical-evidence-policy.ts` a jeho testy jsou pouze návrhová validace, nejsou registrované jako mutační endpoint. Není vytvořená nová paralelní evidence tabulka. Otevřeným rozhodnutím před aktivací je postup potvrzení, že nahraný externí soubor je opravdu historický podepsaný originál; kryptografický hash sám to nedokazuje.

## Opakovatelný technický E2E

Stávající `smoke-price-document-integrity` zůstává explicitní TECH-only scénářem, nikoli startup hookem. `prepare` zakládá/připravuje TECH57 idempotentně; `verify` ověřuje i replay podpisu; nový `inspect` provádí pouze čtení existujících podepsaných případů. Potom se spustí checker s fyzickou kontrolou a autentizovaný browser reload technické jednotky/smlouvy.

Regresní DB test skutečně projde vytvořením jednotky/ceny, předrezervací, generováním, regenerací, exact evidence, schválením, podpisem a rezervací, a následně spustí produkční SQL checker. Počet auditů/outbox/document versions se kontrolou nezmění. Při stejných UUID napříč cizím tenantem se pilotní legacy manifest nepoužije.

Aktuální živý test v tomto balíku znovu ověřil existující TECH57 generovaný i externí podpis přes exact SharePoint bytes a konzistentní rezervaci. Nový browser smoke po publikaci tohoto release zůstává deployment krokem. Podepsané technické případy nebyly archivovány, protože to bez ukončení jejich obchodu není bezpečný úklid; zůstávají jasně označené jako TECH.

Read-only inspect execution `job-develocrm-hold-expiry-ytq4fm7` = ok=true pro oba případy, 1 cenový záznam, 5 000 000 Kč, signed + konkrétní document_version, bez unresolved placeholders. Tento běh neopakoval podpis ani negeneroval novou smlouvu.

## Ověření implementace

- Kompletní finální backend suite: 274 testů, 273 pass, 0 fail, 1 volitelný PostgreSQL skip. Cílená guardrails sada: 16/16.
- Frontend source tests: 142/142.
- Interaction tests: 36/36 (včetně legacy vs invalid dokumentové evidence).
- Lint, backend production build a frontend production build prošly. Stávající upozornění na velikost bundle není nová chyba.
- Podpisový/generated/external DB E2E a produkční SQL checker jsou ověřeny v integrační sadě.
- Nový runtime endpoint/gate po deploymentu a vizuální smoke matching UI zatím nejsou ověřeny. Nezaměňovat přípravu releasu za publikaci.

## Verdikt a zbývající kroky

Živý audit neodhalil nový technický invariant blokující nové RS. To není tvrzení, že historické smlouvy jsou compliant nebo že skutečná právní šablona je schválena.

Tento guardrails release zatím není uzavřen jako DEPLOYED: zbývá matching backend/0058/frontend publikace, runtime release gate a autentizovaný read-only UI smoke. Před jejich dokončením nelze vyhlásit finální technické uzavření tohoto balíku. Po jejich úspěchu zastavit další vývoj RS engine a přejít k právnímu schválení skutečné šablony a řízenému uživatelskému pilotu.
