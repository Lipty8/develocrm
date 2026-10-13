# Price integrity + signed document evidence

## Stav

Implementace a lokální ověření; pilotní migrace 0057, matching nasazení a živé E2E ještě nejsou dokončené. Tento dokument není potvrzením připravenosti pilotu.

## Nalezené příčiny

- Vytvoření jednotky s cenou zapisovalo nepovolený `price_type='sales'`. Constraint povoluje `sale_price`; celá transakce se proto vracela zpět. Stejnou cestu používá projektový import. Chybějící cena se navíc zaměňovala za nulu.
- Globální cenové DTO bylo indexováno označením jednotky, které není unikátní napříč projekty. Canonical klíčem je nyní UUID. Zpětně kompatibilní alias existuje pouze pro jednoznačné označení.
- Podpis vyžadoval logickou verzi, ale ne konkrétní úspěšně uloženou verzi dokumentu.
- SharePoint může normalizovat DOCX při uploadu. Evidovaný hash proto musí být hash skutečných uložených bajtů konkrétní nativní verze, ne pouze původního transportu.

## Cenový source of truth

`unit_price_history` a stávající funkce `app.current_unit_price`, `app.current_unit_accessory_price`, `app.current_unit_sales_price`. Vytvoření počáteční ceny používá existující návrh a schválení ceny; nepřidává alternativní cenový model ani obcházení RBAC. Uživatel bez práva schválit cenu ji nemůže přímo aktivovat.

Projektová transakční serializace, stabilní idempotency key a request hash chrání vytvoření i import proti retry a souběhu. Skutečná nula dostane historický záznam; chybějící cena zůstane chybějící.

## Podpisová evidence

- Migrace 0057 vynucuje exact `contract_version → document_version`, odpovídající contract/project/unit/sales-case vazby, dokončený upload, povolený typ, SHA-256 a nativní SharePoint version ID.
- Generated RS používá existující generation/upload pipeline a kontrolu generation snapshotu. Externí DOCX/PDF používá stejný upload service, nikoliv druhou storage.
- HTTP pre-sign validace stáhne přesnou nativní verzi a porovná hash. UI podpis zpřístupní až po této kontrole.
- Vazba již doložené contract version je neměnná; oprava před podpisem vytvoří explicitní novou verzi. Nový dokument po předchozím schválení vyžaduje nové schválení.
- Podepsané a částečně podepsané dokumenty nelze přes CRM nahradit. Původní generovací snapshot a historická verze zůstávají zachované.
- Otevření podepsaného souboru používá autorizované načtení přesné verze ze SharePointu, nikoliv odkaz na jeho potenciálně novější obsah.
- Souběh uploadu/generování a podpisu používá stejný unit-first pořádek zámků. Nedokončená operace blokuje podpis.
- Databázový invariant nekontaktuje Graph; dostupnost a integritu fyzické verze navíc ověřuje serverová podpisová cesta. Administrátorské zásahy mimo CRM nejsou touto aplikací technicky znemožněné.

## Read-only audit pilotních dat

Azure execution `caj-develocrm-migrations-pilot-1flm320`, 13. 10. 2026 09:42 Europe/Prague, explicitní `BEGIN READ ONLY`.

- 22 aktivních jednotek včetně technických testů.
- Všech 19 jednotek DEJ má cenovou historii a nastavenou aktuální cenu. Jednotky 311 a 417 mají dva cenové záznamy, ostatní jeden. Samotný počet dvou záznamů není anomálie.
- RSTEST / RS-TEST-001: cena 5 000 000 Kč, jeden záznam.
- SAFE56 / TECH-RS56: cena 1 000 000 Kč, jeden záznam.
- SAFE56 / TECH-EXP56: bez ceny a bez historie; technický expirační scénář.
- Z dostupných dat nebyla jednoznačně prokázána chybná cena vyžadující opravu. Neúspěšné vytvoření s nepovoleným typem se rollbackovalo, tedy nevytvořilo napůl uloženou cenu. Audit nevypovídá o zamýšlené hodnotě nezadaných/nezaložených jednotek.
- Historické podepsané smlouvy bez exact document version: DEJ / 311 / SBK, DEJ / 314 / RS a SAFE56 / TECH-RS56 / RS. Nebyly doplněny fiktivní dokumenty ani změněny podpisy. Vyžadují skutečné podepsané soubory a samostatné kontrolované doplnění evidence.

CHECK je pro historické řádky `NOT VALID`, ale vynucuje nové/změněné řádky. Nelze proto tvrdit, že všechny staré podepsané smlouvy již invariant splňují.

## Ověření a nasazení

Lokálně prošly testy generated/external RS, retry, regenerace, chybných vazeb, draft dokumentu, cenové historie a izolace shodných označení. PostgreSQL souběžné scénáře zahrnují expiraci/podpis, release/podpis, dvojí podpis/expiraci, upload/podpis a paralelní vytvoření jednotky s cenou.

Finální lokální regrese: backend 257 testů / 256 prošlo / 0 chyb / 1 volitelný PostgreSQL scénář vynechán. Ten byl samostatně spuštěn proti izolovanému PostgreSQL: 24/24 testů prošlo v kombinaci s cenovou/evidence sadou. Frontend 139/139, interaction 34/34, lint a produkční frontend/backend build prošly. Build hlásí již existující větší frontend bundle; nesouvisející refactor nebyl prováděn.

Image/revision a oba živé E2E scénáře budou doplněny až po skutečném ověření. Bez jejich dokončení balík zůstává otevřený.
