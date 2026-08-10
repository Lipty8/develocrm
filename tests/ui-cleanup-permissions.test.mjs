import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const app = fs.readFileSync(path.join(root, "app/CRMApp.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
const catalog = fs.readFileSync(path.join(root, "app/lib/permission-catalog.ts"), "utf8");

test("hlavní stránky nezobrazují obecný podtitulek a tabulky nemají výplňové patičky", () => {
  assert.match(app, /<h1>\{page === "dashboard"[\s\S]*?pageTitles\[page\]\.title\}<\/h1>\s*<\/div>/);
  assert.doesNotMatch(app, /Zobrazeno \{pageRows\.length\} z \{filtered\.length\}/);
  assert.doesNotMatch(app, /jedna společná databáze napříč firmou/);
  assert.doesNotMatch(app, /Stejný datový zdroj jako kalendář/);
  assert.doesNotMatch(app, /CRM je zdrojem metadat a vazeb/);
  assert.match(app, /table-footer compact-pagination/);
  assert.match(app, /Předchozí jednotka/);
  assert.match(app, /Další jednotka/);
});

test("Dokumenty používají kombinovatelné filtry a řazení v hlavičkách sloupců", () => {
  assert.doesNotMatch(app, /document-central-toolbar/);
  for (const label of ["Dokument", "Typ", "Projekt", "Klient / jednotka", "Aktuální stav", "Poslední změna"]) {
    assert.match(app, new RegExp(`ListColumnFilter label="${label.replace("/", "\\/")}"`));
  }
  assert.match(app, /typeFilters=listParam\(params,"dtype"\)/);
  assert.match(app, /statusFilters=listParam\(params,"dstatus"\)/);
  assert.match(app, /projectFilters=listParam\(params,"dproject"\)/);
  assert.match(app, /dtype:values/);
  assert.match(app, /dproject:values/);
  assert.match(app, /dstatus:values/);
  assert.match(app, /dsort:"status",ddir:next/);
});

test("Budoucí předání používá URL filtry přímo v hlavičkách a kalendář zůstává oddělený", () => {
  assert.doesNotMatch(app, /className="module-toolbar handover-filters"/);
  for (const label of ["Termín", "Jednotka a klient", "Odpovědná osoba", "Připravenost", "Stav", "Upozornění"]) {
    assert.match(app, new RegExp(`ListColumnFilter label="${label}"`));
  }
  assert.match(app, /projectFilters=listParam\(searchParams,"project"\)/);
  assert.match(app, /ownerFilters=listParam\(searchParams,"owner"\)/);
  assert.match(app, /warningFilters=listParam\(searchParams,"warning"\)/);
  assert.match(app, /readyFrom/);
  assert.match(app, /dateFrom/);
  assert.match(app, /const calendarRows=stableSort\(rows/);
  assert.match(app, /const futureRows=sorted\.filter/);
});

test("centrální katalog pokrývá všechna databázová oprávnění českým názvem", () => {
  const migrationDir = path.join(root, "backend/migrations");
  const permissionCodes = new Set();
  for (const file of fs.readdirSync(migrationDir).filter(name => name.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    for (const block of sql.matchAll(/INSERT INTO permissions[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/gi)) {
      for (const match of block[1].matchAll(/\('([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g)) permissionCodes.add(match[1]);
    }
  }
  const catalogCodes = new Set([...catalog.matchAll(/\{key:"([^"]+)"/g)].map(match => match[1]));
  assert.ok(permissionCodes.size > 50, `Očekáváno více než 50 oprávnění, nalezeno ${permissionCodes.size}`);
  assert.deepEqual([...permissionCodes].filter(code => !catalogCodes.has(code)), []);
  assert.doesNotMatch(catalog, /name:"[^"]*(sales_cases|commercial_exceptions|accessories\.)/i);
  for (const category of ["Obchodní případy", "Jednotky a příslušenství", "Obchodní výjimky", "Uživatelé a role", "Exporty a audit"]) {
    assert.match(catalog, new RegExp(`"${category}"`));
  }
});

test("technické klíče jsou jen volitelný sekundární řádek a fallback je bezpečný", () => {
  assert.match(app, /const \[showTechnical,setShowTechnical\]=useState\(false\)/);
  assert.match(app, /showTechnical&&<code>Technický klíč: \{permission\.key\}<\/code>/);
  assert.match(app, /showTechnical&&<code>Technický klíč: \{item\.definition\.key\}<\/code>/);
  assert.match(catalog, /name: "Další systémové oprávnění"/);
  assert.match(catalog, /console\.warn\(`\[DeveloCRM\] Chybí český katalog oprávnění/);
  assert.doesNotMatch(app, /effective\.join\(" · "\)/);
});

test("efektivní oprávnění a detail role jsou seskupené, čitelné a responzivní", () => {
  assert.match(app, /Efektivní oprávnění \(\{effective\.length\}\)/);
  assert.match(app, /Získáno z role:/);
  assert.match(app, /Rozsah: \{permissionScopeLabel/);
  assert.match(app, /permissionCategoryOrder\.map/);
  assert.match(app, /permissionOperationOrder\.indexOf/);
  assert.match(css, /\.permission-editor\.grouped strong[^}]*white-space:normal/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:650px\)[^{]*\{[^}]*\.effective-permissions-head/s);
  assert.match(css, /\.permission-editor\.grouped\{max-height:520px/);
  assert.match(app, /className="modal form-modal"/);
  assert.match(css, /\.form-modal\s*\{[^}]*max-height:calc\(100dvh - 40px\)/s);
  assert.match(css, /\.form-modal>\.modal-form\s*\{[^}]*overflow-y:auto/s);
});
