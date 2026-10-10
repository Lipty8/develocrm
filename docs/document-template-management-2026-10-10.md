# Správa DOCX šablon – audit a provozní model

## Výsledek auditu

- Zdrojové DOCX soubory zůstávají v SharePointu. CRM ukládá jejich business metadata, neměnnou SharePoint verzi, SHA-256 a projektovou vazbu.
- Stávající tabulky `document_templates` a `document_template_versions` jsou použitelné; nevznikl paralelní template subsystem.
- Business generování již používá konkrétní schválenou verzi, generation snapshot a existující idempotentní upload service.
- Přímá registrace již nemůže vytvořit schválenou verzi a obejít nový lifecycle.

## Lifecycle

`draft → validated → approved → retired`

- Upload vždy vytvoří `draft`.
- Validace kontroluje DOCX/OpenXML strukturu, bezpečnost ZIP archivu, explicitní katalog polí a SHA-256 uložené SharePoint verze.
- Schválení vyžaduje `documents.review`; běžný upload a validace používají `documents.upload`.
- V projektu, typu a variantě může být aktivní právě jedna schválená verze.
- Obsah, schema, zdroj a hash schválené verze jsou neměnné. Změna vždy znamená novou verzi.
- Opakovaný upload, validace, schválení i retire jsou bezpečné pro retry.

## RBAC

- zobrazení: `documents.view`
- upload a validace: `documents.upload`
- schválení a retire: `documents.review`

Všechna oprávnění jsou vyhodnocena server-side v tenantovém a projektovém kontextu. Klient neposílá `siteId`, `driveId` ani Graph URL.

## Preview

Technický náhled renderuje DOCX pouze v paměti se syntetickými daty. Nevytváří smlouvu, dokument, sales case ani jiný business záznam.

## Audit a provozní odolnost

- Auditované jsou vytvoření šablony, upload verze, validace, neúspěšná validace, schválení a retire.
- Audit obsahuje aktéra, čas, template/version ID, hash a correlation ID; neukládá obsah DOCX.
- Schválení a retire vytvářejí outbox událost.
- Metadata konflikt se ověřuje před uploadem, aby nevznikal zbytečný SharePoint artefakt.
- Pokud SharePoint upload uspěje a následný DB krok selže, stejný idempotency klíč při retry znovu použije existující fyzický soubor.

## Zbývající technický dluh

1. Frontendový `CRMApp.tsx` a výsledný klientský chunk jsou nad doporučenou velikostí. Je vhodné později oddělit administraci šablon a další velké moduly pomocí lazy loadingu; nejde o blokaci funkce.
2. UI zatím spravuje výchozí variantu šablony. Datový model varianty podporuje, ale jejich plné zpřístupnění má smysl až s konkrétní business potřebou.
3. Zdroj technického smoke testu se po ověření archivuje v CRM; SharePoint soubor se nemaže, aby zůstala zachována auditní stopa a reference verze.
4. Náhled je stažitelný DOCX, nikoli webový Word viewer. To je bezpečnější první verze a nevyžaduje další Graph oprávnění.
