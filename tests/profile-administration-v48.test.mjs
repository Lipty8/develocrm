import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../app/CRMApp.tsx",import.meta.url),"utf8");
const profile=await readFile(new URL("../app/repositories/profile-repository.ts",import.meta.url),"utf8");
const css=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
const roles=await readFile(new URL("../backend/src/shared/role-catalog.ts",import.meta.url),"utf8");

test("Entra e-mail nelze přepsat starým lokálním profilem",()=>{assert.match(profile,/type StoredProfile=Pick<IdentitySession\["user"\],"displayName"/);assert.doesNotMatch(profile,/return stored\?\{\.\.\.user,\.\.\.JSON\.parse\(stored\)\}/);assert.match(crm,/Pracovní e-mail z Microsoft Entra ID/);assert.match(crm,/value=\{user\.email\} disabled/);assert.match(crm,/disabled=\{entraManaged\}/);});
test("role jsou české, kompaktní a responzivní",()=>{for(const label of ["Administrátor","Projektový manažer","Obchodní administrativa","Jednatel","Pouze pro čtení"])assert.match(roles,new RegExp(label));assert.match(crm,/function RoleChips/);assert.match(crm,/\+\{hidden\.length\} další/);assert.match(css,/\.role-chip-list\{display:flex/);assert.match(css,/\.profile-workspace \{[^}]*flex-wrap:wrap/);});
test("poslední přihlášení používá centrální český formatter",()=>{assert.match(crm,/lastLoginAt\?formatPragueDateTime\(user\.lastLoginAt\)/);assert.doesNotMatch(crm,/lastLoginAt\?user\.lastLoginAt/);});
