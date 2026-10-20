# Příprava SBK: porovnání s konkrétní podepsanou RS

## Změna

Source commit `2be37a352109fe6727e7aef99b18caa5716f077f` doplňuje existující
preparation-readiness projekci a stejný přípravný panel smlouvy. Nevzniká nový
workflow, snapshot, dokument ani schvalovací mechanismus.

Backend vybere pouze jednoznačnou účinnou podepsanou RS ze stejného tenantu,
projektu, jednotky a obchodního případu. Baseline vychází z konkrétní podepsané
contract version s exact document version. Srovnatelný generation snapshot
navíc vyžaduje shodu dokončené generation operation, template version,
document/version a payloadu. Hodnoty původní RS se nikdy nenahrazují dnešní
kartou klienta a starý právní text se neparsuje.

Porovnává se 20 explicitních společných scalar údajů se současnou serverovou
projekcí připravované SBK. Nejde o kontrolu celého právního textu nebo příloh.
Samostatně se rozpozná jiný party ID, i pokud má kupující stejné jméno.
Přehled osobních údajů uvádí pouze změnu, nikoli staré/nové datum narození,
bydliště, e-mail či telefon. Nezměněné údaje se do rozdílového přehledu
nevracejí. Uživateli zůstávají existující odkazy na konkrétní smlouvu a klienta.

Externí dokument, starý nesrovnatelný profil, více podepsaných verzí, chybějící
důkaz nebo neúplná SBK vrátí výslovné `unavailable`, nikoli falešné „bez změn“.
UI zobrazuje rozdíly a důvod nedostupnosti ve stávajícím přípravném panelu.
Nenabízí přepis historie ani automatické převzetí hodnot či právní schválení.

## Ověření

- Frontend interakce 110/110, statické regrese 143/143.
- Backend celá sada 394 prošlo, 4 volitelné externí PostgreSQL sady přeskočeny.
- Finální cílený scalar/comparison soubor 17/17, včetně ochrany osobních údajů.
- Následně skutečný izolovaný PostgreSQL 17: 48/48, 0 přeskočených. Pokryta
  nová repository projekce pod runtime rolí, scope, podpisové důkazy,
  neměnnost, ceny, ukončení a skutečné souběhy podpisu/expirace/ukončení.
  Dočasný cluster byl po testech vypnut, pilotní DB nebyla použita.
- Frontend/backend typecheck, changed-file lint a oba production buildy prošly.
  Existující warning velkého JS chunku a statické klasifikace rout zůstává.
- Sites build wrapper odmítl existující konfliktní npm/pnpm lockfiles; žádný
  lockfile se nemazal ani nepřegeneroval. Proběhl přesný stávající Vinext build
  command, poté typecheck/build a packaging oficiálním Sites workflow.

## Matching deployment

- GitHub push zdroje 2be37a3 úspěšný.
- ACR run `cg4d` Succeeded, API image
  `develocrm-api:sbk-comparison-2be37a3`, immutable digest
  `sha256:8f33bc8cd3cd97871a6618765aae6c693c83820b1c0b6fa9dcb75c9642b8e7ff`.
- Backend `ca-develocrm-api-pilot--sbk-compare-2be37a3`: Healthy, Running,
  latest ready a 100 % traffic. `/health` i `/ready` po přepnutí 200.
- Žádná migrace nebyla potřeba ani spuštěna. Předchozí zdravá revision
  `ca-develocrm-api-pilot--readiness-0b53432` zachována pro rollback.
- Oficiální Sites helper vytvořil a pushnul
  `5cfe310b3e02a46e6e939ad35239f0a4e4c850e0`. Jeho Git strom i GitHub zdroj mají
  přesně `8b58efc44cf8734f2210dc84c662a7863924a9b2`, checkout čistý.
- Před sestavením ověřeno všech 519 source souborů, bez rozdílů a extras.
  Archiv SHA-256:
  `a4e833b3496b2abc2a98232977d609b873976b7586f98b9c2ece7b7fba4acb74`.
- Původní source-opening commit v metadatech vyvolal bezpečnostní blokaci.
  Po výslovném potvrzení uživatele byl stále odmítnut. Inspekce oficiálního
  helperu doložila, že tento údaj není target commitem; nezměněný workflow byl
  poté znovu posouzen a povolen. Žádné metadata, credential mechanismy ani
  publikační kontroly se neobcházely nebo nefalšovaly.
- Soukromé Sites **156**, deployment
  `appgdep_6ad76d67ad308191bd1f5bef682e9a83`: Succeeded.
  Verze `appgprj_6a5f2c904d308191a901be8e347ea76f~appgver_5ac928e216008191a879ec51501437ae`.
- URL `https://develocrm-v1-preview.lipty8.chatgpt.site`. Owner-private přístup
  a 0 externích návštěvníků zachovány. Frontend publikován až po zdravém backendu.

## Rozsah pilotního ověření

Autentizovaný read-only browser smoke prošel jako Adam Lipták. Po publikaci
byl plně reloadován detail technické RS TECH62-PREPARE-RS, následně ze seznamu
otevřena existující technická SBK TECH60-BLOCKED-SBK
(`3fcbc8f8-205d-4845-90c4-dd64af33180c`). Nový panel správně ukázal, že pro
porovnání chybí jednoznačná účinná podepsaná RS tohoto obchodu. Nenabídl
falešnou shodu ani generování při chybějících podkladech. Další plný reload
zachoval tentýž obchodní kontext a stejný výsledek. Panel byl rovněž vizuálně
zkontrolován na screenshotu z aktuálního browser tabu; samostatný lokální
screenshot soubor se neprohlašuje za vytvořený.

Žádný formulář nebyl uložen, žádný nový obchod, soubor, podpis, předpis ani
platba nevznikly. Prohlížeč po smoke testu neměl zachycené warning/error.
Finální kontrolované 20minutové okno nové revision: 113 dokončených requestů,
0 HTTP 5xx a 0 detekovaných startup/DB/RLS chyb. Health/ready znovu 200.

Pozitivní porovnání kompletních originálových snapshotů s konkrétními rozdíly
bylo ověřeno unit/interaction testy, nikoli aktivací právní šablony v pilotu.
Nativní PostgreSQL test ověřil exact signed version a nesrovnatelný externí
PDF. Live browser tedy prokazuje přihlášený tok a bezpečnou unavailable větev,
nikoli celý produkční RS → SBK generation E2E. Kvůli demonstraci pozitivního
rozdílu nebyl vytvořen nový obchod ani aktivována review-only šablona.

Nové originálové RS/SBK nadále nejsou aktivované. Tato integrace není jejich
právním schválením ani tvrzením, že lze již uzavřít celý cíl produkční RS/SBK.
