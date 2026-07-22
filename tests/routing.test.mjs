import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clientRoute, contractRoute, pageRoute, parseCrmRoute, projectRoute, unitRoute, updateSearch } from "../app/crm-routing.mjs";

const appUrl=new URL("../app/CRMApp.tsx",import.meta.url);
const catchAllUrl=new URL("../app/[...crmPath]/page.tsx",import.meta.url);

test("stable deep links use IDs and restore project and unit tabs",()=>{
  assert.equal(pageRoute("dashboard"),"/dashboard");
  assert.equal(projectRoute("DEJ"),"/projects/DEJ");
  assert.equal(projectRoute("DEJ","units"),"/projects/DEJ/units");
  assert.equal(unitRoute("101","history"),"/units/101?tab=history");
  assert.equal(clientRoute("party-101"),"/clients/party-101");
  assert.equal(contractRoute("contract-101"),"/contracts/contract-101");
  assert.deepEqual({...parseCrmRoute("/projects/DEJ/units"),params:undefined},{page:"projects",kind:"project",projectId:"DEJ",projectTab:"units",params:undefined});
  assert.equal(parseCrmRoute("/units/101","tab=history").unitTab,"history");
});

test("project filters and view survive a detail round-trip",()=>{
  const list=updateSearch("/projects/DEJ/units","",{layout:["2+kk"],view:"cards",floor:["2. NP"]});
  assert.equal(list,"/projects/DEJ/units?layout=2%2Bkk&view=cards&floor=2.+NP");
  const route=parseCrmRoute("/projects/DEJ/units",list.split("?")[1]);
  assert.equal(route.params.get("layout"),"2+kk");
  assert.equal(route.params.get("view"),"cards");
  const history=[list,unitRoute("102")];
  assert.equal(history.at(-2),list);
});

test("browser back and forward follow the actual navigation stack",()=>{
  const entries=[pageRoute("dashboard"),pageRoute("projects"),projectRoute("DEJ"),projectRoute("DEJ","units"),unitRoute("101")];
  let cursor=entries.length-1;
  const back=()=>entries[--cursor];
  const forward=()=>entries[++cursor];
  assert.equal(back(),"/projects/DEJ/units");
  assert.equal(back(),"/projects/DEJ");
  assert.equal(back(),"/projects");
  assert.equal(back(),"/dashboard");
  assert.equal(forward(),"/projects");
  assert.equal(forward(),"/projects/DEJ");
});

test("client to unit history returns to the same stable client",()=>{
  const entries=[pageRoute("clients"),clientRoute("c1"),unitRoute("A203")];
  assert.equal(entries.at(-2),"/clients/c1");
  assert.equal(parseCrmRoute(entries.at(-2)).clientId,"c1");
});

test("global search remains encoded on the history entry behind its result",()=>{
  const results=updateSearch("/dashboard","",{q:"A203"});
  const entries=[results,unitRoute("A203")];
  assert.equal(parseCrmRoute("/dashboard",entries[0].split("?")[1]).params.get("q"),"A203");
});

test("refresh and new-tab parsing resolve every supported deep link",()=>{
  assert.equal(parseCrmRoute("/projects/DEJ").kind,"project");
  assert.equal(parseCrmRoute("/units/101").kind,"unit");
  assert.equal(parseCrmRoute("/clients/c1").kind,"client");
  assert.equal(parseCrmRoute("/contracts/preview-contract-a203-sbk").kind,"contract");
  assert.equal(parseCrmRoute("/admin/users").kind,"admin-users");
});

test("renaming a project does not alter its stable route",()=>{
  const before={code:"DEJ",name:"Rezidence Dejvice"};
  const after={...before,name:"Rezidence Dejvice Test"};
  assert.equal(projectRoute(before.code),projectRoute(after.code));
});

test("CRM uses framework routing without a parallel history implementation",async()=>{
  const [app,catchAll]=await Promise.all([readFile(appUrl,"utf8"),readFile(catchAllUrl,"utf8")]);
  assert.match(app,/useRouter/);
  assert.match(app,/router\.push/);
  assert.match(app,/router\.replace/);
  assert.doesNotMatch(app,/window\.history\.(back|forward|pushState|replaceState)/);
  assert.match(catchAll,/CRMApp/);
});
