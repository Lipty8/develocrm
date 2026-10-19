import test from 'node:test';
import assert from 'node:assert/strict';
import {signaturePaymentTerms} from '../src/contracts/signature-payment-terms.js';
import {originalPaymentPlan} from '../src/contracts/original-payment-plan.js';
const buyer='00000000-0000-4000-8000-000000000001';
function plan(type:'rs'|'sbk'='rs'){
  return{version:1,profile:'dejvice-original-dob-full-v1',calendarPolicy:'cz-2026-v1',signatureAnchor:'last_required_signature',
    contractType:type,totalPrice:'10000000.00',reservationFee:'250000.00',paidReservationFee:type==='rs'?'0':'250000.00',
    precedingRsContractId:type==='rs'?null:'00000000-0000-4000-8000-000000000002',buyerPartyId:buyer,variableSymbol:'417',
    rows:originalPaymentPlan(type==='rs'?{type:'rs',reservationFeeAmount:'250000.00'}:
      {type:'sbk',totalPrice:'10000000.00',reservationFeeAmount:'250000.00',paidReservationFeeAmount:'250000.00'}).map(({key,amount,anchor,days,calendar})=>({key,amount,anchor,days,calendar}))};
}
test('persisted RS and SBK terms use the existing canonical calculation',()=>{
  for(const type of ['rs','sbk'] as const){const p=plan(type);assert.deepEqual(signaturePaymentTerms(p),p);}
});
test('invalid or inconsistent persisted terms fail closed without inventing dates or amounts',()=>{
  const p=plan('sbk');
  for(const value of [null,{}, {...p,signatureAnchor:'creation'}, {...p,calendarPolicy:'unknown'}, {...p,buyerPartyId:'417'},
    {...p,paidReservationFee:'0'}, {...p,rows:[...p.rows,...p.rows]}, {...p,rows:[{...p.rows[0],amount:'10'},p.rows[1]]},
    {...p,rows:[{...p.rows[0],days:4},p.rows[1]]}, {...p,rows:[null,p.rows[1]]}])assert.equal(signaturePaymentTerms(value),null);
});
