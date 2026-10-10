import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("správa šablon používá jednoduchý lifecycle a syntetický náhled bez technických Graph polí", async () => {
  const app = await readFile(new URL("../app/CRMApp.tsx", import.meta.url), "utf8");
  assert.match(app, /Šablony dokumentů/);
  assert.match(app, /Nahrát novou verzi/);
  assert.match(app, /Znovu validovat/);
  assert.match(app, /Testovací náhled/);
  assert.match(app, /Schválit/);
  assert.match(app, /Archivovat verzi/);
  assert.doesNotMatch(app, /externalVersionId/);
  assert.doesNotMatch(app, /driveId/);
  assert.doesNotMatch(app, /itemId/);
});

test("BFF nepřijímá siteId, driveId ani Graph URL od klienta", async () => {
  const route = await readFile(new URL("../app/api/document-templates/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /siteId/);
  assert.doesNotMatch(route, /driveId/);
  assert.doesNotMatch(route, /graphUrl/);
  assert.match(route, /\/v1\/document-templates/);
});
