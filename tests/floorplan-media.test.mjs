import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateMediaFile } from "../app/lib/media-validation.ts";

const mb = value => value * 1024 * 1024;
const file = (name, type, size = 1024) => ({ name, type, size });

test("půdorys přijímá podporované obrázky a PDF s odpovídající příponou", () => {
  for (const candidate of [
    file("pudorys.jpg", "image/jpeg"),
    file("pudorys.jpeg", "image/jpeg"),
    file("pudorys.png", "image/png"),
    file("pudorys.webp", "image/webp"),
    file("pudorys.pdf", "application/pdf"),
  ]) assert.doesNotThrow(() => validateMediaFile(candidate, "floorplan"));
});

test("titulní obrázek nepřijímá PDF a MIME musí odpovídat příponě", () => {
  assert.throws(() => validateMediaFile(file("cover.pdf", "application/pdf"), "cover"), /Nepodporovaný formát/);
  assert.throws(() => validateMediaFile(file("pudorys.pdf", "image/png"), "floorplan"), /Nepodporovaný formát/);
  assert.throws(() => validateMediaFile(file("pudorys.png", "application/pdf"), "floorplan"), /Nepodporovaný formát/);
});

test("limity rozlišují 12 MB pro obrázek a 25 MB pro PDF", () => {
  assert.doesNotThrow(() => validateMediaFile(file("pudorys.png", "image/png", mb(12)), "floorplan"));
  assert.throws(() => validateMediaFile(file("pudorys.png", "image/png", mb(12) + 1), "floorplan"), /příliš velký/);
  assert.doesNotThrow(() => validateMediaFile(file("pudorys.pdf", "application/pdf", mb(25)), "floorplan"));
  assert.throws(() => validateMediaFile(file("pudorys.pdf", "application/pdf", mb(25) + 1), "floorplan"), /příliš velký/);
});

test("UI obsahuje PDF preview, skutečné stažení a náhradu aktivního půdorysu", async () => {
  const [app, route, fileRoute] = await Promise.all([
    readFile(new URL("../app/CRMApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/file/[...key]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Nahrát půdorys/);
  assert.match(app, /application\/pdf/);
  assert.match(app, /Náhled první stránky PDF/);
  assert.match(app, /download=1/);
  assert.match(route, /env\.FILES\.delete\(objectKey\)/);
  assert.match(route, /uploadedAt/);
  assert.match(route, /fileName/);
  assert.match(fileRoute, /content-disposition/);
  assert.match(fileRoute, /x-content-type-options/);
});
