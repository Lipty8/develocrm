# DeveloCRM Production Readiness Sprint

## Cíl a bezpečnostní hranice

Dokončit existující obchodní řetězec a technické generování skutečných RS/SBK. Tento dokument je průběžná evidence, ne prohlášení produkční připravenosti. Právní šablony se bez obsahového schválení neaktivují. Reálná pilotní data, jednotka 417 a historické dokumenty se nemění.

## Nezávisle ověřený výchozí stav

- Git HEAD na začátku: `f6ed01f74e8bda5f5ea4bc533911d5af5d7f1425`.
- Pracovní strom obsahoval pět starších nesouvisejících untracked souborů; nejsou součástí sprintových commitů.
- Azure API: `ca-develocrm-api-pilot--rs-client-c088258`, Running.
- API image: `sha256:a0e75952e8be29b27aa9fde49c5ef5f22be4148a95bca692a0b9570455d6871d`.
- Sites tool potvrdil verzi 144; výchozí Sites source commit `245d034c92cf079da35e60bd6bc9476c60d29db2`.
- `/health` = 200. Autentizovaný browser načetl Adama Liptáka a technickou jednotku TECH62-DRAFT: volná jednotka, zrušená RS a zachovaný návrh SBK.
- Číslo poslední migrace podle repozitáře je 0062; samotný tento údaj není nové ověření `schema_migrations` v pilotní DB.

## Stručný gap report

| Oblast | Co funguje / je propojené | Zbývající mezera |
| --- | --- | --- |
| Ukončení RS + draft SBK | 0062, centrální posouzení, zámky, audit, uzavření případu, zákaz podpisu v uzavřeném případu | Konzervativní ochrana ostatních nepodepsaných workflow stavů musí být explicitně odlišena od prostého draftu. Žádný backfill historie |
| Dokumentové verze | Přesná document version, hash, SharePoint native version, generation snapshot, idempotentní upload | Nové právní scalar profily nebyly připojené ke správě šablon |
| RS generování | Serverový kontext, readiness, verzování, předání stávající generovací službě a vazba na contract version | Dosavadní mapper skládá celé odstavce a nesmí obsluhovat nové originálové schema |
| SBK generování | Typ smlouvy a dokumentu i společná infrastruktura existují | Chybí business mapper/readiness, platební důkazy a ucelené UI napojení |
| Příslušenství | Inventář a cenové snapshoty | Kompletní právní varianta nepokrývá automaticky jinou kombinaci, více parkingů ani firmu/více osob. Readiness musí blokovat, ne vymýšlet text |
| Splatnosti | Podpisová evidence a finanční transakce | Současné založení RS vyžaduje explicitní splatnost před podpisem. Nová 3-pracovní-dny politika vyžaduje koordinovanou změnu modelu, nikoli fiktivní datum |
| SBK platby | Obligations / transactions / allocations / refunds | Rozlišit skutečně zaplacený poplatek od předpisu, 20 % a 80 % minus zaplacený poplatek; nepoužít datum vytvoření místo doručení výzvy |
| Právní obsah | Dva originály připnuté SHA-256, přesné review sloty, vizuální kontroly a testy | Celé nové parametrizované verze nejsou finálně schválené; přílohy jsou v originálech uvedené, ale nejsou součástí dodaných Wordů |

Datum narození namísto RČ je zaznamenaná obsahová změna proti originálům, nikoli přehlédnutý rozdíl. Adam ji výslovně schválil pro RS a 17. 10. i pro SBK; tím není schválena celá nová parametrizovaná smlouva. Kompletní první varianta příslušenství je rovněž potvrzená, automatické vypouštění klauzulí nikoli.

Přesný seznam změn po odstavcích a hashe jsou v `backend/templates/review/*-review-manifest.json`. Původní DOCX se nepřepisují.

## Balík 1 Bezpečné připojení review profilů

Implementace:

