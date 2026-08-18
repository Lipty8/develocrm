import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const appUrl=new URL("../app/CRMApp.tsx",import.meta.url);
const catalogUrl=new URL("../app/api/catalog/route.ts",import.meta.url);

test("kritické MVP akce otevírají skutečné formuláře",async()=>{const source=await readFile(appUrl,"utf8");for(const expected of ["setNewClientOpen(true)","setNewHandoverOpen(true)","setNewContractOpen(true)","NewClientModal","HandoverScheduleModal","NewContractModal","notify={onNewClient??notify}"])assert.ok(source.includes(expected));});
test("RS workflow zpřístupňuje verzi, jedinou akci podpisu a backendové stránkování klientů",async()=>{const source=await readFile(appUrl,"utf8");for(const expected of ["ContractVersionModal","ContractSignedModal","signContract","clientRepository.getPage","Označit jako podepsané"])assert.ok(source.includes(expected));assert.doesNotMatch(source,/ContractSignatureModal/);const repository=await readFile(new URL("../app/repositories/commercial-repository.ts",import.meta.url),"utf8");assert.match(repository,/createContractVersion/);assert.match(repository,/signContract/);assert.doesNotMatch(repository,/recordContractSignature/);});
test("produkční katalog nedoplňuje klienta cenu ani předání z preview jednotek",async()=>{const source=await readFile(catalogUrl,"utf8");const adapter=source.slice(source.indexOf("function adaptBackendCatalog"));assert.doesNotMatch(adapter,/preview\?\.(price|client|handover|attention)/);assert.match(adapter,/backendId:project\.id/);});
test("navigace nulováním detailu neukazuje předchozí entitu",async()=>{const source=await readFile(appUrl,"utf8");assert.match(source,/setSelectedProject\(project\?\?null\)/);assert.match(source,/setUnitDetail\(unit\?\?null\)/);});
