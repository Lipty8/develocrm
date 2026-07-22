import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/CRMApp.tsx", import.meta.url);
const dataUrl = new URL("../app/crm-data.ts", import.meta.url);
const catalogRepositoryUrl = new URL("../app/repositories/catalog-repository.ts", import.meta.url);
const catalogRouteUrl = new URL("../app/api/catalog/route.ts", import.meta.url);
const clientRepositoryUrl = new URL("../app/repositories/client-repository.ts", import.meta.url);
const clientRouteUrl = new URL("../app/api/clients/route.ts", import.meta.url);
const clientExportRouteUrl = new URL("../app/api/clients/export/route.ts", import.meta.url);
const commercialRepositoryUrl = new URL("../app/repositories/commercial-repository.ts", import.meta.url);
const commercialRouteUrl = new URL("../app/api/commercial/route.ts", import.meta.url);
const mediaRepositoryUrl = new URL("../app/repositories/media-repository.ts", import.meta.url);
const taskRepositoryUrl = new URL("../app/repositories/task-repository.ts", import.meta.url);
const activityRepositoryUrl = new URL("../app/repositories/activity-repository.ts", import.meta.url);

test("implements the project-to-unit navigation hierarchy", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /Všechny projekty/);
  assert.match(app, /function ProjectDetail/);
  assert.match(app, /function ProjectUnitList/);
  assert.match(app, /function UnitPreview/);
  assert.match(app, /Otevřít celý detail/);
  assert.match(app, /Přehled.*Jednotky.*Klienti.*Smlouvy.*Platby.*Klientské změny.*Předání.*Dokumenty/s);
  assert.match(app, /function ProjectClients/);
  assert.match(app, /function ProjectContracts/);
  assert.match(app, /function ProjectPayments/);
  assert.match(app, /function ProjectClientChanges/);
  assert.match(app, /function ProjectHandovers/);
  assert.match(app, /aria-label="Navigace projektu"/);
  assert.match(app, /project-tab-icon/);
  assert.match(app, /aria-current=/);
  assert.match(app, /PRODEJNÍ VÝKON/);
  assert.match(app, /Rozložení projektu/);
  assert.match(app, /project-sale-ring/);
  assert.doesNotMatch(app, /Obchodní stav projektu/);
  assert.doesNotMatch(app, /project-sales-card/);
  assert.match(app, /aria-label="Pohledy úkolů"/);
  assert.match(app, /client-view-title/);
  assert.doesNotMatch(app, /Filtry databáze/);
});

test("keeps unit filters combinable and project clients in one table", async () => {
  const [app, data] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(dataUrl, "utf8"),
  ]);

  for (const label of ["Budova / etapa", "Podlaží", "Obchodní stav", "Dispozice", "Plocha m²", "Aktuální cena"]) {
    assert.match(app, new RegExp(label.replace("²", "\\u00b2")));
  }
  assert.match(app, /function TableColumnFilter/);
  assert.match(app, /function MultiSelectFilter/);
  assert.match(app, /type="checkbox"/);
  assert.match(app, /aria-expanded=/);
  assert.match(app, /vybráno/);
  assert.match(app, /buildingFilter\.includes\(unit\.building\)/);
  assert.match(app, /projectFilter\.some/);
  assert.match(app, /projectMatchesName/);
  assert.match(app, /installmentFilter\.includes\(payment\.installment\)/);
  assert.match(app, /data-table unit-table filter-table/);
  assert.match(app, /data-table client-table filter-table/);
  assert.match(app, /data-table payment-table filter-table/);
  assert.match(app, /column-filter-heading/);
  assert.match(app, /Filtrovat jméno nebo název/);
  assert.match(app, /Filtrovat platbu podle jednotky nebo klienta/);
  assert.match(app, /Vybrat všech .* výsledků aktuálního filtru/);
  assert.match(app, /Kopírovat e-maily pro BCC/);
  assert.match(app, /Excel \/ CSV/);
  assert.match(data, /projectNames: \["Rezidence Javorová", "Vily Stráň"\]/);
});