- Opravena skutečná chyba: upload ignoroval `validation.valid=false` a ukládal i šablony s neznámými/chybějícími poli. Kontrola nyní blokuje upload před SharePointem; opakuje se nad přečtenou neměnnou SharePoint verzí před registrací šablony.
- Náhled nyní kontroluje přesný připnutý hash. Změněný soubor se nepovažuje za původní verzi jen proto, že má stejná pole.
- Stávající katalog rozšířen o explicitní variantu `dejvice-original-dob-full-v1`: RS 32 a SBK 37 scalar polí. Starý RS default se nesmí tiše přeinterpretovat.
- Existující upload/validate/preview umí tyto profily. Jsou **review-only**, dokud nebude připravený autorizovaný business mapper. Nelze je schválit ani obejít přes obecný generation endpoint.
- Přímá registrace kontroluje typ/variant/schema a nesmí změnit význam existujícího template code při konfliktu.
- Ve stávajícím formuláři šablon je SBK a lidsky popsaná volba varianty. U review-only verze se nezobrazuje aktivace; archivace zůstává dostupná podle stávajícího oprávnění.
- Nepřidána žádná tabulka, migrace, úložiště nebo nový generátor. Žádné Graph oprávnění se nemění.

Ověření před nasazením:

- Backend 315 passed / 0 failed / 2 optional native PG skipped v obecné sadě.
- Samostatná skutečná PostgreSQL/PGlite workflow sada 43 passed / 0 skipped, včetně obou pořadí souběhu expirace/podpisu, ukončení RS vs draft advancement a dvou rezervací.
- Frontend 143 passed; interactions 62 passed.
- Frontend TypeScript, backend build, lint a produkční frontend build prošly. Existující upozornění na velikost frontendového chunku zůstává, nepředstírá se jeho vyřešení.
- Cílená sada template/generation/RS/review 49 passed.

Nasazení balíku 1:

- GitHub commit `e16029a033cc09f320183c533a66022f142f84ca`.
- ACR build `cg3v`, API digest `sha256:a132370dd11d273920f4ec8cb6b851d846292767d28eb21e3a04ba54d63ed01a`.
- Backend `ca-develocrm-api-pilot--tplreview-e16029a`: Healthy / Running; `/health` a `/ready` 200.
- Sites 145, source commit `a79a0edc02d0fba2482f51e1b722d70370f96016`, shodný zdrojový strom `f60da91ea1769aa23cab5cd7c640001a784a25f3` s GitHubem.
- Autentizovaný browser upload skutečného nového SBK scalar profilu prošel do technického projektu TECH SMOKE 0062. Šablona `TECH65 REVIEW SBK – NEAKTIVOVAT`, verze `tech65-e16029a`, zůstává Koncept, 37 polí, bez akce Schválit. SharePoint odkaz a připnutý readback hash jsou zobrazené. Nová právní šablona nebyla aktivována.
- Žádná migrace ani změna reálného obchodu.

## Balík 2 Zachování projektového kontextu správy šablon

Skutečný browser test odhalil dvě UX chyby: modal při rychlém přepnutí filtru přebíral první šablonu z předchozího projektu; úspěšný upload pak globální invalidací remountoval pracovní prostor a ztratil projektový filtr. Před testovacím uploadem byl projekt ručně opraven, takže žádná šablona nevznikla v reálném projektu.

- Sdílený výběr kontextu respektuje explicitní projekt, typ a vybranou šablonu; staré odpovědi jiného projektu se nepoužijí jako předvyplnění.
- Upload a lifecycle akce používají cílené obnovení existujícího seznamu, nikoli globální remount. Backend a autorizace se nemění.
- Přidáno 6 regresních testů (5 kontextů a skutečná repository cesta bez globální invalidace). Celkem 68 interaction testů prošlo; TypeScript, lint a produkční frontend build prošly.

Nasazení a skutečný E2E:

