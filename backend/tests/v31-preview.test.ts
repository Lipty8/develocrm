import assert from "node:assert/strict";
import test from "node:test";
import { rememberClientDataMode } from "../../app/lib/data-mode.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

test("preview adapter ihned přepočítá smlouvu, uloží historii a přežije nové načtení", async () => {
  rememberClientDataMode("prototype-fallback");
  const storage = new MemoryStorage();
  Object.assign(globalThis, { window: {}, localStorage: storage });
  const contract = {
    id: "preview-contract-test",
    project: "Rezidence Dejvice",
    unit: "D101",
    client: "Jan Novák",
    type: "SBK",
    state: "V přípravě",
    statusCode: "draft",
    updated: "2026-07-01T08:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    owner: "Iva",
    action: "Odeslat SBK",
    title: "SBK D101",
    reference: "SBK-D101",
    history: [],
    parties: [],
    versions: [],
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/status")) return new Response(null, { status: 503 });
    if (url.includes("/api/commercial")) return Response.json({
      currentPrices: {},
      priceHistories: {},
      contracts: [structuredClone(contract)],
      contractSummary: {},
      source: "preview-seed",
    });
    return new Response(null, { status: 503 });
  }) as typeof fetch;
  const { commercialRepository } = await import("../../app/repositories/commercial-repository.js");
  await commercialRepository.transitionContract({
    contractId: contract.id,
    to: "sent",
    reason: "Odesláno klientovi",
    actorName: "Iva Novotná",
  });
  const snapshot = await commercialRepository.getSnapshot();
  assert.equal(snapshot.contracts[0].statusCode, "sent");
  assert.equal(snapshot.contracts[0].action, "Zkontrolovat reakci klienta");
  assert.equal(snapshot.contracts[0].history?.[0].fromStatus, "draft");
  assert.equal(snapshot.contracts[0].history?.[0].toStatus, "sent");
  assert.equal(snapshot.contracts[0].history?.[0].actor, "Iva Novotná");
  assert.equal(snapshot.contracts[0].history?.[0].source, "manual");
});

test("preview administrace perzistentně pozve a upraví uživatele bez lokálního hesla", async () => {
  rememberClientDataMode("prototype-fallback");
  const storage = new MemoryStorage();
  Object.assign(globalThis, { window: {}, localStorage: storage });
  globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
  const { adminRepository } = await import("../../app/repositories/admin-repository.js");
  await adminRepository.invite({
    name: "Jana Nová",
    email: "jana@example.test",
    jobTitle: "Finance",
    workPhone: "+420 222 333 444",
    status: "invited",
    roleIds: ["role-finance"],
    projectIds: ["DEJ"],
  });
  const invited = (await adminRepository.getSnapshot()).users.find(user => user.email === "jana@example.test");
  assert.ok(invited);
  assert.equal(invited.status, "invited");
  await adminRepository.update({ ...invited, status: "active", projectIds: ["DEJ", "RJ"] });
  const updated = (await adminRepository.getSnapshot()).users.find(user => user.email === "jana@example.test");
  assert.equal(updated?.status, "active");
  assert.deepEqual(updated?.projectIds, ["DEJ", "RJ"]);
  assert.equal("password" in (updated ?? {}), false);
});

test("kalendář a seznam preview předání používají jeden dynamický zdroj", async () => {
  rememberClientDataMode("prototype-fallback");
  Object.assign(globalThis, { window: {}, localStorage: new MemoryStorage() });
  globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
  const { handoverRepository } = await import("../../app/repositories/handover-repository.js");
  const records = await handoverRepository.list({});
  assert.ok(records.length > 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  assert.ok(records.every(record => new Date(record.scheduledAt).getTime() >= today.getTime()));
  assert.ok(records.every(record => record.project && record.unit && record.client && record.owner && record.status));
});
