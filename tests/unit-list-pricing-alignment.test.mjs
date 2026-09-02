import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const crm = fs.readFileSync(new URL("../app/CRMApp.tsx", import.meta.url), "utf8");
const catalogRoute = fs.readFileSync(new URL("../app/api/catalog/route.ts", import.meta.url), "utf8");
const inventoryRepository = fs.readFileSync(new URL("../backend/src/inventory/repository.ts", import.meta.url), "utf8");
const commercialRepository = fs.readFileSync(new URL("../backend/src/commercial/repository.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("projektový katalog načítá ceny jednotky i příslušenství dávkově z centrální projekce", () => {
  for (const priceFunction of ["app.current_unit_price", "app.current_unit_accessory_price", "app.current_unit_sales_price"]) {
    assert.match(inventoryRepository, new RegExp(priceFunction.replaceAll(".", "\\.")));
    assert.match(commercialRepository, new RegExp(priceFunction.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(commercialRepository, /Promise\.all\(Object\.keys\(priceHistories\)/);
});

test("BFF doplní ceny jedním kompatibilním commercial requestem i pro starší backend", () => {
  assert.match(catalogRoute, /Promise\.all\(\[/);
  assert.match(catalogRoute, /\/v1\/commercial/);
  assert.match(catalogRoute, /legacyBreakdown/);
  assert.match(catalogRoute, /priceConfigured:unitPrice!==null/);
});

test("chybějící cena se nezobrazuje jako nula a detail používá stejné části ceny", () => {
  assert.match(crm, /const formatOptionalMoney\s*=.*?"—"/s);
  assert.match(crm, /formatOptionalMoney\(prices\.unitPrice\)/);
  assert.match(crm, /formatOptionalMoney\(prices\.totalPrice\)/);
  assert.match(crm, /const detailPrices=unitPriceParts\(unit\)/);
  assert.match(crm, /formatOptionalMoney\(detailPrices\.totalPrice\)/);
});

test("zarovnání hlaviček a hodnot řídí sdílená metadata sloupců", () => {
  assert.match(crm, /\{id:"unit",label:"Jednotka".*?align:"center"/);
  for (const id of ["usableArea", "balcony", "terrace", "garden", "basePrice", "accessoryPrice", "totalPrice", "status", "client", "cellar", "parking"]) {
    assert.match(crm, new RegExp(`id:\"${id}\"[^}]*align:\"center\"`));
    assert.match(crm, new RegExp(`tableColumnClassName\\(unitTableColumns,\"${id}\"`));
  }
  assert.match(styles, /\.table-column-center\{text-align:center!important\}/);
  assert.doesNotMatch(styles, /\.table-column-start\{/);
});