- GitHub `fddd210`; Sites 146, source `6a9e5d061ca30758623e8088822e2935d80ae414`, shodný tree `8b67f0e9c59c6af93c1c7b44930dee2efb5ffdb7`; publikace `appgdep_6ad3ebb739c48191a7bf6be0057d5594` succeeded. Backend zůstává matching `tplreview-e16029a`, bez migrace.
- Adam, skutečné přihlášení: rychlé přepnutí projektu TECH SMOKE 0062 → otevření uploadu předvyplní právě tento projekt, nikoli předchozí Rezidenci Dejvice.
- Skutečný upload RS `tech65-fddd210` prošel; modal se zavřel, vybraná šablona a projektový filtr zůstaly. RS 32 polí, SBK 37 polí. Obě verze byly znovu validovány proti připnutému SharePoint souboru a zůstaly bez možnosti aktivace.
- Reload znovu načetl obě validované verze. Persistence ověřena, nikoli pouze lokální preview. Filtr samotný se při plném reloadu vrací na výchozí stav; oprava garantuje zachování kontextu během mutace, ne novou persistenci filtrů.
- Browser stáhl oba náhledy přes skutečný backend, který načetl přesnou SharePoint verzi. Reprodukovatelná read-only kontrola `backend/scripts/verify-runtime-contract-preview.ts` porovnala všech 148 odstavců RS a 261 SBK s očekávaným renderem lokálního připnutého originálu: shoda všech odstavců, nula unresolved polí. Skript loguje pouze hashe/počty, nikoli právní nebo osobní text.
- Stažená RS SHA-256 `61512ff7a08fa067c6ca1505e9011e1a35f039f7fab57acab745da2faf28c8d6`; SBK `0abbfb9a499b8622d9cd19169823c80c09150ffe33110a21740aab7a04c2cf63`.
- Bundled renderer se při přímém čtení macOS Downloads zasekl; byly ukončeny jen naše dvě headless konverze. Po přesunu beze změny bajtů do pracovního temp adresáře úspěšný render 4 stran RS a 11 stran SBK. Každá stránka vizuálně zkontrolována: bez clippingu/překryvu. Nejedná se o potvrzení spuštění v desktopovém Microsoft Wordu ani obsahové právní schválení.
- Runtime náhledy jsou `outputs/contract-review/rs-runtime-preview-2026-10-17.docx` a `sbk-runtime-preview-2026-10-17.docx`. Jsou syntetické, nejsou skutečnou smlouvou a nesmějí se podepsat.
- Tail 30 řádků backend logu po smoke: žádné 5xx nebo RLS chyby, readiness/health 200. To není tvrzení o kompletním monitorovacím okně. Zároveň zachycen GET clients přibližně 9 sekund; zůstává výkonový bod backlogu.

Tyto balíky samy nedokončují RS/SBK business generování ani platební kalendář.

## Balík 3 Přesný návrh platebního kalendáře

Připravený čistý serverový výpočet pro novou originálovou variantu, **zatím nezapojený do runtime předpisů nebo podpisové operace**. Není to nový finanční systém ani tvrzení o dokončené platební integraci.

- Český pracovní kalendář používá kalendářní data, víkendy, pevné svátky a Velký pátek/Velikonoční pondělí. Ověřen proti § 1–3 zákona 245/2000 na MPSV dne 17. 10. 2026: https://ppropo.mpsv.cz/zakon_245_2000. Výslovně omezen na roky 2016–2099, aby nepřepisoval staré svátkové režimy.
- Skutečný zónovaný podpis se převede na český smluvní den; plánované datum ani systémové dnes nejsou náhradou. RS 3 pracovní dny, SBK první splátka 5 pracovních dnů; počítání až od následujícího dne.
- Před podpisem vrací návrh `awaiting_signature` a `dueOn:null`. U doplatku SBK `awaiting_delivery`, dokud není doloženo doručení výzvy. Žádné vymyšlené datum ani zápis do DB.
- SBK počítá 20 % a zbývající cenu minus skutečně zaplacený RS poplatek přesnými celými haléři. Nedostatečná úhrada, nesoulad částky nebo záporný doplatek jsou blokující nesrovnalost. To nemění obecné pravidlo, že evidence podpisu existujícího externího dokumentu není blokovaná platbou.
- Doplatek má v návrhu 30 kalendářních dnů od doručení podle doslovného textu. Případné právní posunutí konce lhůty na pracovní den není automaticky domyšlené; musí zůstat předmětem kontroly nové parametrizované varianty před aktivací.
- Další krok: atomické navázání na existující `payment_obligations` a podpisové důkazy. Současný `due_at NOT NULL` a create-contract explicitní datum se nesmějí obejít fiktivní splatností. Historické předpisy beze změny.
- Celá backend sada po přidání výpočtu: 337 passed, 0 failed, 2 optional native PG skipped. Zahrnuje ověření haléřových výpočtů proti skutečné PostgreSQL `numeric` aritmetice v PGlite. Samostatná nativní concurrency sada byla ověřena u balíku 1; čistý výpočet nezměnil DB zámky ani workflow.

