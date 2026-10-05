import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root=process.cwd();
const app=fs.readFileSync(path.join(root,"app/CRMApp.tsx"),"utf8");
const repository=fs.readFileSync(path.join(root,"app/repositories/admin-repository.ts"),"utf8");
const auth=fs.readFileSync(path.join(root,"app/lib/entra-auth.ts"),"utf8");
const backend=fs.readFileSync(path.join(root,"backend/src/iam/repository.ts"),"utf8");

test("přidání uživatele používá Entra picker a netvoří pending identitu",()=>{
  const modal=app.slice(app.indexOf("function AdminUserModal"),app.indexOf("function RolePermissionsModal"));
  assert.match(app,/Přidat uživatele/);
  assert.match(modal,/Jméno nebo e-mail/);
  assert.match(modal,/Vyhledávám…/);
  assert.match(modal,/Žádný uživatel nenalezen/);
  assert.match(modal,/Tento uživatel už má přístup do DeveloCRM/);
  assert.doesNotMatch(modal,/Entra Object ID|Issuer|Tenant ID|Graph API|delegated permission/i);
  const addMember=backend.slice(backend.indexOf("async addMember"),backend.indexOf("async updateMember"));
  assert.match(addMember,/entraObjectId/);
  assert.match(addMember,/VALUES\(\$1,\$2,\$3,'active',now\(\),now\(\)\)/);
  assert.doesNotMatch(addMember,/pending:|invited:/);
});

test("directory search je omezený server-side Graph dotaz s debounce",()=>{
  assert.match(app,/window\.setTimeout\([\s\S]*?,350\)/);
  assert.match(repository,/https:\/\/graph\.microsoft\.com\/v1\.0\/users/);
  assert.match(repository,/"\$top":"8"/);
  assert.match(repository,/"\$select":"id,displayName,mail,userPrincipalName"/);
  assert.match(repository,/ConsistencyLevel:"eventual"/);
  assert.match(auth,/https:\/\/graph\.microsoft\.com\/User\.ReadBasic\.All/);
  assert.doesNotMatch(auth,/User\.Read\.All|User\.ReadWrite\.All|Directory\.Read\.All/);
});

test("neznámý přihlášený oid se bez membershipu nepersistuje",()=>{
  const resolve=backend.slice(backend.indexOf("async resolveUser"),backend.indexOf("private mapUser"));
  assert.match(resolve,/Uživatel nemá přístup do DeveloCRM/);
  assert.doesNotMatch(resolve,/INSERT INTO users/);
});
