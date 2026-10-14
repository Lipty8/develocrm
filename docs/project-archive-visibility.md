# Archivace projektů a viditelnost

## Model

Existující `projects.archived_at` je jediný zdroj archivační viditelnosti. Nová archivace nemění `lifecycle_status` (`preparation`, `active`, `completed`). Dokončení projektu nic nearchivuje.

Migrace 0059 pouze odděluje existující constraint a přidává řízenou operaci; nemění žádné existující projektové řádky. Historické záznamy se stavem `archived` zůstávají beze změny. Při jejich ručním obnovení musí administrátor výslovně zvolit obchodní stav, protože původní nelze bezpečně odvodit.

## Oprávnění a doménová operace

`app.set_project_archived` vyžaduje aktivní membership patřící přihlášenému uživateli, stejný tenant, existující workspace oprávnění `system.manage` a projektové `project.read`. Workspace administrace neobchází projektový rozsah.

Řádkový zámek projektu serializuje archivaci/obnovení. Opakování stejného cílového stavu je no-op bez dalšího auditu/outboxu. Změna je transakční, audit ukládá aktéra a předchozí/nový stav. Nedochází k fyzickému mazání, změně SharePoint souborů, jednotek, smluv, blokací ani obchodních případů.

Obyčejná editace projektu již nemůže nastavit `archived` ani zrušit `archived_at`. Archivovaný projekt se před editací jeho základních údajů musí obnovit. Běžící termíny, finanční závazky a expirace se archivací nevypínají.

## Čtení a KPI

Výchozí katalog vylučuje archivované projekty a jejich jednotky/příslušenství. Dokončené i připravované projekty zůstávají standardně dostupné. Filtr Aktivní a KPI Aktivní projekty počítají pouze nearchivované `lifecycle_status=active`, nikoliv dokončené nebo připravované projekty. Historické statistiky zahrnují dokončené nearchivované projekty.

Filtry Projekty: Aktivní a dokončené (výchozí nearchivovaný pracovní prostor), Aktivní, Dokončené, Archivované, Všechny projekty. Archivované záznamy server vrací jen oprávněnému administrátorovi, ani filtr Všechny nepřekračuje scope.

Explicitní projektový/entitní kontext umožňuje administrátorovi historické čtení katalogu, smluv, cen, klientů, plateb, dokumentů, předání, úkolů, reklamací a klientských změn při zachování původních modulových oprávnění. Globální seznamy nadále archivovaná data vylučují. Samotná znalost UUID ani archivační stav neopravňují přístup.

Neexistuje rozpoznávání technických projektů podle názvu. TECH SMOKE 0056 / 0057 zůstávají beze změny a ovlivňují souhrny až do případné ruční archivace administrátorem stejně jako ostatní nearchivované projekty.

## UI

Detail projektu → Akce projektu (`⋯`) → Archivovat projekt / Obnovit z archivu. Potvrzení uvádí zachování dat a pokračování procesů, počty aktivních případů, platných smluv a neuhrazených povinností. Selhání načtení dopadů nedovolí potvrdit změnu. Archivovaný detail má zřetelné označení.

## Ověření před nasazením

- Backend: 275 testů, 274 pass, 1 volitelný skutečný PostgreSQL concurrency test skip, 0 fail (omezený paralelismus kvůli pádu nativního V8/WASM procesu při souběžném testování).
- Frontend: 143 unit/regression testů pass; interaction 37 pass.
- Backend TypeScript build a frontend produkční build pass; lint bez chyb.
- Samostatný celoprojektový `tsc --noEmit` má existující chyby již ve výchozím commitu (Cloudflare typy, starší CRM/test typy). Porovnání se stejným příkazem nad výchozím zdrojem neukázalo nové diagnostiky této změny. Není označen za zelený.
- Nový databázový test používá aplikační roli/RLS, ověřuje dokončený projekt, beze změny zachované jednotky/cases/holds/contracts/payments, idempotentní audit/outbox, neoprávněnou/cizí membership, tenant i projektový rozsah a explicitní obnovu staré archivace.
- Interakční test ověřuje menu, potvrzení, upozornění na závazky a oba směry mutace bez změny lifecycle.

Nasazení a živé E2E budou zapsány do samostatného deployment reportu až po skutečném ověření.