## Balík 4 Veřejné chyby bez interních kódů

Negativní skutečný browser test nahrál SBK soubor pod RS profilem v technickém projektu. Backend jej správně odmítl (`422`, correlation `req-9j`), ale UI ukázalo `invalid_template_fields` přilepené k české větě. Příčina nebyla formulář: centrální `mapApiError` spojoval message/error/detail/code do jednoho veřejného řetězce. Při opakovaném průchodu handlerem a preSerialization navíc mohl zdvojit text.

- Klasifikace nadále vidí diagnostický kontext; veřejná hláška vybírá právě jedno pole message/error. Interní detail/code se do microcopy nespojuje. SQL redakce, correlation ID, RBAC a stavové kódy zůstávají zachované.
- Přidáno 6 regresních testů včetně opakovaného mapování, doménové blokace historické smlouvy a zákazu úniku SQL detailu.
- Celá backend sada: 343 passed, 0 failed, 2 optional native PG skipped; backend build a cílený lint prošly. Nasazení tohoto malého backend balíku bude zaznamenáno po ověření.

Ověření dokončené 18. 10. 2026 místního času:

- Commit `162abf562db74c5ca1f27d5f2482f1a0bfae2d73`, GitHub main potvrzen přes remote ref.
- ACR `cg3w` Succeeded; očištěný context 388.641 KiB, bez právních DOCX, .env nebo lokálních tajemství. Image `develocrm-api:publicerror-162abf5`, digest `sha256:464709644f6a2e5c3d92b306ddde41da4f8ad050a6c0b419d76e1d294334fd85`.
- Backend `ca-develocrm-api-pilot--publicerror-162abf5`, Healthy/Running, 1 replika, latestReadyRevision a 100 % traffic potvrzeny. `/health` a `/ready` 200. Bez migrace.
- Frontend zůstává Sites 146: tento poslední balík nemění frontend ani API kontrakt. Kompatibilita ověřena stejným přihlášeným browserem; žádná změna sdílení.
- Opakovaný stejný negativní upload: `POST /v1/document-templates/upload` HTTP 422. UI zobrazuje pouze českou hlášku a `(req-j)`; interní `invalid_template_fields` je pouze v diagnostickém logu nové revize se stejným correlation ID. Verze `tech65-invalid-schema` nevznikla; validované návrhy zůstaly.
- Nativní lokální PostgreSQL/PGlite workflow sada znovu spuštěna: 43 passed, 0 skipped. Včetně ukončení RS + draft SBK, obou pořadí souběhu podpis/expirace a podpis/cancel, dvou rezervací a ochrany historického případu.
- Typecheck, backend build, relevantní lint a frontend production build znovu úspěšné. Finanční výpočet je v obrazu jako nezapojený modul, žádná runtime platební politika se tím nezapnula.

Průběžný verdikt: správa nových neaktivních originálových profilů a jejich skutečná SharePoint persistence/náhled jsou ověřené. Celkový sprint a produkční RS/SBK zůstávají **nedokončené**: zejména autorizované scalar business mapování, doplnění doménových údajů, atomická vazba podpisu na splatnosti, SBK workflow, přílohy a obsahové schválení. Tento checkpoint nepředstírá jejich dokončení.

## Balík 5 Doplnění autoritativních údajů prodávajícího

