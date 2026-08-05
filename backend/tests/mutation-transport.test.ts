import assert from "node:assert/strict";
import test from "node:test";
import {forwardBackendMutation} from "../../app/lib/backend-proxy.js";

const originalFetch=globalThis.fetch;
const originalApiUrl=process.env.DEVELOCRM_API_URL;
const originalTenant=process.env.DEVELOCRM_TENANT_ID;

test.afterEach(()=>{
  globalThis.fetch=originalFetch;
  if(originalApiUrl===undefined)delete process.env.DEVELOCRM_API_URL;else process.env.DEVELOCRM_API_URL=originalApiUrl;
  if(originalTenant===undefined)delete process.env.DEVELOCRM_TENANT_ID;else process.env.DEVELOCRM_TENANT_ID=originalTenant;
});

test("BFF proxy předá POST tělo, autorizaci, tenant a correlation ID právě jednou",async()=>{
  process.env.DEVELOCRM_API_URL="https://api.example.test";
  process.env.DEVELOCRM_TENANT_ID="tenant-1";
  let called=0;
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    called++;
    assert.equal(String(input),"https://api.example.test/v1/parties");
    assert.equal(init?.method,"POST");
    const headers=new Headers(init?.headers);
    assert.equal(headers.get("authorization"),"Bearer test-token");
    assert.equal(headers.get("x-tenant-id"),"tenant-1");
    assert.equal(headers.get("x-correlation-id"),"corr-post");
    assert.equal(headers.get("content-type"),"application/json");
    assert.equal(new TextDecoder().decode(init?.body as ArrayBuffer),'{"kind":"individual"}');
    return Response.json({id:"party-1"},{status:201,headers:{"x-correlation-id":"corr-backend"}});
  }) as typeof fetch;
  const response=await forwardBackendMutation(new Request("https://crm.example.test/api/clients",{method:"POST",headers:{authorization:"DeveloCRM test-token","content-type":"application/json","x-correlation-id":"corr-post"},body:'{"kind":"individual"}'}),{method:"POST",target:"/v1/parties",unavailableMessage:"Backend chybí"});
  assert.equal(called,1);
  assert.equal(response.status,201);
  assert.equal(response.headers.get("x-correlation-id"),"corr-backend");
  assert.deepEqual(await response.json(),{id:"party-1"});
});

test("BFF proxy podporuje PATCH a DELETE bez opakovaného čtení těla",async()=>{
  process.env.DEVELOCRM_API_URL="https://api.example.test";
  process.env.DEVELOCRM_TENANT_ID="tenant-1";
  const methods:string[]=[];
  globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{methods.push(String(init?.method));if(init?.method==="DELETE")assert.equal(init.body,undefined);return new Response(null,{status:204});}) as typeof fetch;
  const headers={authorization:"Bearer test-token","content-type":"application/json"};
  assert.equal((await forwardBackendMutation(new Request("https://crm.example.test/api/project",{method:"PATCH",headers,body:'{"name":"Nový"}'}),{method:"PATCH",target:"/v1/projects/project-1",unavailableMessage:"Backend chybí"})).status,204);
  assert.equal((await forwardBackendMutation(new Request("https://crm.example.test/api/accessory",{method:"DELETE",headers}),{method:"DELETE",target:"/v1/accessory-assignments/assignment-1",unavailableMessage:"Backend chybí"})).status,204);
  assert.deepEqual(methods,["PATCH","DELETE"]);
});

test("BFF proxy převede transportní chybu na korektní 502 odpověď",async()=>{
  process.env.DEVELOCRM_API_URL="https://api.example.test";
  process.env.DEVELOCRM_TENANT_ID="tenant-1";
  globalThis.fetch=(async()=>{throw new TypeError("network unavailable");}) as typeof fetch;
  const response=await forwardBackendMutation(new Request("https://crm.example.test/api/clients",{method:"POST",headers:{authorization:"Bearer test-token","content-type":"application/json","x-correlation-id":"corr-error"},body:"{}"}),{method:"POST",target:"/v1/parties",unavailableMessage:"Backend chybí"});
  assert.equal(response.status,502);
  assert.equal(response.headers.get("x-correlation-id"),"corr-error");
  assert.deepEqual(await response.json(),{error:"Spojení s backendem se nezdařilo",correlationId:"corr-error",retryable:true});
});
