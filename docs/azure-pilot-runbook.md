# DeveloCRM – Azure pilot runbook

## 1. Nejjednodušší bezpečná topologie pilotu

- Azure Container Apps: jeden backendový kontejner, min. 1 replika.
- Azure Database for PostgreSQL Flexible Server: samostatná pilotní databáze.
- Azure Key Vault: databázový connection string a další tajné hodnoty.
- Application Insights: logy, chyby, latence a correlation ID.
- Entra ID App Registration: single-tenant API a frontend klient.
- Sites frontend: pouze HTTPS URL API, workspace UUID a `DEVELOCRM_DATA_MODE=api`.

Azure Service Bus, VNet/private endpoint a další enterprise komponenty nejsou pro první interní pilot povinné. Outbox zůstává zdrojem budoucí integrace.

## 2. Přístupy a hodnoty, které musí dodat správce

- Azure subscription ID a resource group.
- Entra tenant ID.
- Oprávnění vytvořit App Registration, Container App, PostgreSQL, Key Vault a App Insights.
- Pilotní DNS/HTTPS URL frontendu.
- Seznam prvních 3–5 uživatelů a jejich Entra object ID (`oid`).
- Jméno prvního administrátora a potvrzení vlastníka Rezidence Dejvice.

## 3. Povinné backend proměnné

```text
DEVELOCRM_ENV=pilot
DATABASE_URL=<Key Vault secret reference>
ENTRA_CLIENT_ID=<API application/client ID>
ENTRA_ALLOWED_TENANT_IDS=<Entra tenant UUID>
CORS_ALLOWED_ORIGINS=https://<pilot-frontend>
APPLICATIONINSIGHTS_CONNECTION_STRING=<secret/reference>
PORT=3001
DEVELOCRM_SEED_PROFILE=none
```

Frontend:

```text
DEVELOCRM_DATA_MODE=api
DEVELOCRM_API_URL=https://<container-app-fqdn>
DEVELOCRM_TENANT_ID=<workspace UUID>
```

`DEVELOCRM_DATA_MODE=browser` je povolen pouze lokálně nebo v explicitním demo prostředí.

## 4. Entra ID

1. Zaregistrovat API aplikaci, expose scope `access_as_user`.
2. Zaregistrovat frontend/public client a povolit pouze přesné HTTPS redirect URI pilotu.
3. Udělit frontend klientu delegated permission na API scope a provést admin consent.
4. Backend validuje podpis, issuer, audience, `tid`, `oid` a expiraci tokenu.
5. Uživatel se páruje stabilním `oid`; e-mail není identifikátor.
6. Založit první membership pouze jednorázovým bootstrapem se známým `oid`, přiřadit roli Admin a zapsat audit.
7. Po ověření prvního Admina bootstrap oprávnění/endpoint vypnout. Další uživatelé vznikají výhradně pozvánkou v CRM.

Lokální hesla se nevytvářejí ani neukládají.

## 5. Databáze a migrace

Před každou změnou:

```bash
pg_dump --format=custom --no-owner --file=develocrm-before-v40.dump "$DATABASE_URL"
pnpm run db:migrate
```

Migrační runner:

- používá PostgreSQL advisory lock,
- aplikuje soubory v číselném pořadí,
- eviduje checksum,
- odmítne změněnou již aplikovanou migraci.

Po migraci ověřit:

```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY filename;
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relkind='r' AND relnamespace='public'::regnamespace;
SELECT code FROM permissions WHERE code='projects.create';
```

Obnova se testuje do nové databáze:

```bash
createdb develocrm_restore_test
pg_restore --clean --if-exists --no-owner --dbname=develocrm_restore_test develocrm-before-v40.dump
```

Poté spustit validační SQL a aplikační testy proti restore DB. Pilot nezačíná, dokud restore test neprojde.

## 6. Rezidence Dejvice

1. `DEVELOCRM_SEED_PROFILE=none`.
2. Import spustit pouze proti pilotnímu workspace a idempotency klíči importu.
3. Před importem uložit report počtů.
4. Po importu ověřit nejméně:
   - právě 1 aktivní projekt `DEJ`,
   - 19 aktivních jednotek,
   - příslušenství a jeho přiřazení,
   - canonical parties bez duplicit externích ID,
   - sales cases, smlouvy a cenové historie,
   - žádný aktivní demo projekt,
   - dokumenty mohou být 0, pokud nebyly fyzicky dodány.
5. Import zopakovat a ověřit, že se počty nezmění.

## 7. Monitoring a bezpečnost

- Alert: `/ready` nevrací 200 po dobu 2 minut.
- Alert: 5xx > 2 % za 5 minut.
- Alert: nepublikované outbox události starší 15 minut.
- Logovat request/correlation ID, tenant ID, endpoint, status a trvání; nelogovat tokeny ani citlivé osobní údaje.
- HTTPS only, přesný CORS allowlist, Entra tenant allowlist, žádná tajemství ve frontend env.
- PostgreSQL role aplikace nemá superuser ani `BYPASSRLS`.

## 8. Pilotní test 3–5 uživatelů

Role: Admin, Jednatel, Project Manager, Obchod, Back Office.

- přihlášení a odhlášení přes Entra,
- oddělení workspace a projektových scope,
- Admin/Jednatel vidí „Nový projekt“, PM jej nevidí a API vrací 403,
- založení prázdného projektu a okamžité zobrazení druhému uživateli,
- změna klienta/jednotky/smlouvy zůstane po refreshi a je vidět dalšímu uživateli,
- correlation ID při simulovaném výpadku,
- žádný localStorage/D1 fallback v API režimu,
- audit a outbox pro zápisové operace.

## 9. Publikace

Novou frontendovou verzi uložit a nasadit až po úspěchu bodů 1–8. Produkční URL nasazení je veřejný provozní artefakt; nepoužívat ji jako simulaci chybějící infrastruktury.
