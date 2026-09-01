import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import type {Database,SqlClient} from "../src/database.js";
import {InventoryImportService} from "../src/inventory/import-service.js";
import {PaymentRepository} from "../src/payments/repository.js";

const context={tenantId:"10000000-0000-4000-8000-000000000001",userId:"20000000-0000-4000-8000-000000000001",membershipId:"30000000-0000-4000-8000-000000000001",projectId:"40000000-0000-4000-8000-000000000002"};

function database(query:(text:string,values?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number}>):Database{
  const fake={query:query as SqlClient["query"]};
  return{withContext:async<T>(_context:unknown,work:(client:SqlClient)=>Promise<T>)=>work(fake)} as unknown as Database;
}

test("náhled importu pracuje pouze s jednotkami cílového projektu",async()=>{
  const db=database(async(text,values)=>{
    if(text.includes("has_project_permission"))return{rows:[{allowed:true}],rowCount:1};
    if(text.includes("FROM units WHERE")&&text.includes("commercial_status"))return{rows:[],rowCount:0};
    if(text.includes("SELECT code FROM units")){assert.equal(values?.[1],context.projectId);return{rows:[{code:"B101"}],rowCount:1};}
    throw new Error(`Unexpected query: ${text}`);
  });
  const preview=await new InventoryImportService(db).preview({...context,entityType:"unit",rows:[{rowNumber:2,code:"101",areaM2:72,price:8_000_000,commercialStatus:"Volný"}],strategy:"update"});
  assert.equal(preview.summary.created,1);assert.equal(preview.summary.errors,0);
});

test("přiřazení příslušenství odmítne jednotku z jiného projektu",async()=>{
  const db=database(async(text)=>{
    if(text.includes("has_project_permission"))return{rows:[{allowed:true}],rowCount:1};
    if(text.includes("FROM accessories accessory"))return{rows:[],rowCount:0};
    if(text.includes("SELECT code FROM units"))return{rows:[{code:"B101"}],rowCount:1};
    throw new Error(`Unexpected query: ${text}`);
  });
  const preview=await new InventoryImportService(db).preview({...context,entityType:"cellar",rows:[{rowNumber:2,code:"S1",areaM2:3,price:200_000,unitCode:"A101"}],strategy:"update"});
  assert.equal(preview.summary.unknownUnits,1);assert.match(preview.rows[0].errors.join(" "),/tomto projektu neexistuje/);
});

test("platební repository předává UUID projektu do databázového filtru",async()=>{
  let parameters:unknown[]=[];const db=database(async(_text,values)=>{parameters=values??[];return{rows:[],rowCount:0};});
  await new PaymentRepository(db).list({...context});
  assert.equal(parameters[2],context.projectId);
});

test("import hlásí chybějící povinná pole a duplicity",async()=>{
  const db=database(async(text)=>{
    if(text.includes("has_project_permission"))return{rows:[{allowed:true}],rowCount:1};
    if(text.includes("FROM accessories accessory"))return{rows:[],rowCount:0};
    if(text.includes("SELECT code FROM units"))return{rows:[],rowCount:0};
    throw new Error(`Unexpected query: ${text}`);
  });
  const preview=await new InventoryImportService(db).preview({...context,entityType:"cellar",rows:[{rowNumber:2,code:"S1",price:100_000},{rowNumber:3,code:"S1",price:100_000}],strategy:"update"});
  assert.equal(preview.summary.duplicates,2);
  assert.equal(preview.summary.missingFields,2);
  assert.equal(preview.summary.errors,2);
});

test("migrační tabulka importů má vynucené RLS",async()=>{
  const db=new PGlite();const directory=new URL("../migrations/",import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,directory),"utf8"));
  const result=await db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='project_inventory_import_batches'");
  assert.deepEqual(result.rows[0],{relrowsecurity:true,relforcerowsecurity:true});
  await db.close();
});
