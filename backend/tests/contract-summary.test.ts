import assert from "node:assert/strict";
import test from "node:test";
import {contractSummaryCategory,contractSummaryCounts} from "../../app/lib/contract-summary.js";

test("smluvní souhrn zařadí každou smlouvu právě jednou podle doménového typu",()=>{
  const records=[
    {typeCode:"rs",type:"RS"},
    {typeCode:"sbk",type:"SBK"},
    {typeCode:"ks",type:"KS"},
    {typeCode:"amendment",type:"Dodatek",parentContractId:"contract-rs",amendmentNumber:1},
    {typeCode:"assignment_rs",type:"Postoupení RS",baseContractType:"rs"},
    {typeCode:"future_contract",type:"Jiný dokument"},
  ];
  assert.deepEqual(contractSummaryCounts(records),{total:6,rs:1,sbk:1,ks:1,other:3});
  assert.equal(contractSummaryCategory(records[3]),"other");
  assert.equal(contractSummaryCategory(records[4]),"other");
});

test("vztah k rodičovské smlouvě má přednost před základním typem",()=>{
  assert.equal(contractSummaryCategory({typeCode:"rs",type:"RS",parentContractId:"original"}),"other");
});
