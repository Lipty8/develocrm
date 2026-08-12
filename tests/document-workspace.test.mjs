import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root=new URL("../",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");

test("global Documents workspace exposes filters, detail, versions, history and concrete contexts",async()=>{
  const [app,repository,route]=await Promise.all([read("app/CRMApp.tsx"),read("app/repositories/document-repository.ts"),read("app/api/documents/route.ts")]);
  for(const component of ["DocumentsPage","DocumentDetail","DocumentCreateModal","DocumentEditModal","DocumentVersionModal","ClientDocuments"])assert.match(app,new RegExp(`function ${component}`));
  assert.match(app,/Typ dokumentu/);
  assert.match(app,/Historie dokumentu/);
  assert.match(app,/Fyzické verze/);
  assert.match(app,/Související záznamy/);
  assert.match(repository,/listParty/);
  assert.match(repository,/listContract/);
  assert.match(repository,/localStorage\.setItem\("develocrm\.documents\.edits"/);
  assert.match(route,/previewDocuments:DocumentRecord\[\]=\[\]/);
  assert.match(route,/source:"preview-adapter"/);
});

test("Contracts use a compact hybrid list and a real tabbed detail",async()=>{
  const app=await read("app/CRMApp.tsx");
  assert.match(app,/function ContractWorkspace/);
  assert.match(app,/function ContractDetail/);
  assert.match(app,/contract-hybrid-list/);
  assert.doesNotMatch(app,/DOPORUČENÁ AKCE/);
  for(const tab of ["Přehled","Historie","Verze","Dokumenty","Poznámky"])assert.match(app,new RegExp(`"${tab}"`));
  assert.match(app,/documentRepository\.listContract/);
  assert.match(app,/Samostatný workflow dokumentu, nikoli obchodní stav jednotky/);
});

test("document backend uses concrete links, RLS, audit and outbox",async()=>{
  const [migration,repository,api]=await Promise.all([read("backend/migrations/0010_document_workspace.sql"),read("backend/src/documents/repository.ts"),read("backend/src/app.ts")]);
  for(const table of ["document_types","sales_case_documents","document_events"])assert.match(migration,new RegExp(`CREATE TABLE ${table}`));
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(migration,/INSERT INTO (?:public\.)?audit_log/);
  assert.match(migration,/INSERT INTO (?:public\.)?outbox_events/);
  assert.match(repository,/listAll/);
  assert.match(repository,/createVersionV2/);
  assert.match(api,/\/v1\/documents/);
  assert.match(api,/\/sales-case-links/);
});
