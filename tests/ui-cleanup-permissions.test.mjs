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
  assert.doesNotMatch(app, /table-footer compact-pagination/);
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

test("technické klíče zůstávají jen ve volitelné diagnostice role a fallback je bezpečný", () => {
  assert.match(app, /const \[showTechnical,setShowTechnical\]=useState\(false\)/);
  assert.match(app, /showTechnical&&<code>\{permission\.key\}<\/code>/);
  assert.doesNotMatch(app, /showTechnical&&<code>Technický klíč: \{item\.definition\.key\}<\/code>/);
  assert.match(app, /Technické názvy/);
  assert.match(catalog, /name: "Další systémové oprávnění"/);
  assert.match(catalog, /console\.warn\(`\[DeveloCRM\] Chybí český katalog oprávnění/);
  assert.doesNotMatch(app, /effective\.join\(" · "\)/);
});

test("editace uživatele končí projektovým rozsahem a neobsahuje permission diagnostiku", () => {
  const userModal = app.slice(app.indexOf("function AdminUserModal"), app.indexOf("function RolePermissionsModal"));
  assert.doesNotMatch(userModal, /Efektivní oprávnění|Detail oprávnění|Získáno z role|Z role:|Rozsah:|Technický klíč|permissionScopeLabel|permission-disclosure|effective-permissions/);
  assert.doesNotMatch(userModal, /permissionCodes\.includes|permissionGrants/);
  assert.match(userModal, /<fieldset className="admin-check-grid role-selection"><legend>Role<\/legend>/);
  assert.match(userModal, /<fieldset className="admin-check-grid"><legend>Projektový rozsah<\/legend>/);
  assert.match(userModal, /roleAccessSummary\(role\)/);
  for (const category of ["Projekty", "Jednotky a příslušenství", "Klienti", "Smlouvy", "Platby", "Předání a reklamace", "Dokumenty", "Úkoly", "Administrace"]) {
    assert.match(app, new RegExp(`"${category.replace(" a ", " a ")}"`));
  }
  assert.match(app, /function roleAccessSummary\(role:AdminRole\)/);
  assert.match(app, /role\.permissionCodes\.some/);
  assert.match(app, /Všechny hlavní oblasti CRM/);
  assert.match(app, /Pouze zobrazení napříč CRM/);
  assert.doesNotMatch(css, /\.permission-disclosure/);
  assert.match(css, /\.role-selection small/);
});

test("správa role používá kompaktní funkční oblasti a volitelnou technickou diagnostiku", () => {
  const roleModal = app.slice(app.indexOf("function RolePermissionsModal"), app.indexOf("function UnitPreview"));
  assert.match(roleModal, /Přístup podle oblastí/);
  assert.match(roleModal, /className="role-permission-areas"/);
  assert.match(roleModal, /effectivePermissionCategoryOrder\.map/);
  assert.match(roleModal, /effectivePermissionCategory\(permission\.category\)/);
  assert.match(app, /permissionOperationOrder\.indexOf/);
  assert.match(roleModal, /showTechnical&&<code>\{permission\.key\}<\/code>/);
  assert.doesNotMatch(roleModal, /<small>\{permission\.description\}<\/small>/);
  assert.match(roleModal, /title=\{permission\.description\}/);
  assert.match(css, /\.role-permission-areas\{[^}]*max-height:520px/);
  assert.match(css, /\.role-permission-areas>section>div\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(app, /className=\{`modal form-modal \$\{className\}`\}/);
  assert.match(css, /\.form-modal\s*\{[^}]*max-height:calc\(100dvh - 40px\)/s);
  assert.match(css, /\.form-modal>\.modal-form\s*\{[^}]*overflow-y:auto/s);
});

test("sdílený modal ani administrace nevysvětlují interní implementaci", () => {
  assert.doesNotMatch(app, /Změna se uloží přes řízenou doménovou operaci/);
  assert.match(app, /\{subtitle&&<p>\{subtitle\}<\/p>\}/);
  assert.doesNotMatch(app, /Efektivní práva jsou vynucena backendem a RLS/);
  assert.doesNotMatch(app, /Projektový rozsah i role jsou kontrolovány také na backendu/);
  assert.doesNotMatch(app, /Každá změna se zapisuje do auditu a outboxu/);
  assert.doesNotMatch(app, /Přihlášený uživatel a jeho efektivní oprávnění/);
  assert.doesNotMatch(app, /Tenantová role umožňuje/);
});

test("zjednodušený formulář zachovává role, projekty i původní RBAC payload", () => {
  for (const label of ["Jméno", "Pracovní e-mail", "Pracovní pozice", "Pracovní telefon", "Stav přístupu", "Role", "Projektový rozsah"]) {
    assert.match(app, new RegExp(`>${label}<`));
  }
  assert.match(app, /await save\(\{name,email,jobTitle,workPhone,status,roleIds,projectIds\}\)/);
  assert.match(app, /checked=\{roleIds\.includes\(role\.id\)\}/);
  assert.match(app, /checked=\{projectIds\.includes\(project\.id\)\}/);
});
