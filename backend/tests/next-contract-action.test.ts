import assert from "node:assert/strict";
import test from "node:test";
import {contextualContractIdentity,getNextContractAction,getSalesProcessState} from "../src/shared/next-contract-action.js";

test("další smlouva začíná RS a názvy vznikají automaticky",()=>{
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts:[]}),{kind:"create_contract",contractType:"rs",label:"Vytvořit RS"});
  assert.deepEqual(contextualContractIdentity("rs","101"),{reference:"RS 101",title:"Rezervační smlouva · 101"});
});

test("podepsaná RS nabídne SBK nezávisle na stavu plateb",()=>{
  const contracts=[{id:"rs-1",type:"rs" as const,status:"signed"}];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts}),{kind:"create_contract",contractType:"sbk",label:"Vytvořit SBK"});
  assert.deepEqual(getSalesProcessState({hasActiveSalesCase:true,contracts}).steps.map(step=>step.state),["complete","complete","complete","current","pending","pending"]);
});

test("podepsaná SBK nabídne KS, existující KS pouze smlouvy",()=>{
  const contracts=[{id:"sbk-1",type:"sbk" as const,status:"signed"},{id:"rs-1",type:"rs" as const,status:"signed"}];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts}),{kind:"create_contract",contractType:"ks",label:"Vytvořit KS"});
  assert.equal(getNextContractAction({hasActiveSalesCase:true,contracts:[{id:"ks-1",type:"ks",status:"draft"},...contracts]}).kind,"open_contracts");
});

test("bez aktivního obchodního procesu nelze smlouvu založit",()=>{
  assert.equal(getNextContractAction({hasActiveSalesCase:false,contracts:[]}).kind,"missing_sales_case");
});

test("postoupení podepsané RS ani SBK neresetuje základní smluvní postup",()=>{
  const afterRsAssignment=[
    {id:"assignment-rs-1",type:"assignment_rs",status:"signed"},
    {id:"rs-1",type:"rs",status:"signed"},
  ];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts:afterRsAssignment}),{kind:"create_contract",contractType:"sbk",label:"Vytvořit SBK"});
  const afterSbkAssignment=[
    {id:"assignment-sbk-1",type:"assignment_sbk",status:"signed"},
    {id:"sbk-1",type:"sbk",status:"signed"},
    ...afterRsAssignment,
  ];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts:afterSbkAssignment}),{kind:"create_contract",contractType:"ks",label:"Vytvořit KS"});
});

test("podepsaná KS dokončí smluvní postup bez dalšího CTA",()=>{
  const contracts=[
    {id:"ks-1",type:"ks",status:"signed"},
    {id:"sbk-1",type:"sbk",status:"signed"},
    {id:"rs-1",type:"rs",status:"signed"},
  ];
  const projection=getSalesProcessState({hasActiveSalesCase:true,contracts});
  assert.equal(projection.nextContractAction.kind,"none");
  assert.equal(projection.currentStage,"handover");
  assert.deepEqual(projection.steps.map(step=>step.state),["complete","complete","complete","complete","complete","current"]);
});

test("zrušená RS neblokuje novou RS v aktuálním obchodním případu",()=>{
  const contracts=[{id:"cancelled-rs",type:"rs",status:"cancelled"}];
  assert.deepEqual(getNextContractAction({hasActiveSalesCase:true,contracts}),{kind:"create_contract",contractType:"rs",label:"Vytvořit RS"});
});

test("zastaralá obchodní etapa nemůže odporovat CTA odvozenému ze skutečných smluv",()=>{
  const projection=getSalesProcessState({hasActiveSalesCase:true,salesStage:"ks",contracts:[]});
  assert.equal(projection.currentStage,"rs");
  assert.deepEqual(projection.nextContractAction,{kind:"create_contract",contractType:"rs",label:"Vytvořit RS"});
});