test("unit detail exposes persistent commercial context", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /Přehled.*Smlouvy.*Platby.*Klientské změny.*Dokumenty.*Předání.*Úkoly.*Historie/s);
  assert.match(app, /function UnitClientChanges/);
  assert.match(app, /aria-label="Navigace jednotky"/);
  assert.match(app, /unit-detail-tabs/);
  assert.match(app, /client-changes-tab/);
  assert.match(app, /unit-tab-new/);
  assert.match(app, /Individuální změna/);
  assert.match(app, /Ceník standardních změn/);
  assert.match(app, /Související dokumenty/);
  assert.match(app, /Historie zájmu/);
  assert.match(app, /Každá změna je samostatný auditovatelný záznam/);
  assert.match(app, /Prodejní proces/);
  assert.match(app, /Stavební stav/);
  assert.match(app, /Otevřít větší náhled/);
});

test("project and unit screens load through the switchable catalog repository", async () => {
  const [app, repository, route] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(catalogRepositoryUrl, "utf8"),
    readFile(catalogRouteUrl, "utf8"),
  ]);
  assert.match(app, /catalogRepository\.getCatalog/);
  assert.match(repository, /interface CatalogRepository/);
  assert.match(route, /DEVELOCRM_API_URL/);
  assert.match(route, /preview-seed/);
  assert.match(route, /backend-api/);
  assert.match(route, /adaptBackendCatalog/);
});

test("client views, unit commercial context and exports use the Block C repository", async () => {
  const [app,repository,route,exportRoute] = await Promise.all([
    readFile(appUrl,"utf8"),readFile(clientRepositoryUrl,"utf8"),readFile(clientRouteUrl,"utf8"),readFile(clientExportRouteUrl,"utf8"),
  ]);
  assert.match(app,/clientRepository\.getDirectory/);
  assert.match(app,/clientRepository\.exportContacts/);
  assert.match(app,/unitCommercialContexts\[unit\.id\]/);
  assert.match(repository,/interface ClientRepository/);
  assert.match(route,/DEVELOCRM_API_URL/);
  assert.match(route,/preview-seed/);
  assert.match(exportRoute,/\/v1\/clients\/export/);
});

test("prices and contracts use the Block D repository without duplicating workflow data",async()=>{
  const [app,repository,route]=await Promise.all([readFile(appUrl,"utf8"),readFile(commercialRepositoryUrl,"utf8"),readFile(commercialRouteUrl,"utf8")]);
  assert.match(app,/commercialRepository\.getSnapshot/);
  assert.match(app,/unitPriceHistories\[unit\.id\]/);
  assert.match(app,/contracts\.filter\(contract=>contract\.unit===unit\.id\)/);
  assert.match(app,/latest\.number/);
  assert.match(repository,/interface CommercialRepository/);
  assert.match(route,/DEVELOCRM_API_URL/);
  assert.match(route,/preview-seed/);
  assert.match(route,/\/v1\/commercial/);
});

test("completion workflows are visible, persistent and share canonical sources",async()=>{const [app,media,tasks,activities]=await Promise.all([readFile(appUrl,"utf8"),readFile(mediaRepositoryUrl,"utf8"),readFile(taskRepositoryUrl,"utf8"),readFile(activityRepositoryUrl,"utf8")]);assert.match(app,/Profil a pracovní prostor/);assert.match(app,/Uživatelé a role/);assert.match(app,/Titulní obrázek/);assert.match(app,/Nahrát půdorys|Změnit/);assert.match(app,/scope==="mine"/);assert.match(app,/ClientRelationColumn/);assert.doesNotMatch(app,/>Otevřít projekt <ArrowRight/);assert.doesNotMatch(app,/jednotek odpovídá filtrům/);assert.match(media,/\/api\/media/);assert.match(tasks,/scope=/);assert.match(activities,/develocrm\.preview\.audit/);assert.match(app,/timeline\.slice\(0,4\)/);assert.match(app,/timeline\.map/);});
