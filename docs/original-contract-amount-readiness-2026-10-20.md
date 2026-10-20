# RS/SBK: včasná kontrola smluvních částek

## Reprodukovaná mezera

Příprava originálové varianty kontrolovala přítomnost cen, ale ne všechny
podmínky existujícího scalar rendereru. Například `totalPrice: 0` vyvolalo
`OriginalContractSnapshotError`, zatímco readiness neobsahovala konkrétní
chybu sjednané ceny. Review-only blokace sice nadále bránila generování, ale
uživateli nedala úplný seznam údajů potřebných k opravě.

Regresní test byl nejprve spuštěn proti původní implementaci a selhal právě
na chybějícím `contract_price` pro nulovou cenu. Nejde o tvrzení, že taková
anomálie byla nalezena ve skutečných pilotních obchodních datech.

## Oprava

`original-contract-readiness.ts` používá stejný `originalMoney` jako renderer:
kladné částky, přesné koruny/haléře a existující rozsah. Porovnání poplatku
proti kupní ceně používá minor units (`bigint`), nikoli zaokrouhlené zobrazení.
Neplatná cena má `contract_price`, neplatný nebo příliš vysoký poplatek
`contract_fee`. Null hodnoty zachovávají původní missing-field hlášky bez
duplicit. Žádné hodnoty se neopravují, nezaokrouhlují ani nepřepisují.

Nevznikl nový výpočet splátek, model, permission nebo frontendová implementace.
Pravidlo započtení poplatku SBK a všechny review/approval blokace zůstávají.

## Ověření

- Cílená sada před rozšířením testovací matice: 58/58 prošlo.
- Finální `original-contract-snapshot.test.ts`: 14/14 prošlo. Testuje RS i SBK,
  nulové/NaN/nepřesné částky, poplatek nad cenou, zachování platných haléřů,
  null hlášek a neaktivního review-only stavu.
- Celý backend: 390 prošlo, 0 selhalo, 4 volitelné externí PostgreSQL sady
  přeskočeny. Celý běh načetl test před dodatečným rozdělením na RS/SBK;
  finální rozšířený soubor byl poté samostatně ověřen 14/14. Neprohlašujeme
  nový nativní PostgreSQL concurrency test; oprava nemění DB ani zámky.
- Backend production TypeScript build, frontend typecheck a changed-file
  ESLint prošly. Žádná frontendová změna ani nový frontend build.

## Deployment

- Source commit `0b534328ab629de14507129fb20c3df52a9992ed`, push do soukromého
  GitHubu úspěšný.
- Očištěný context pouze z vybraných commitnutých package/config/backend cest,
  713.936 KiB; bez lokálních logů, secrets, příloh a necommitnutých souborů.
- ACR run `cg4c`: Succeeded. Image
  `develocrm-api:readiness-0b53432`, immutable digest
  `sha256:4a7c130de2ffddb1688744912e10529264b1e9ef44910ffa52ba0423351699d8`.
- Aktivní revision `ca-develocrm-api-pilot--readiness-0b53432`:
  Healthy, Running, 100 % traffic, latest ready. Liveness/Readiness zachovány.
- `/health` 200 a `/ready` 200 opakovány po přepnutí.
- Migrace nebyla potřeba ani spuštěna. Frontend Sites 155 nebyl měněn:
  zpětně kompatibilní doplnění existujících readiness issues již jeho UI umí.
  Žádná nová frontendová verze se neprohlašuje za publikovanou.

## Autentizovaný read-only smoke

V existujícím přihlášeném preview jako Adam Lipták byl otevřen pouze technický
draft `TECH62-PREPARE-RS`, contract
`2cf4b568-4427-4543-90ab-3bc93321d10d`. Po přepnutí backendu byl detail plně
reloadován. Připravenost se načetla, zachovala cenu 1 000 000 Kč a poplatek
250 000 Kč bez falešného finančního varování; původní chybějící údaje,
neschválená šablona a review-only blokace zůstaly viditelné. Generování nebylo
nabídnuto. Žádná data nebyla uložena, žádný soubor nahrán ani podpis evidován.

Nové chybové větve byly ověřeny testovacími fixtures, ne vnášením chybných cen
do pilotu. Prohlížeč po reloadu nezaznamenal warning/error. Agregovaný log
nové revision v kontrolovaném okně: 36 dokončených requestů, 0 HTTP 5xx,
0 detekovaných startup/DB/RLS chyb. Tento omezený smoke není úplný produkční
E2E originálových šablon ani náhrada jejich právního schválení.

Právní sjednocení RS a obsahová kontrola neaktivních originálových návrhů
nadále zůstávají otevřené podle `original-contract-review-2026-10-20.md`.