- Aditivní migrace 0063 rozšiřuje existující `project_contract_settings` o jméno/funkci u podpisu, účet klientských změn a doručovací adresu. Žádná nová tabulka a žádný backfill hodnot. Stávající FORCE RLS se zachovává.
- Stejný existující projektový formulář a repository ukládají tyto hodnoty pod projektovým `contract.manage`, transakčně s úpravou projektu, auditem a outboxem. Starší klient při vynechání nových polí jejich uložené hodnoty zachová; explicitní prázdný řetězec je dovolí vymazat. Potřebnost hodnoty rozhodne až konkrétní template readiness.
- Stávající RS source DTO čte nové údaje z projektového nastavení a doručovací adresu kupujícího z existujícího `party_addresses` typu `correspondence`. Žádný automatický fallback doručovací adresy na bydliště ani odvozování podpisového jména z gramaticky jiného údaje zastoupení.
- 346 backendových testů prošlo, 2 volitelné native PG sady v obecném běhu přeskočené; samostatný skutečný lokální PostgreSQL/PGlite běh 45 passed / 0 skipped. Nový test ukládá/čte pod rolí `develocrm_app`, kontroluje zachování hodnot při starším payloadu, explicitní vymazání, tenantovou a permission izolaci a přesné počty audit/outbox událostí.
- 3 nové frontend interaction testy stávajícího formuláře, celý interaction běh úspěšný; frontend 143 passed. Frontend/backend TypeScript, lint a produkční frontend build prošly. Žádný právní profil se tím neaktivuje.
- Matching nasazení dokončeno 18. 10. 2026: commit `9db10f366617514faf29a2c10bbf3d81c371a3a8`, ACR API `cg3x` a migrations `cg3y` Succeeded. API digest `sha256:f0e4ee5f3e73d270517d6be59d6739784ad56add7c3eb296894b7b30a9f4e47e`, migrations `sha256:aa955cdfa302efcb93670b8343a8e37fb40f387f5af4a67c1558c7294cd3b216`.
- Read-only baseline přes existující migration/admin job potvrdil 0062 se shodným checksumem. První diagnostický override bez explicitního secretRef nepřevzal `DATABASE_URL`, selhal ECONNREFUSED; nešlo o výpadek DB a nebyla spuštěna migrace. Opravený diagnostický job `go5xt0g` uspěl. Secret nebyl čten ani vypsán.
- Skutečná migrace execution `caj-develocrm-migrations-pilot-7w9v85h` Succeeded, log `Applied 0063_original_contract_seller_fields.sql`. Následný read-only job `j4oi7q2` potvrdil přesně 0063 s checksumem `4b122caed5082bb027660172fd60419e4dc553e111461b7a65587a25c05bc935` a všechny tři sloupce. Žádná další migrace.
- Backend `ca-develocrm-api-pilot--seller-fields-9db10f3` Healthy/Running, latestReady a 100 % traffic; `/health` i `/ready` 200, liveness/readiness probes zachovány.
- Sites 147, source `de96958d35b2409a03c4494494c48c6846ffd584`, shodný tree se zdrojem GitHub `56d3a0eb2d6c2fc8dbffef16eff9df0081218fa2`; publikace `appgdep_6ad4c7dbfba48191aab3b27151d5074e` succeeded, sdílení nezměněno.
- Autentizovaný browser Adam: pouze projekt TECH SMOKE 0062, uloženy tři explicitně technické hodnoty přes existující formulář. Po úplném reloadu a znovuotevření formuláře všechny hodnoty shodné. Historie ukázala „Upraveny smluvní údaje prodávajícího“. Ostatní dosavadní údaje beze změny; skutečné projekty ani jednotka 417 neměněny. Vizuální kontrola formuláře provedena.
- Runtime tail zachytil GET catalog/commercial/payments/timeline/handovers 200 bez 5xx/RLS. GET clients přibližně 12 sekund je stále konkrétní výkonový bod backlogu, nikoli součást úspěšně dokončené této opravy.

## Následující prioritní balíky

1. Autorizované scalar mapování RS/SBK se strukturovanou readiness; chybějící údaje doplnit do stávajících projektových nastavení/identit, nikoli z UI posílat libovolná render data.
2. Politika splatnosti podle skutečného podpisu a českých pracovních dnů, izolovaný technický platební kalendář a prevence duplicit RS → SBK; bez změn historických předpisů.
3. Integrované contract/version/document evidence a stávající frontend přípravy pro oba typy, se zachováním sales case kontextu.
4. Technický browser E2E celého řetězce, přesné fyzické SharePoint verze a DOCX kontrola. Obsahově neschválenou variantu nezaměnit za aktivní právní smlouvu.
