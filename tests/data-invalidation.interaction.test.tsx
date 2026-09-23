import assert from "node:assert/strict";
import {before} from "node:test";
import test from "node:test";
import {JSDOM} from "jsdom";
import {createApiFetch} from "../app/lib/api-client";
import {DATA_MUTATED_EVENT,type DataMutationDetail} from "../app/lib/data-invalidation";

before(()=>{
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://develocrm.test"});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,CustomEvent:dom.window.CustomEvent});
});

test("úspěšná mutace oznámí změnu dat bez reloadu stránky",async()=>{
  const originalFetch=globalThis.fetch;
  const details:DataMutationDetail[]=[];
  const listener=(event:Event)=>details.push((event as CustomEvent<DataMutationDetail>).detail);
  window.addEventListener(DATA_MUTATED_EVENT,listener);
  globalThis.fetch=async()=>new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json"}});
  try{
    const apiFetch=createApiFetch({getAccessToken:async()=>"test-token"},globalThis.fetch,()=>false);
    const response=await apiFetch("/api/accessories/assignment-1",{method:"DELETE"});
    assert.equal(response.status,200);
    assert.deepEqual(details,[{method:"DELETE",target:"/api/accessories/assignment-1"}]);
  }finally{
    globalThis.fetch=originalFetch;
    window.removeEventListener(DATA_MUTATED_EVENT,listener);
  }
});

test("neúspěšná mutace invalidaci dat nevyvolá",async()=>{
  const originalFetch=globalThis.fetch;
  let calls=0;
  const listener=()=>{calls+=1;};
  window.addEventListener(DATA_MUTATED_EVENT,listener);
  globalThis.fetch=async()=>new Response(JSON.stringify({error:"failed"}),{status:409,headers:{"content-type":"application/json"}});
  try{
    const apiFetch=createApiFetch({getAccessToken:async()=>"test-token"},globalThis.fetch,()=>false);
    const response=await apiFetch("/api/contracts/contract-1",{method:"PATCH",body:"{}"});
    assert.equal(response.status,409);
    assert.equal(calls,0);
  }finally{
    globalThis.fetch=originalFetch;
    window.removeEventListener(DATA_MUTATED_EVENT,listener);
  }
});
