import assert from 'node:assert/strict';
import test from 'node:test';
import {originalPaymentPlan,OriginalPaymentPlanError} from '../src/contracts/original-payment-plan.js';
import {PGlite} from '@electric-sql/pglite';

const sbk={type:'sbk' as const,totalPrice:'5000000.00',reservationFeeAmount:'250000.00',paidReservationFeeAmount:'250000.00'};
const code=(expected:string)=>(error:unknown)=>error instanceof OriginalPaymentPlanError&&error.code===expected;

test('před podpisem není splatnost RS vymyšlená podle vytvoření smlouvy',()=>{
  assert.deepEqual(originalPaymentPlan({type:'rs',reservationFeeAmount:'250000'}),[
    {key:'rs_fee',amount:'250000.00',anchor:'effective_signature',days:3,calendar:'czech_working_days',dueOn:null,state:'awaiting_signature'},
  ]);
});
test('RS splatnost vychází z doloženého účinného podpisu a přeskočí svátky',()=>{
  const [row]=originalPaymentPlan({type:'rs',reservationFeeAmount:'250000',effectiveSignatureAt:'2026-12-23T12:00:00Z'});
  assert.equal(row.dueOn,'2026-12-30');assert.equal(row.state,'scheduled');
});
test('SBK zachová cenu: zaplacená RS + 20 % + doplatek 80 % minus RS',()=>{
  const plan=originalPaymentPlan(sbk);
  assert.deepEqual(plan.map(row=>row.amount),['1000000.00','3750000.00']);
  assert.equal(Number(plan[0].amount)+Number(plan[1].amount)+Number(sbk.paidReservationFeeAmount),Number(sbk.totalPrice));
  assert.equal(plan[0].dueOn,null);assert.equal(plan[0].state,'awaiting_signature');
  assert.equal(plan[1].dueOn,null);assert.equal(plan[1].state,'awaiting_delivery');
});
test('SBK podpis určí jen první splátku, nikoli datum doručení výzvy',()=>{
  const plan=originalPaymentPlan({...sbk,effectiveSignatureAt:'2026-04-02T10:00:00Z'});
  assert.equal(plan[0].dueOn,'2026-04-13');assert.equal(plan[1].dueOn,null);
});
test('doplatek je 30 kalendářních dní až od doloženého doručení',()=>{
  const plan=originalPaymentPlan({...sbk,effectiveSignatureAt:'2026-04-02T10:00:00Z',finalNoticeDeliveredOn:'2026-12-10'});
  assert.equal(plan[1].dueOn,'2027-01-09'); // Do not silently change calendar days to business days.
});
test('platební předpis není důkazem zaplaceného rezervačního poplatku',()=>{
  assert.throws(()=>originalPaymentPlan({...sbk,paidReservationFeeAmount:'0'}),code('reservation_fee_not_paid'));
  assert.throws(()=>originalPaymentPlan({...sbk,paidReservationFeeAmount:'100000'}),code('reservation_fee_not_paid'));
});
test('nesoulad přijaté částky vyžaduje vypořádání, ne automatické přepsání poplatku',()=>{
  assert.throws(()=>originalPaymentPlan({...sbk,paidReservationFeeAmount:'300000'}),code('reservation_fee_payment_mismatch'));
  assert.throws(()=>originalPaymentPlan({...sbk,totalPrice:'100000'}),code('inconsistent_installments'));
});
test('nezaokrouhluje kupní cenu ani splátky na celé koruny',()=>{
  const plan=originalPaymentPlan({...sbk,totalPrice:'5000000.03'});
  assert.deepEqual(plan.map(row=>row.amount),['1000000.01','3750000.02']);
});
test('nepřijímá lokalizované řetězce ani zaokrouhlené nebo neplatné peníze',()=>{
  for(const value of ['1e6','250 000','250000,00','-1','NaN','Infinity','0.001','10000000000000.00'])assert.throws(()=>originalPaymentPlan({type:'rs',reservationFeeAmount:value}),code('invalid_money'));
  assert.throws(()=>originalPaymentPlan({type:'rs',reservationFeeAmount:'0'}),code('reservation_fee_required'));
});
test('doručení před účinností ani neplatné datum nevytvoří splatnost',()=>{
  assert.throws(()=>originalPaymentPlan({...sbk,finalNoticeDeliveredOn:'2026-12-10'}),code('delivery_before_effective_contract'));
  assert.throws(()=>originalPaymentPlan({...sbk,effectiveSignatureAt:'2026-12-11T10:00:00Z',finalNoticeDeliveredOn:'2026-12-10'}),code('delivery_before_effective_contract'));
  assert.throws(()=>originalPaymentPlan({...sbk,effectiveSignatureAt:'2026-04-02T10:00:00Z',finalNoticeDeliveredOn:'2026-02-30'}));
});
test('stejný vstup je deterministický, nic se nemutuje a systémový čas není vstupem',()=>{
  const input=Object.freeze({...sbk,effectiveSignatureAt:'2026-04-02T10:00:00Z'});
  assert.deepEqual(originalPaymentPlan(input),originalPaymentPlan(input));
});

test('peněžní výpočet odpovídá skutečné PostgreSQL numeric aritmetice',async()=>{
  const db=new PGlite();
  try{
    for(const price of ['5000000.03','5000000.02','23950000.99','9999999999999.99']){
      const result=await db.query<{first:string;final:string}>(`SELECT round($1::numeric * 0.2,2)::text AS first,($1::numeric-round($1::numeric * 0.2,2)-250000)::text AS final`,[price]);
      const plan=originalPaymentPlan({...sbk,totalPrice:price});
      assert.equal(plan[0].amount,result.rows[0].first);
      assert.equal(plan[1].amount,result.rows[0].final);
    }
  }finally{await db.close();}
});
