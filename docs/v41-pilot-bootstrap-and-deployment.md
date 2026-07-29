# DeveloCRM v41 – bootstrap, migrace a příprava pilotu

Tato verze je pouze deployment-ready. Žádný příkaz z této kapitoly nebyl spuštěn
proti Azure ani pilotní databázi.

## Entra registrace

V Entra ID vytvořte dvě single-tenant registrace:

1. **DeveloCRM API**: Application ID URI `api://<API_CLIENT_ID>`, delegated scope
   `access_as_user`. Backend používá `<API_CLIENT_ID>` jako audience.
2. **DeveloCRM SPA**: platforma Single-page application, přesné redirect URI
   `https://<pilot-host>/dashboard` a logout URI `https://<pilot-host>`. Přidejte
   delegated permission `api://<API_CLIENT_ID>/access_as_user` a udělte consent.

Frontend používá Authorization Code Flow s PKCE z `@azure/msal-browser`, token
získává přes `acquireTokenSilent` a centrální API klient jej posílá jako Bearer.
ID token se backendu neposílá. Backend ověřuje podpis, issuer, audience, expiraci,
allowlist `tid`, povinné `oid` a `scp=access_as_user`; app-only token odmítne.

Povinné hodnoty jsou vypsané v [frontend příkladu](../.env.example) a
[backend příkladu](../backend/.env.example). Skutečné hodnoty ani secrets se
necommitují.

## Pořadí databázových operací

Migrace a bootstrap používají databázového administrátora. Runtime backend potom
musí používat výhradně `develocrm_runtime`.

```bash
cd <repository-root>
export DATABASE_URL='<admin-connection-string-from-secure-shell>'
pnpm run db:migrate

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/sql/create-runtime-role.sql

pnpm run pilot:bootstrap -- \
  --entra-tenant-id '<REAL_ENTRA_TENANT_UUID>' \
  --admin-oid '<REAL_ADMIN_OBJECT_UUID>' \
  --admin-email '<WORK_EMAIL>' \
  --admin-name '<DISPLAY_NAME>' \
  --workspace-name '<WORKSPACE_NAME>' \
  --workspace-id '<WORKSPACE_UUID>'
```

Bootstrap je idempotentní. Vytvoří tenant, skutečnou Entra identitu, membership,
systémové role, roli Admin, audit a outbox; nevytvoří obchodní data.

## Import Rezidence Dejvice

Nejdříve spusťte dry-run a uschovejte JSON report:

```bash
pnpm run pilot:import:dejvice -- \
  --tenant-id '<WORKSPACE_UUID>' \
  --membership-id '<ADMIN_MEMBERSHIP_UUID>' \
  --dry-run
```

Teprve po kontrole reportu:

```bash
pnpm run pilot:import:dejvice -- \
  --tenant-id '<WORKSPACE_UUID>' \
  --membership-id '<ADMIN_MEMBERSHIP_UUID>'
```

Import kontroluje hash zdroje, cílovou membership, používá advisory transakční
lock, je atomický a tenantově namespacuje zdrojová UUID. Očekává 1 projekt,
19 jednotek, 48 položek příslušenství, 19 cen jednotek, 10 canonical parties,
10 zájmů, 8 sales cases a 4 smlouvy. Druhé spuštění musí v `created` vrátit nuly.
Import nepřenáší fyzické dokumenty a neověřené historické případy neaktivuje jako
platné rezervace.

## Migrační runner a job

Runner počítá checksum z nezměněného původního souboru. Při načtení pouze odstraní
obalové `BEGIN/COMMIT`, protože jediným vlastníkem transakce je runner. Advisory
lock brání souběhu a migrace se zapisuje do `schema_migrations` ve stejné
transakci jako její SQL. Změněná nebo chybějící aplikovaná migrace je chyba.

Image:

```bash
az acr build -g rg-develocrm-pilot -r acrdevelocrmpilot \
  -t develocrm-migrations:v41-pilot-rc1-<GIT_SHA> \
  -f backend/Dockerfile.migrations .
```

Container Apps Job vytvoří připravený skript
[`infra/azure/deploy-pilot.sh`](../infra/azure/deploy-pilot.sh). Jeho secret
`DATABASE_URL` je Key Vault reference přes user-assigned managed identity.
Spuštění a kontrola:

```bash
az containerapp job start -g rg-develocrm-pilot \
  -n caj-develocrm-migrations-pilot
az containerapp job execution list -g rg-develocrm-pilot \
  -n caj-develocrm-migrations-pilot -o table
```

Úspěch potvrďte také dotazem:

```sql
SELECT filename, checksum, applied_at
FROM schema_migrations ORDER BY filename;
```

## Runtime role

`backend/sql/create-runtime-role.sql` vytváří idempotentně login roli s
`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `INHERIT`, `NOBYPASSRLS` a členstvím
v `develocrm_app`. Heslo skript neobsahuje. Ověření:

```sql
SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls
FROM pg_roles WHERE rolname='develocrm_runtime';
SELECT pg_has_role('develocrm_runtime','develocrm_app','member');
```

## Hodnoty, které zůstávají vstupem správce

- Entra tenant UUID, API client ID a SPA client ID.
- Skutečná frontend HTTPS URL a její redirect/logout URI.
- `oid`, pracovní e-mail a jméno prvního administrátora.
- Workspace UUID.
- Heslo/runtime autentizace PostgreSQL uložená do Key Vault secretu
  `database-url`.
- Azure subscription ID a unikátně dostupné jméno ACR, pokud navržené jméno
  není dostupné.

Immutable image tag musí obsahovat release a commit SHA; `latest` se nepoužívá.
