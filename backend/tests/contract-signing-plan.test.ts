import assert from 'node:assert/strict';
import test from 'node:test';
import {signingPlanDay,ContractSigningPlanValidationError} from '../src/shared/contract-signing-plan.js';

test('planned signing dates are strict calendar days, never inferred from time or creation',()=>{
  assert.equal(signingPlanDay(null),null);
  for(const day of ['2000-01-01','2028-02-29','2199-12-31'])assert.equal(signingPlanDay(day),day);
  for(const value of [undefined,'','2026-02-29','2026-02-30','2026-4-01','2026-01-01T00:00:00Z','1999-12-31','2200-01-01',0,{},'infinity'])
    assert.throws(()=>signingPlanDay(value),ContractSigningPlanValidationError);
});
