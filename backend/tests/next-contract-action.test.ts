import assert from "node:assert/strict";
import test from "node:test";
import {contextualContractIdentity,getNextContractAction} from "../src/shared/next-contract-action.js";

test("další smlouva začíná RS a názvy vznikají automaticky",()=>{
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts:[]}),{kind:"create_contract",contractType:"rs",label:"Vytvořit RS"});
  assert.deepEqual(contextualContractIdentity("rs","101"),{reference:"RS 101",title:"Rezervační smlouva · 101"});
});

test("podepsaná RS nabídne SBK nezávisle na stavu plateb",()=>{
  const contracts=[{id:"rs-1",type:"rs" as const,status:"signed"}];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts}),{kind:"create_contract",contractType:"sbk",label:"Vytvořit SBK"});
});

test("podepsaná SBK nabídne KS, existující KS pouze smlouvy",()=>{
  const contracts=[{id:"sbk-1",type:"sbk" as const,status:"signed"},{id:"rs-1",type:"rs" as const,status:"signed"}];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts}),{kind:"create_contract",contractType:"ks",label:"Vytvořit KS"});
  assert.equal(getNextContractAction({hasActiveSalesCase:true,contracts:[{id:"ks-1",type:"ks",status:"draft"},...contracts]}).kind,"open_contracts");
});

test("bez aktivního obchodního procesu nelze smlouvu založit",()=>{
  assert.equal(getNextContractAction({hasActiveSalesCase:false,contracts:[]}).kind,"missing_sales_case");
});
