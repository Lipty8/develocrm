import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("běžné obchodní akce nevystavují ruční rezervaci ani uvolnění smluvní rezervace",async()=>{
  const source=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
  const strip=source.split("\n").find(line=>line.includes('className="sales-action-strip"'));
  assert.ok(strip);
  assert.doesNotMatch(strip,/onSalesAction\("reservation"\)|onSalesAction\("convert"\)|Převést na rezervaci/);
  assert.match(strip,/hold\?\.type===\"pre_reservation\"&&canCancelHold/);
});
