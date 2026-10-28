import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyRsPreparationInput,legacyRsPriceBasis,legacyRsAgreedTerms,LegacyRsPreparationError,type LegacyRsPriceBasis} from '../src/contracts/legacy-rs-preparation.js';

const version='00000000-0000-4000-8000-000000000001';
const basis:LegacyRsPriceBasis={contractId:'contract',projectId:'project',unitId:'unit',salesCaseId:'case',versionId:version,currentUnitPrice:'13770000',accessories:[
  {assignmentId:'b',accessoryId:'parking',code:'P18',type:'parking',amount:'1290000'},
  {assignmentId:'a',accessoryId:'cellar',code:'S2',type:'cellar',amount:'290000'},
]};
function input(){return legacyRsPreparationInput({expectedVersionId:version,previewToken:legacyRsPriceBasis(basis).previewToken,
  agreedUnitPrice:'13000000',reservationFee:'250000',idempotencyKey:'technical-key-0001',reason:'Explicit technical preparation'});}
const error=(code:string)=>(e:unknown)=>e instanceof LegacyRsPreparationError&&e.code===code;

test('preview uses exact existing price facts, not agreed terms or a default fee',()=>{
  const preview=legacyRsPriceBasis(basis);assert.equal(preview.currentTotalPrice,'15350000.00');assert.equal(preview.accessoryPrice,'1580000.00');
  assert.equal('reservationFee' in preview,false);
  const agreed=legacyRsAgreedTerms(basis,input());assert.equal(agreed.unitPrice,'13000000.00');assert.equal(agreed.totalPrice,'14580000.00');assert.equal(agreed.reservationFee,'250000.00');
});
test('missing current unit price stays missing, zero remains a genuine stored value',()=>{
  assert.equal(legacyRsPriceBasis({...basis,currentUnitPrice:null}).currentTotalPrice,null);
  assert.equal(legacyRsPriceBasis({...basis,currentUnitPrice:'0'}).currentTotalPrice,'1580000.00');
});
test('stable token ignores input ordering and decimal spelling but binds exact business IDs and facts',()=>{
  const token=legacyRsPriceBasis(basis).previewToken;
  assert.equal(legacyRsPriceBasis({...basis,currentUnitPrice:'13770000.00',accessories:[...basis.accessories].reverse()}).previewToken,token);
  for(const change of [{contractId:'other'},{projectId:'other'},{unitId:'other'},{salesCaseId:'other'},{versionId:'other'},{currentUnitPrice:'13770000.01'},
    {accessories:basis.accessories.slice(1)},{accessories:basis.accessories.map(a=>({...a,assignmentId:`new-${a.assignmentId}`}))},
    {accessories:basis.accessories.map(a=>({...a,amount:'0'}))}])
    assert.notEqual(legacyRsPriceBasis({...basis,...change}).previewToken,token);
});
test('changed prices or version reject stale confirmation rather than copying silently',()=>{
  assert.throws(()=>legacyRsAgreedTerms({...basis,currentUnitPrice:'1'},input()),error('stale_preview'));
  assert.throws(()=>legacyRsAgreedTerms(basis,{...input(),expectedVersionId:'another'}),error('stale_preview'));
});
test('untrusted request cannot supply assignments, Graph destinations or render data',()=>{
  for(const key of ['accessories','tenantId','projectId','unitId','driveId','siteId','snapshot','renderData'])
    assert.throws(()=>legacyRsPreparationInput({...input(),[key]:'injected'}),error('invalid_input'));
  for(const field of ['agreedUnitPrice','reservationFee','expectedVersionId','previewToken','idempotencyKey','reason']){
    const value:Record<string,unknown>={...input()};delete value[field];assert.throws(()=>legacyRsPreparationInput(value));
  }
});
test('rejects invalid money, implicit number coercion and unreasonable fee without rounding',()=>{
  for(const value of ['1e6','1 000','1000,00','-1','0.001','NaN','Infinity'])
    assert.throws(()=>legacyRsPreparationInput({...input(),agreedUnitPrice:value}),error('invalid_money'));
  for(const value of [1000,null])assert.throws(()=>legacyRsPreparationInput({...input(),agreedUnitPrice:value}),error('invalid_input'));
  assert.throws(()=>legacyRsPreparationInput({...input(),reservationFee:'0'}),error('fee_required'));
  assert.throws(()=>legacyRsAgreedTerms(basis,{...input(),reservationFee:'99999999.00'}),error('invalid_fee'));
  const pennies=legacyRsAgreedTerms(basis,{...input(),agreedUnitPrice:'13000000.03',reservationFee:'250000.01'});
  assert.equal(pennies.totalPrice,'14580000.03');assert.equal(pennies.reservationFee,'250000.01');
});
test('duplicated assignment or accessory is an error, not a double-counted price',()=>{
  assert.throws(()=>legacyRsPriceBasis({...basis,accessories:[...basis.accessories,basis.accessories[0]]}),error('ambiguous_accessories'));
  assert.throws(()=>legacyRsPriceBasis({...basis,accessories:[...basis.accessories,{...basis.accessories[0],assignmentId:'c'}]}),error('ambiguous_accessories'));
});
