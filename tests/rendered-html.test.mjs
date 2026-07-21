import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/CRMApp.tsx", import.meta.url);
const dataUrl = new URL("../app/crm-data.ts", import.meta.url);

test("implements the project-to-unit navigation hierarchy", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /Přehled projektů/);
  assert.match(app, /function ProjectDetail/);
  assert.match(app, /function ProjectUnitList/);
  assert.match(app, /function UnitPreview/);
  assert.match(app, /Otevřít celý detail/);
  assert.match(app, /Přehled.*Jednotky.*Příslušenství.*Ceníky.*Dokumenty.*Aktivita/s);
});

test("keeps unit filters combinable and project clients in one table", async () => {
  const [app, data] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(dataUrl, "utf8"),
  ]);

  for (const label of ["Budova / etapa", "Obchodní stav", "Dispozice", "Plocha m²", "Cena mil. Kč"]) {
    assert.match(app, new RegExp(label.replace("²", "\\u00b2")));
  }
  assert.match(app, /data-table client-table/);
  assert.match(app, /Vybrat všech .* výsledků aktuálního filtru/);
  assert.match(app, /Kopírovat e-maily pro BCC/);
  assert.match(app, /Excel \/ CSV/);
  assert.match(data, /projectNames: \["Rezidence Javorová", "Vily Stráň"\]/);
});

test("unit detail exposes persistent commercial context", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /Historie zájmu/);
  assert.match(app, /Každá změna je samostatný auditovatelný záznam/);
  assert.match(app, /Prodejní proces/);
  assert.match(app, /Stavební stav/);
  assert.match(app, /Otevřít větší náhled/);
});
