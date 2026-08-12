import assert from "node:assert/strict";
import test from "node:test";
import {contextualContractIdentity,getNextContractAction} from "../src/shared/next-contract-action.js";

test("další smlouva začíná RS a názvy vznikají automaticky",()=>{
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts:[],payments:[]}),{kind:"create_contract",contractType:"rs",label:"Vytvořit RS"});
  assert.deepEqual(contextualContractIdentity("rs","101"),{reference:"RS 101",title:"Rezervační smlouva · 101"});
});

test("podepsaná RS čeká na poplatek a po úhradě nabídne SBK",()=>{
  const contracts=[{id:"rs-1",type:"rs" as const,status:"signed"}];
  assert.equal(getNextContractAction({hasActiveSalesCase:true,contracts,payments:[]}).kind,"await_payment");
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts,payments:[{contractId:"rs-1",type:"reservation_fee",status:"paid"}]}),{kind:"create_contract",contractType:"sbk",label:"Vytvořit SBK"});
});

test("podepsaná a uhrazená SBK nabídne KS, existující KS pouze smlouvy",()=>{
  const contracts=[{id:"sbk-1",type:"sbk" as const,status:"signed"},{id:"rs-1",type:"rs" as const,status:"signed"}];
  const payments=[{contractId:"rs-1",type:"reservation_fee",status:"paid"},{contractId:"sbk-1",type:"purchase_installment",status:"overpaid"}];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts,payments}),{kind:"create_contract",contractType:"ks",label:"Vytvořit KS"});
  assert.equal(getNextContractAction({hasActiveSalesCase:true,contracts:[{id:"ks-1",type:"ks",status:"draft"},...contracts],payments}).kind,"open_contracts");
});

test("bez aktivního obchodního procesu nelze smlouvu založit",()=>{
  assert.equal(getNextContractAction({hasActiveSalesCase:false,contracts:[],payments:[]}).kind,"missing_sales_case");
});
