import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/shared/snapshot-integrity.js';
test('snapshot checksum survives JSONB key reordering',()=>{
 const original={'project.name':'TECH','unit.code':'1','buyer.name':'Test'};
 const reordered={'buyer.name':'Test','project.name':'TECH','unit.code':'1'};
 assert.equal(snapshotHash(original),snapshotHash(reordered));
 assert.notEqual(snapshotHash(original),snapshotHash({...original,'unit.code':'2'}));
});
test('nonstring and nested render input cannot be fingerprinted as an approved flat snapshot',()=>{
 assert.throws(()=>snapshotHash({value:12} as unknown as Record<string,string>),/invalid/);
});
