import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideReadiness} from '../src/diagnostics/readiness-gate.js';
import type {ConsistencyReport} from '../src/diagnostics/consistency-checker.js';
const report:ConsistencyReport={runId:'r',checkedAt:'2026-10-13T12:00:00Z',complete:true,projectsChecked:5,checks:16,findings:[],summary:{critical:0,legacy:8,warning:1},physicalEvidence:'verified'};
test('reviewed legacy evidence is reported, not called compliant, without blocking a new RS release',()=>{
 assert.deepEqual(decideReadiness([{code:'MIGRATIONS_CURRENT',passed:true,detail:'ok'}],report),{ready:true,blockers:[],legacyExceptions:8,warnings:1});
});
test('any critical issue blocks the release even when there is also a reviewed legacy baseline',()=>{
 assert.equal(decideReadiness([],{...report,summary:{...report.summary,critical:1}}).ready,false);
});
test('incomplete Graph evidence, coverage, migration, or frontend smoke cannot be treated as success',()=>{
 for(const r of [{...report,complete:false},{...report,physicalEvidence:'not_checked' as const},{...report,physicalEvidence:'incomplete' as const}])assert.equal(decideReadiness([],r).ready,false);
 for(const code of ['GRAPH_SITES_SELECTED','MIGRATIONS_CURRENT','BACKEND_READY','SHAREPOINT_READ','RS_FRONTEND_COMPATIBILITY']){
  const result=decideReadiness([{code,passed:false,detail:'missing'}],report);assert.equal(result.ready,false);assert(result.blockers.includes(code));
 }
});
