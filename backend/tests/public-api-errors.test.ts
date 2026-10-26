import assert from 'node:assert/strict';
import test from 'node:test';
import {mapApiError,withPublicValidationIssues} from '../src/http/api-error.js';
import {buildApp} from '../src/app.js';
import {IamRepository} from '../src/iam/repository.js';
import {RsGenerationError,RsGenerationService} from '../src/contracts/rs-generation-service.js';
import {ContractAppendixValidationError} from '../src/shared/contract-appendices.js';

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
test('missing contractual payment data is not misreported as a permission failure',()=>{
  for(const code of ['PAYMENT_TERMS_FEE_REQUIRED','PAYMENT_TERMS_CURRENT_VERSION_REQUIRED','PAYMENT_TERMS_DELIVERY_EVIDENCE_REQUIRED','PAYMENT_TERMS_UNIT_CODE_REQUIRED']){
    const result=mapApiError(new Error(code),409,'terms-test');
    assert.equal(result.code,code);assert.doesNotMatch(result.message,/oprávnění|PAYMENT_TERMS|SELECT|undefined/);
    assert.deepEqual(mapApiError(result,409,'terms-test'),result);
  }
});
test('appendix conflicts retain safe Czech messages through repeated serialization',()=>{
  for(const code of ['CONTRACT_APPENDIX_NEW_VERSION_REQUIRED','CONTRACT_APPENDIX_DOCUMENT_NOT_READY','CONTRACT_APPENDIX_CHANGED']){
    const mapped=mapApiError({code},409,'appendix-test');assert.equal(mapped.code,code);
    assert.doesNotMatch(mapped.message,/oprávnění|CONTRACT_APPENDIX|SELECT|undefined/);
    assert.deepEqual(mapApiError(mapped,409,'appendix-test'),mapped);
  }
});

test('actual appendix route separates stale-version conflict, permission denial and invalid input',async t=>{
  const identity={issuer:'https://identity.test',subject:'subject',entraTenantId:'entra',email:'test@example.test',displayName:'Technical Test'};
  const user={id:'user',email:identity.email,displayName:identity.displayName};
  t.mock.method(IamRepository.prototype,'resolveUser',async()=>user);
  t.mock.method(IamRepository.prototype,'getSession',async()=>({user,workspace:{tenantId:'tenant',tenantName:'Technical',tenantSlug:'test',membershipId:'member',roles:[],permissions:[]}}));
  let failure='CONTRACT_APPENDIX_NEW_VERSION_REQUIRED';
  t.mock.method(RsGenerationService.prototype,'setAppendix',async()=>{if(failure==='invalid')throw new ContractAppendixValidationError();throw new Error(failure);});
  const app=buildApp({database:{} as never,verifier:{verify:async()=>identity} as never,microsoftGraphAdapter:{} as never,sharepointManagedIdentityClientId:'test-identity'});
  t.after(()=>app.close());
  const request=()=>app.inject({method:'POST',url:'/v1/contracts/test-contract/appendices',headers:{authorization:'Bearer test','x-tenant-id':'tenant'},payload:{}});
  const conflict=await request();assert.equal(conflict.statusCode,409);assert.equal(conflict.json().code,failure);
  assert.doesNotMatch(conflict.json().message,/oprávnění/);assert.equal(conflict.json().correlationId,conflict.headers['x-correlation-id']);
  failure='contract.manage and documents.manage permissions required';
  const denied=await request();assert.equal(denied.statusCode,403);assert.doesNotMatch(denied.body,/documents.manage|contract.manage/);
  failure='duplicate key violates constraint "secret_appendix"';
  const internal=await request();assert.equal(internal.statusCode,409);assert.doesNotMatch(internal.body,/secret_appendix|duplicate key/);
  failure='invalid';const invalid=await request();assert.equal(invalid.statusCode,422);assert.equal(invalid.json().message,'Vyberte platnou přílohu a její konkrétní verzi.');
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

test('only trusted validation issues survive repeated mapping; arbitrary diagnostic fields never do',()=>{
  const issues=[{code:'buyer_address',field:'buyer.address',message:'Kupující nemá adresu.',
    action:{href:'/clients/test?returnTo=%2Fcontracts%2Ftest',label:'Otevřít kupujícího'}}];
  const base=mapApiError({error:'Doplňte povinné údaje.'},422,'validation-test');
  assert.equal(mapApiError({...base,issues,details:['secret']},422,'validation-test').issues,undefined);
  const trusted=withPublicValidationIssues(base,issues);
  assert.deepEqual(mapApiError(mapApiError(trusted,422,'validation-test'),422,'validation-test'),trusted);
  assert.equal(mapApiError(trusted,403,'validation-test').issues,undefined);
  assert.equal(mapApiError(trusted,500,'validation-test').issues,undefined);
  const hostile=withPublicValidationIssues(base,[{...issues[0],message:'INSERT INTO private_table secret',
    action:{href:'https://evil.test/private',label:'SELECT secret'}}]);
  const output=JSON.stringify(mapApiError(hostile,422,'validation-test'));
  assert.doesNotMatch(output,/private_table|INSERT|secret|evil/);
});

test('actual contract generation routes retain structured 422 issues through Fastify serialization',async t=>{
  const identity={issuer:'https://identity.test',subject:'subject',entraTenantId:'entra',email:'test@example.test',displayName:'Technical Test'};
  const user={id:'user',email:identity.email,displayName:identity.displayName};
  t.mock.method(IamRepository.prototype,'resolveUser',async()=>user);
  t.mock.method(IamRepository.prototype,'getSession',async()=>({user,workspace:{tenantId:'tenant',tenantName:'Technical',tenantSlug:'test',membershipId:'member',roles:[],permissions:[]}}));
  let mode:'validation'|'sql'='validation';
  t.mock.method(RsGenerationService.prototype,'generate',async()=>{
    if(mode==='sql')throw new Error('duplicate key violates constraint "private_contract_rule" after INSERT INTO contracts');
    throw new RsGenerationError('not_ready',[{code:'buyer_address',field:'buyer.address',message:'Kupující nemá adresu.',action:{href:'/clients/test',label:'Otevřít kupujícího'}}]);
  });
  const app=buildApp({database:{} as never,verifier:{verify:async()=>identity} as never,
    microsoftGraphAdapter:{} as never,sharepointManagedIdentityClientId:'test-identity'});
  t.after(()=>app.close());
  for(const suffix of ['generate','generate-rs']){
    const result=await app.inject({method:'POST',url:`/v1/contracts/test-contract/${suffix}`,
      headers:{authorization:'Bearer test','x-tenant-id':'tenant'},payload:{idempotencyKey:'test-validation-123',issues:[{message:'injected details'}]}});
    assert.equal(result.statusCode,422);
    const data=result.json();assert.equal(data.issues.length,1);assert.equal(data.issues[0].code,'buyer_address');
    assert.equal(data.issues[0].action.href,'/clients/test');assert.equal(data.correlationId,result.headers['x-correlation-id']);
    assert.doesNotMatch(result.body,/injected details/);
  }
  mode='sql';
  const failed=await app.inject({method:'POST',url:'/v1/contracts/test-contract/generate',headers:{authorization:'Bearer test','x-tenant-id':'tenant'},payload:{idempotencyKey:'test-validation-124'}});
  assert.equal(failed.statusCode,409);assert.equal(failed.json().issues,undefined);assert.doesNotMatch(failed.body,/INSERT|private_contract_rule|duplicate key/);
});
