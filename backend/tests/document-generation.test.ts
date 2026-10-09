import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DocumentTemplateGenerationService, DocumentGenerationError } from "../src/documents/template-generation-service.js";
import { DocumentTemplateGenerationRepository } from "../src/documents/template-generation-repository.js";
import { DocxTemplateError, inspectDocxTemplate } from "../src/documents/docx-template.js";

const context={tenantId:"10000000-0000-4000-8000-000000000001",userId:"20000000-0000-4000-8000-000000000001",membershipId:"30000000-0000-4000-8000-000000000001"};
const projectId="40000000-0000-4000-8000-000000000001";const templateVersionId="50000000-0000-4000-8000-000000000001";
function docx(text:string){return zipSync({"[Content_Types].xml":strToU8("<Types/>"),"word/document.xml":strToU8(`<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)});}
function hash(bytes:Uint8Array){return`sha256:${createHash("sha256").update(bytes).digest("hex")}`;}
const schema={fields:{"project.name":{required:true},"unit.code":{required:true},"buyer.name":{required:true}}};

function harness(options:{source?:Uint8Array;snapshot?:Record<string,string>;uploadError?:Error;completed?:boolean;templateHash?:string}={}){
  const source=options.source??docx("Projekt {{project.name}}, jednotka {{unit.code}}, klient {{buyer.name}}");let uploads=0,completions=0;
  const template={templateId:"template",templateVersionId,projectId,templateCode:"technical-test",templateName:"Technický test",outputTypeCode:"other",versionLabel:"v1",
    contentHash:options.templateHash??hash(source),schema,driveId:"drive",itemId:"item",externalVersionId:"1.0"};
  const operation={id:"operation",state:options.completed?"completed":"reserved",projectId,template,snapshot:options.snapshot??{"project.name":"Hrdlička","unit.code":"417","buyer.name":"Jan Novák"},
    outputDocumentId:options.completed?"document":null,outputDocumentVersionId:options.completed?"version":null,unitId:"unit",partyId:"party",salesCaseId:null,contractId:null,createdAt:"2026-10-08T10:00:00.000Z"} as const;
  const repository={sourceForRegistration:async()=>({projectId,driveId:"drive",itemId:"item",externalVersionId:"1.0",contentHash:hash(source)}),register:async()=>({templateId:"template",templateVersionId}),
    getTemplate:async()=>template,reserve:async()=>operation,complete:async()=>{completions++;}};
  const documents={getConnectionForUpload:async()=>({siteId:"site",driveId:"drive"})};
  const graph={downloadFile:async()=>source};
  const uploadsService={upload:async(input:{bytes:Uint8Array})=>{uploads++;if(options.uploadError)throw options.uploadError;assert.deepEqual(inspectDocxTemplate(input.bytes).tokens,[]);
    const xml=strFromU8(unzipSync(input.bytes)["word/document.xml"]);assert.match(xml,/Hrdlička/);assert.match(xml,/417/);assert.match(xml,/Jan Novák/);
    return{documentId:"document",documentVersionId:"version",replayed:false};}};
  return{service:new DocumentTemplateGenerationService(repository as never,documents as never,uploadsService as never,graph as never),get uploads(){return uploads;},get completions(){return completions;}};
}

test("registrace pinuje hash skutečných bajtů uložených v SharePointu",async()=>{
  const source=docx("Projekt {{project.name}}, jednotka {{unit.code}}, klient {{buyer.name}}");let storedHash="";
  const h=harness({source});const repository=(h.service as unknown as {repository:{sourceForRegistration:()=>Promise<Record<string,unknown>>;register:(input:{contentHash:string})=>Promise<Record<string,string>>}}).repository;
  repository.sourceForRegistration=async()=>({projectId,driveId:"drive",itemId:"item",externalVersionId:"1.0",contentHash:"sha256:"+"0".repeat(64)});
  repository.register=async input=>{storedHash=input.contentHash;return{templateId:"template",templateVersionId};};
  await h.service.register({...context,projectId,code:"technical",name:"Technical",outputTypeCode:"other",versionLabel:"v1",sourceDocumentId:"d",sourceDocumentVersionId:"v",schema});
  assert.equal(storedHash,hash(source));
});

test("validní generování používá strict renderer a existující upload service",async()=>{const h=harness();const result=await h.service.generate({...context,projectId,templateVersionId,idempotencyKey:"generation-test-01"});assert.equal(result.documentId,"document");assert.equal(h.uploads,1);assert.equal(h.completions,1);});
test("retry dokončené operace nevytvoří druhý upload",async()=>{const h=harness({completed:true});const result=await h.service.generate({...context,projectId,templateVersionId,idempotencyKey:"generation-test-02"});assert.equal(result.replayed,true);assert.equal(h.uploads,0);});
test("chybějící povinná hodnota zastaví render",async()=>{const h=harness({snapshot:{"project.name":"Hrdlička","unit.code":"417"}});await assert.rejects(h.service.generate({...context,projectId,templateVersionId,idempotencyKey:"generation-test-03"}),e=>e instanceof DocxTemplateError&&e.code==="template_value_missing");assert.equal(h.uploads,0);});
test("změněný obsah immutable šablony je odmítnut podle hashe",async()=>{const h=harness({templateHash:"sha256:"+"0".repeat(64)});await assert.rejects(h.service.generate({...context,projectId,templateVersionId,idempotencyKey:"generation-test-04"}),e=>e instanceof DocumentGenerationError&&e.code==="template_hash_mismatch");});
test("Graph/upload failure ponechá generování nedokončené pro bezpečný retry",async()=>{const h=harness({uploadError:new Error("graph timeout")});await assert.rejects(h.service.generate({...context,projectId,templateVersionId,idempotencyKey:"generation-test-05"}),/graph timeout/);assert.equal(h.completions,0);});
test("generování vyžaduje skutečné ID neměnné SharePoint verze šablony",async()=>{
  const h=harness();(h.service as unknown as {repository:{getTemplate:()=>Promise<Record<string,unknown>>}}).repository.getTemplate=async()=>({
    templateId:"template",templateVersionId,projectId,templateCode:"technical-test",templateName:"Technický test",outputTypeCode:"other",versionLabel:"v1",
    contentHash:hash(docx("x")),schema,driveId:"drive",itemId:"item",externalVersionId:null,
  });
  await assert.rejects(h.service.generate({...context,projectId,templateVersionId,idempotencyKey:"generation-test-06"}),e=>e instanceof DocumentGenerationError&&e.code==="template_source_version_unavailable");
});
test("registrace odmítne neznámý placeholder a poškozený DOCX",async()=>{
  const unknown=harness({source:docx("{{internal.secret}}")});await assert.rejects(unknown.service.register({...context,projectId,code:"technical",name:"Technical",outputTypeCode:"other",versionLabel:"v1",sourceDocumentId:"d",sourceDocumentVersionId:"v",schema:{fields:{"internal.secret":{required:true}}}}),e=>e instanceof DocumentGenerationError&&e.code==="invalid_schema");
  const corrupt=harness({source:new TextEncoder().encode("not-docx")});await assert.rejects(corrupt.service.register({...context,projectId,code:"technical",name:"Technical",outputTypeCode:"other",versionLabel:"v1",sourceDocumentId:"d",sourceDocumentVersionId:"v",schema}),e=>e instanceof DocxTemplateError&&e.code==="invalid_docx");
});
test("persistence vrstva vynucuje tenant, projekt, append-only template verze a neměnný snapshot",async()=>{
  const migration=await readFile(new URL("../migrations/0052_document_template_generation.sql",import.meta.url),"utf8");
  assert.match(migration,/document_generation_unit_fk FOREIGN KEY\(tenant_id,project_id,unit_id\)/);
  assert.match(migration,/document_generation_output_version_fk FOREIGN KEY\(tenant_id,project_id,output_document_id,output_document_version_id\)/);
  assert.match(migration,/document_template_versions_append_only/);
  assert.match(migration,/document_generation_snapshot_immutable/);
  assert.match(migration,/FORCE ROW LEVEL SECURITY/g);
  const repository=await readFile(new URL("../src/documents/template-generation-repository.ts",import.meta.url),"utf8");
  assert.match(repository,/SELECT \$1::uuid,\$3::uuid,\$4::text,\$5::text,\$6::text,\$7::text,\$2::uuid/);
  assert.match(repository,/idempotency_key=\$2`,\[input\.tenantId,input\.idempotencyKey\]/);
});

test("idempotentní registrace šablony nemá mezery v prepared-statement parametrech",async()=>{
  const calls:Array<{sql:string;values:unknown[]}>=[];let step=0;
  const client={query:async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});step++;
    if(step===1)return{rows:[{id:"60000000-0000-4000-8000-000000000001"}]};
    if(step===2)return{rows:[]};
    if(step===3)return{rows:[{id:templateVersionId}]};
    return{rows:[]};}};
  const database={withContext:async(_context:unknown,work:(input:typeof client)=>Promise<unknown>)=>work(client)};
  const repository=new DocumentTemplateGenerationRepository(database as never);
  const result=await repository.register({...context,projectId,code:"technical",name:"Technická šablona",outputTypeCode:"other",versionLabel:"v1",sourceDocumentId:"70000000-0000-4000-8000-000000000001",sourceDocumentVersionId:"70000000-0000-4000-8000-000000000002",contentHash:"sha256:test",schema,approvalStatus:"approved",effectiveFrom:"2026-10-09"});
  assert.equal(result.templateVersionId,templateVersionId);
  for(const call of calls){const indexes=[...call.sql.matchAll(/\$(\d+)/g)].map(match=>Number(match[1]));const max=Math.max(0,...indexes);assert.equal(max,call.values.length);for(let index=1;index<=max;index++)assert.ok(indexes.includes(index),`SQL chybí parametr $${index}`);}
});
