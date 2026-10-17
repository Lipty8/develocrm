import assert from 'node:assert/strict';
import test from 'node:test';
import {mapApiError} from '../src/http/api-error.js';

test('neplatná šablona neukazuje interní code ani detail v české hlášce',()=>{
  const result=mapApiError({error:'Šablona není platná. Zkontrolujte soubor a datová pole.',code:'invalid_template_fields',details:['unknown_placeholders']},422,'req-test');
  assert.equal(result.error,'Šablona není platná. Zkontrolujte soubor a datová pole.');
  assert.equal(result.correlationId,'req-test');
  assert.doesNotMatch(result.message,/invalid_template_fields|unknown_placeholders/);
});
test('opakované mapování přes error handler a preSerialization neduplikuje hlášku',()=>{
  const once=mapApiError({error:'Soubor je příliš velký.',code:'invalid_file_size'},422,'req-test');
  assert.deepEqual(mapApiError(once,422,'req-test'),once);
});
test('diagnostické detail/code bez uživatelské hlášky nejsou veřejná microcopy',()=>{
  const result=mapApiError({detail:'Technický vnitřní stav',code:'invalid_template_fields'},422,'req-test');
  assert.equal(result.message,'Zkontrolujte zadané údaje.');
});
test('doménový kód stále vyvolá bezpečnou srozumitelnou chybu',()=>{
  const result=mapApiError({code:'CONTRACT_CASE_CLOSED'},409,'req-test');
  assert.equal(result.code,'CONTRACT_CASE_CLOSED');
  assert.equal(result.message,'Obchod již byl ukončen. Historickou smlouvu nelze posunout ani podepsat.');
});
test('raw SQL ani diagnostický detail se nesmí dostat do veřejné chyby',()=>{
  const result=mapApiError({error:'Smlouvu nelze uložit.',detail:'duplicate key violates secret constraint after INSERT INTO contracts'},409,'req-test');
  assert.equal(result.message,'Operaci nelze dokončit kvůli aktuálnímu stavu záznamu.');
  assert.doesNotMatch(JSON.stringify(result),/secret|INSERT|duplicate key/);
});
test('Error i řetězec zachovají bezpečný český text a correlation ID',()=>{
  for(const input of [new Error('Vyberte platný dokument.'),'Vyberte platný dokument.']){
    assert.equal(mapApiError(input,422,'req-test').message,'Vyberte platný dokument.');
  }
});
