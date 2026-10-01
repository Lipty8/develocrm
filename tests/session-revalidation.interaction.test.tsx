import assert from "node:assert/strict";
import test from "node:test";
import { shouldRevalidateSession } from "../app/lib/session-revalidation";

test("návrat fokusu po krátkém výběru souboru neobnoví relaci",()=>{
  assert.equal(shouldRevalidateSession(0,100_000),false);
  assert.equal(shouldRevalidateSession(95_000,100_000),false);
});

test("relace se obnoví po delším pobytu na pozadí nebo po 401",()=>{
  assert.equal(shouldRevalidateSession(30_000,100_000),true);
  assert.equal(shouldRevalidateSession(0,100_000,true),true);
});
