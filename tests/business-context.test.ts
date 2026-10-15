import assert from 'node:assert/strict';
import test from 'node:test';
import {getUnitContext,currentCaseContracts,contractBelongsToUnit} from '../app/lib/business-context';
import {projectUnitSalesWorkflow} from '../app/lib/unit-sales-workflow';
import {paymentNeedsAttention,taskNeedsAttention} from '../app/lib/dashboard-attention';
import type {UnitRecord,UnitCommercialContext,ContractRecord,TaskRecord} from '../app/crm-data';
import type {PaymentRecord} from '../app/repositories/payment-repository';

const unit={id:'417',backendId:'unit-a',projectBackendId:'project-a',project:'A',status:'Volný',handover:''} as UnitRecord;
const context={salesCaseId:'case-a',buyers:[],interests:[],stage:'interest',hold:null} as UnitCommercialContext;
const contract=(id:string,unitId:string,salesCaseId:string,statusCode='signed')=>({id,unitId,salesCaseId,unit:'417',project:'A',typeCode:'rs',statusCode} as ContractRecord);

test('stejná čísla v různých projektech se nikdy nespojí',()=>{
  assert.equal(getUnitContext(unit,{'417':context}),undefined);
  assert.equal(getUnitContext(unit,{'unit-a':context}),context);
  assert.equal(contractBelongsToUnit(contract('b','unit-b','case-a'),unit),false);
  const rows=[contract('current','unit-a','case-a'),contract('history','unit-a','old-case'),contract('other-project','unit-b','case-a')];
  assert.deepEqual(currentCaseContracts(unit,context,rows).map(row=>row.id),['current']);
  assert.deepEqual(currentCaseContracts(unit,undefined,rows),[]);
});
test('historická smlouva nemění nový obchod, postoupení nemění podepsanou RS',()=>{
  assert.equal(projectUnitSalesWorkflow({unit,context,contracts:[contract('old','unit-a','old-case')]}).currentStage,'interest');
  const projection=projectUnitSalesWorkflow({unit,context,contracts:[contract('rs','unit-a','case-a'),{...contract('assignment','unit-a','case-a'),typeCode:'assignment_rs'}]});
  assert.equal(projection.currentStage,'sbk');
  assert.equal(projection.steps[2].state,'complete');
});
test('dashboard nepovažuje stornovaný poplatek za čekající úhradu a zahrne vratku',()=>{
  const payment={type:'reservation_fee',status:'cancelled',amount:100,paid:0} as PaymentRecord;
  assert.equal(paymentNeedsAttention(payment),false);
  assert.equal(paymentNeedsAttention({...payment,refundable:50}),true);
  assert.equal(paymentNeedsAttention({...payment,status:'pending'}),true);
  assert.equal(paymentNeedsAttention({...payment,status:'paid',paid:100}),false);
});
test('pozornost úkolům znamená blížící se termín nebo vysokou prioritu',()=>{
  const task={done:false,priority:'Střední',dueAt:'2026-10-20T12:00:00Z'} as TaskRecord;
  const now=new Date('2026-10-15T12:00:00Z');
  assert.equal(taskNeedsAttention(task,now),true);
  assert.equal(taskNeedsAttention({...task,done:true},now),false);
  assert.equal(taskNeedsAttention({...task,dueAt:'2026-11-20T12:00:00Z'},now),false);
});
