import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeAccessoryLegalDetails as normalize,originalAccessoryKind,normalizeAccessoryLocation} from '../src/shared/accessory-legal-details.js';
test('accessory location is explicit text, trimmed, optional and never inferred',()=>{
 assert.equal(normalizeAccessoryLocation('  1. PP  '),'1. PP');assert.equal(normalizeAccessoryLocation(''),null);assert.equal(normalizeAccessoryLocation(null),null);
 for(const value of [undefined,{},42,'x'.repeat(121),'1. PP\n2. PP','\u0000','\u007f'])assert.throws(()=>normalizeAccessoryLocation(value),/Umístění/);
});
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
