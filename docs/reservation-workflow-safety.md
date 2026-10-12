# Ochrana rezervace a expirace předrezervací

Rozsah: ochrana již podepsané smlouvy, automatická expirace předrezervací, sjednocené zámky a běžné UI. Bez změny právního workflow.

## Invarianty

- Účinná podepsaná RS/SBK/KS brání návratu jednotky na Volnou a etapy na Zájem/Předrezervaci přes běžné operace.
- Smluvní rezervace není expirovatelná. Historický `expires_at` zůstává pro kompatibilitu, ale není důvodem k uvolnění.
- `is_expirable` odpovídá typu blokace a je vynucené triggerem/constraintem. Expirační job vybírá výhradně předrezervace.
- Podpis, vytvoření/konverze/ukončení blokace a smluvní operace nejprve zamknou jednotku. Operace nad jednou jednotkou se serializují.
- Opakovaná expirace nevytvoří další audit/outbox. Každá expirace je samostatná transakce.
- Ruční rezervace a převod předrezervace nejsou v běžném UI. Existující autorizované backendové operace zůstávají dostupné.

## Runtime job

Používá Azure Container Apps Jobs a stejný immutable API image jako backend. Command: `node backend/dist/sales/run-hold-expiry.js`.

Konfigurace: runtime `DATABASE_URL` přes současnou Key Vault referenci a `HOLD_EXPIRY_CONTEXTS`, seznam explicitních `{tenantId,membershipId}`. Každý kontext vyžaduje aktivní členství; kandidáti navíc vyžadují projektové `holds.manage`. Žádné vypnutí RLS nebo admin databázové spojení.

Plán: jednou za minutu (UTC), nejvýše 100 blokací za běh, jedna replika na provedení, jeden retry, timeout jobu 600 s. Případný překryv běhů je bezpečný díky databázovým zámkům a idempotenci. Zámek má timeout 5 s, jednotlivá operace 30 s. Chyba ukončí job neúspěšně; další běh bezpečně naváže. Audit rozlišuje `scheduled_hold_expiry` a `domain_command`.

## Ověření

Souběžné testy se spouštějí proti izolovanému skutečnému PostgreSQL přes `WORKFLOW_TEST_DATABASE_URL`; vytvoří a odstraní vlastní dočasnou databázi. Ověřují skutečné čekání druhého PostgreSQL spojení na zámek, obě pořadí podpis/expirace i podpis/ukončení, dvě expirace a dva podpisy. Běžná suite navíc testuje invarianty přes všechny migrace v PGlite.

## Backlog mimo tuto změnu

Ukončení SBK/KS a návrat stavů, postoupení plateb, změna jednotky, změny příslušenství po podpisu, automatické uzavření sales case a právní obsah šablon.
