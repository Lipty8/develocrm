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

Tyto balíky samy nedokončují RS/SBK business generování ani platební kalendář.

## Následující prioritní balíky

1. Autorizované scalar mapování RS/SBK se strukturovanou readiness; chybějící údaje doplnit do stávajících projektových nastavení/identit, nikoli z UI posílat libovolná render data.
2. Politika splatnosti podle skutečného podpisu a českých pracovních dnů, izolovaný technický platební kalendář a prevence duplicit RS → SBK; bez změn historických předpisů.
3. Integrované contract/version/document evidence a stávající frontend přípravy pro oba typy, se zachováním sales case kontextu.
4. Technický browser E2E celého řetězce, přesné fyzické SharePoint verze a DOCX kontrola. Obsahově neschválenou variantu nezaměnit za aktivní právní smlouvu.
