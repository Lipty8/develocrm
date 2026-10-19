import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeAccessoryLegalDetails as normalize,originalAccessoryKind} from '../src/shared/accessory-legal-details.js';
test('legal details validate complete fractions without guessing unknown rights',()=>{
 assert.deepEqual(normalize({legalForm:null}),{legalForm:null,shareNumerator:null,shareDenominator:null});
 assert.deepEqual(normalize({legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25}),{legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25});
 for(const value of [null,[],{}, {legalForm:'garage'}, {legalForm:3},{legalForm:'garage_coownership',shareNumerator:1},{legalForm:'garage_coownership',shareNumerator:0,shareDenominator:25},{legalForm:'garage_coownership',shareNumerator:2,shareDenominator:1},{legalForm:'garage_coownership',shareNumerator:1,shareDenominator:1000000001},{legalForm:'garage_coownership',shareNumerator:'1',shareDenominator:25},{legalForm:'cellar_unit',shareNumerator:1,shareDenominator:25},{legalForm:null,projectId:'other'}])assert.throws(()=>normalize(value));
 assert.equal(originalAccessoryKind({type:'parking'}),null);
 assert.equal(originalAccessoryKind({type:'garage'}),null);
 assert.equal(originalAccessoryKind({type:'parking',legalForm:'garage_coownership'}),'garage');
 assert.equal(originalAccessoryKind({type:'parking',legalForm:'outdoor_parking_use_right'}),'outdoor_parking');
 assert.equal(originalAccessoryKind({type:'cellar',legalForm:'garage_coownership'}),null);
});
