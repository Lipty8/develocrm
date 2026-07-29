# DeveloCRM v40 – audit a připravenost pilotu

Datum auditu: 29. 7. 2026

## Ověřený současný stav

- Publikovaná verze v39 je frontendový prototyp na Sites. Nemá nastavenou žádnou runtime proměnnou.
- Nebyla nalezena URL společného backendu, PostgreSQL connection string, Entra client ID ani Azure přístup.
- Lokální backend existuje (Fastify, PostgreSQL, RLS, RBAC, audit, outbox), ale nebylo možné doložit jeho běžící Azure deployment.
- Přihlášení publikovaného preview je Sites/ChatGPT identita, nikoliv Microsoft Entra ID aplikace DeveloCRM.
- Dosavadní browser adaptéry ukládaly některé změny do localStorage/D1/R2. Nejsou společným zdrojem dat pro pilot.
- Zdrojový pilotní import Rezidence Dejvice je idempotentní a automatické testy ověřují 1 projekt, 19 jednotek, 19 sklepů, 29 parkovacích položek, 19 cen jednotek a 48 cen příslušenství. To není důkaz stavu vzdálené databáze, protože přístup k ní nebyl k dispozici.

## Implementované lokální změny v40

- `DEVELOCRM_DATA_MODE` má pouze režimy `api` a explicitní vývojový `browser`; implicitní výchozí režim je `api`.
- API režim při chybě připojení nevrací mock data. UI zobrazí blokující chybu, opakování a correlation ID.
- `/health` ověřuje běh procesu, `/ready` ověřuje dosažitelnost PostgreSQL.
- Backend přidává correlation ID, allowlist CORS a jednoduchý bezpečnostní rate limit.
- `projects.create` je samostatné oprávnění. Výchozí grant mají pouze role `executive` a `admin`.
- Založení projektu je jedna databázová transakce: projekt, počáteční stavební událost, audit a outbox.
- Projekt vzniká prázdný. Nevznikají jednotky, klienti ani demo souhrny.
- UI obsahuje funkční formulář „Nový projekt“, validaci, ochranu proti dvojímu odeslání, redirect do detailu a onboarding prázdného projektu.
- Přibyl kontrolovaný migrační runner s advisory lockem a kontrolou checksumů a kontejner backendu.

## Co zůstává blokované externími přístupy

Nebyl proveden Azure deployment, registrace Entra aplikace, vytvoření Azure PostgreSQL, Key Vaultu, Application Insights, vzdálená migrace ani vzdálený import. Nebyla proto publikována v40 jako pilotní preview. Veřejná v39 zůstává prototypem.

Technické blokery z tohoto auditu řeší lokální kandidát v41. Provozní postup je
v [`v41-pilot-bootstrap-and-deployment.md`](v41-pilot-bootstrap-and-deployment.md);
ani v41 sama neprovádí vzdálený deployment nebo import.

## Akceptační podmínka pilotu

Pilot lze označit za připravený až po splnění všech bodů:

1. `/health` i `/ready` vracejí 200 z nasazeného backendu.
2. Frontend má `DEVELOCRM_DATA_MODE=api`, `DEVELOCRM_API_URL` a skutečný workspace UUID.
3. Přihlášení používá Entra access token s `oid`, `tid`, správným `aud` a `iss`.
4. Vzdálená databáze projde migracemi 0001–0016.
5. Validační report vzdálené DB potvrdí Rezidenci Dejvice a 19 jednotek.
6. Testovací uživatelé vidí pouze oprávněné projekty a změna jednoho uživatele je po refreshi vidět druhému.
7. V síťových logách není žádná odpověď se zdrojem `preview-*`.
8. Je proveden a ověřen test obnovy databáze.
