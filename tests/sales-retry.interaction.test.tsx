import assert from 'node:assert/strict';
import {test} from 'node:test';
import {salesCommandRepository} from '../app/repositories/sales-command-repository';
import {entraAuth} from '../app/lib/entra-auth';

test('hold retry retains the caller operation key when the first response is lost',async t=>{
 t.mock.method(entraAuth,'getAccessToken',async()=>null);
 const bodies:Array<{idempotencyKey:string}>=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
  bodies.push(JSON.parse(String(init?.body)));
  if(bodies.length===1)throw new TypeError('test-only connection dropped after commit');
  return Response.json({hold_id:'existing-hold',sales_case_id:'existing-case',party_id:'existing-party'});
 });
 const input={unitId:'technical-unit',type:'pre_reservation' as const,partyIds:['technical-party'],expiresAt:'2026-11-01T12:00:00Z',reason:'Technical retry',idempotencyKey:'same-technical-operation'};
 await assert.rejects(salesCommandRepository.createHold(input));
 await salesCommandRepository.createHold(input);
 assert.equal(bodies.length,2);assert.equal(bodies[0].idempotencyKey,input.idempotencyKey);assert.equal(bodies[1].idempotencyKey,input.idempotencyKey);
});
