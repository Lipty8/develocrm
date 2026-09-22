import assert from "node:assert/strict";
import test from "node:test";
import { ManagedIdentityGraphTokenProvider } from "../src/documents/managed-identity-token-provider.js";

test("Container Apps identity token targets Graph and the selected user-assigned identity", async () => {
  let requested = 0;
  const request = async (input: URL | RequestInfo, init?: RequestInit) => {
    requested += 1;
    const url = new URL(String(input));
    assert.equal(url.origin, "http://127.0.0.1:42356");
    assert.equal(url.searchParams.get("api-version"), "2019-08-01");
    assert.equal(url.searchParams.get("resource"), "https://graph.microsoft.com");
    assert.equal(url.searchParams.get("client_id"), "chosen-identity");
    assert.equal(new Headers(init?.headers).get("x-identity-header"), "identity-secret");
    return new Response(JSON.stringify({ access_token: "graph-token", expires_on: "1900000000" }), { status: 200 });
  };
  const provider = new ManagedIdentityGraphTokenProvider("chosen-identity", {
    IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
    IDENTITY_HEADER: "identity-secret",
  }, request as typeof fetch, () => 1_700_000_000_000);
  assert.equal(await provider.getAccessToken(), "graph-token");
  assert.equal(await provider.getAccessToken(), "graph-token");
  assert.equal(requested, 1);
});

test("missing identity environment and failed token requests fail closed", async () => {
  const unavailable = new ManagedIdentityGraphTokenProvider("chosen-identity", {});
  await assert.rejects(unavailable.getAccessToken(), /není dostupná/);
  const rejected = new ManagedIdentityGraphTokenProvider("chosen-identity", {
    IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
    IDENTITY_HEADER: "identity-secret",
  }, (async () => new Response("denied", { status: 403 })) as typeof fetch);
  await assert.rejects(rejected.getAccessToken(), /403/);
});

test("missing token and expired token are not reused", async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    return new Response(JSON.stringify({ access_token: `token-${calls}`, expires_in: 30 }), { status: 200 });
  };
  const provider = new ManagedIdentityGraphTokenProvider("chosen-identity", {
    IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
    IDENTITY_HEADER: "identity-secret",
  }, request as typeof fetch, () => 1_700_000_000_000);
  assert.equal(await provider.getAccessToken(), "token-1");
  assert.equal(await provider.getAccessToken(), "token-2");
  assert.equal(calls, 2);
  const invalid = new ManagedIdentityGraphTokenProvider("chosen-identity", {
    IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
    IDENTITY_HEADER: "identity-secret",
  }, (async () => new Response("{}", { status: 200 })) as typeof fetch);
  await assert.rejects(invalid.getAccessToken(), /nevrátila platný Graph token/);
});
