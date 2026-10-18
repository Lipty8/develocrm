import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePartyAddress,PartyAddressValidationError} from '../src/shared/party-address.js';

const valid={addressType:'correspondence',line1:' Testovací 1 ',line2:null,city:' Praha ',postalCode:null,countryCode:'cz'};
test('adresní normalizace zachová typ, rozliší adresy a přijme prázdná nepovinná DB pole',()=>{
  const value=normalizePartyAddress(valid);
  assert.deepEqual(value,{addressType:'correspondence',line1:'Testovací 1',line2:'',city:'Praha',postalCode:'',countryCode:'CZ'});
  assert.equal(normalizePartyAddress({...valid,addressType:'residence'}).addressType,'residence');
  assert.equal(normalizePartyAddress({...valid,addressType:'registered_office'}).addressType,'registered_office');
});
test('neúplná nebo neplatná adresa se odmítne českou validací před zápisem',()=>{
  for(const change of [{line1:'  '},{city:''},{countryCode:'CZE'},{countryCode:'1A'},{addressType:'untrusted'},
    {line1:'x'.repeat(501)},{line2:'x\u0000y'},{city:'x\ny'}]){
    assert.throws(()=>normalizePartyAddress({...valid,...change}),error=>error instanceof PartyAddressValidationError&&error.message.length>0);
  }
});
