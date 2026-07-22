import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("project and unit Documents tabs use one repository without redesigning routing", async () => {
  const [app, repository, route] = await Promise.all([
    read("app/CRMApp.tsx"), read("app/repositories/document-repository.ts"), read("app/api/documents/route.ts"),
  ]);
  assert.match(app, /function ProjectDocuments/);
  assert.match(app, /function UnitDocuments/);
  assert.match(app, /documentRepository\.listProject/);
  assert.match(app, /documentRepository\.listUnit/);
  assert.match(app, /Kategorie/);
  assert.match(app, /Jednotka/);
  assert.match(app, /Klient/);
  assert.match(repository, /mediaDocument/);
  assert.match(repository, /category:"floor_plan"/);
  assert.match(route, /DEVELOCRM_API_URL/);
  assert.match(route, /source:"preview-adapter"/);
});

test("preview does not claim SharePoint persistence and keeps media adapter", async () => {
  const [app, route, media] = await Promise.all([
    read("app/CRMApp.tsx"), read("app/api/documents/route.ts"), read("app/repositories/media-repository.ts"),
  ]);
  assert.match(app, /SharePoint zatím není připojen/);
  assert.match(app, /Žádný soubor se nevydává za nahraný na SharePoint/);
  assert.doesNotMatch(app, /SharePoint synchronizován/);
  assert.match(route, /webUrl:null/);
  assert.match(media, /\/api\/media/);
});

test("backend keeps concrete document links and separate physical versions", async () => {
  const [migration, graph, generation, sync] = await Promise.all([
    read("backend/migrations/0009_documents_sharepoint_foundation.sql"),
    read("backend/src/documents/graph-adapter.ts"),
    read("backend/src/documents/generation-contract.ts"),
    read("backend/src/documents/sync-service.ts"),
  ]);
  for (const table of ["project_documents", "unit_documents", "party_documents", "contract_documents", "document_versions"]) assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  assert.doesNotMatch(migration, /CREATE TABLE document_links/);
  assert.match(graph, /class PreviewGraphAdapter/);
  assert.match(graph, /class EntraMicrosoftGraphAdapter/);
  assert.match(generation, /ContractDocumentGenerationPort/);
  assert.match(sync, /applyPageAtomically/);
  assert.match(sync, /planDocumentDelta/);
});
