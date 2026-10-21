import assert from 'node:assert/strict';
import test from 'node:test';
import {strToU8,zipSync} from 'fflate';
import {ContractDocumentEvidenceService,ContractDocumentError} from '../src/contracts/document-evidence-service.js';
import {buildApp} from '../src/app.js';
import {IamRepository} from '../src/iam/repository.js';
import {CommercialService} from '../src/commercial/service.js';

const mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function docx(text:string,part='word/document.xml'){
  return zipSync({'[Content_Types].xml':strToU8('<Types/>'),
    'word/document.xml':strToU8('<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Finální technický dokument.</w:t></w:r></w:p></w:body></w:document>'),
    [part]:strToU8(`<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)});
}
const context={tenantId:'tenant',userId:'user',membershipId:'member',contractId:'contract',idempotencyKey:'technical-final-file',fileName:'final.docx',mimeType};

test('external final DOCX refuses every supported unresolved-marker class before DB or storage',async()=>{
  let dbCalls=0;
  const service=new ContractDocumentEvidenceService({withContext:async()=>{dbCalls++;throw new Error('database reached');}} as never,{} as never,{} as never,'identity');
  for(const marker of ['{{buyer.name}}','{{buyer name}}','{{buyer.name','}}','[●]','[•]','[doplnit]','[ VYPLNIT ]']){
    for(const part of ['word/document.xml','word/header1.xml','word/footer1.xml','word/footnotes.xml','word/endnotes.xml']){
      await assert.rejects(service.uploadExternal({...context,bytes:docx(marker,part)}),
        (error:unknown)=>error instanceof ContractDocumentError&&error.code==='unresolved_document_fields',`${part}: ${marker}`);
    }
  }
  assert.equal(dbCalls,0);
});

test('clean final DOCX passes content validation; ordinary text is not a placeholder',async()=>{
  const service=new ContractDocumentEvidenceService({withContext:async()=>{throw new Error('authorized database boundary');}} as never,{} as never,{} as never,'identity');
  await assert.rejects(service.uploadExternal({...context,bytes:docx('Kupující [poznámka] • příloha č. 1 – bez prázdných polí.')}),/authorized database boundary/);
  await assert.rejects(service.uploadExternal({...context,bytes:new Uint8Array([0x50,0x4b,0,0])}),
    (e:unknown)=>e instanceof ContractDocumentError&&e.code==='invalid_final_docx');
});

test('pre-sign rechecks already stored unsigned bytes, preserving historical download and signed replay',async t=>{
  const service=new ContractDocumentEvidenceService({} as never,{} as never,{} as never,'identity');
  let signedAt:string|null=null;
  let bytes=docx('[doplnit]');
  t.mock.method(service,'exactFile',async()=>({bytes,evidence:{name:'final.docx',mimeType,signedAt}}));
  t.mock.method(service,'appendixEvidence',async()=>[]);
  const input={tenantId:'tenant',userId:'user',membershipId:'member',contractId:'contract',versionId:'version'};
  await assert.rejects(service.signableFile(input),(e:unknown)=>e instanceof ContractDocumentError&&e.code==='unresolved_document_fields');
  assert.deepEqual((await service.exactFile(input)).bytes,bytes,'historical file remains retrievable');
  bytes=docx('Vyplněný technický dokument.');
  assert.deepEqual((await service.signableFile(input)).bytes,bytes);
  bytes=docx('[doplnit]');signedAt='2026-10-01T12:00:00Z';
  assert.deepEqual((await service.signableFile(input)).bytes,bytes,'existing signature replay is not a new legal-content decision');
});

test('both signature routes and document readiness reject stored unresolved DOCX before business mutation',async t=>{
  const identity={issuer:'https://identity.test',subject:'subject',entraTenantId:'entra',email:'test@example.test',displayName:'Technical Test'};
  const user={id:'user',email:identity.email,displayName:identity.displayName};
  t.mock.method(IamRepository.prototype,'resolveUser',async()=>user);
  t.mock.method(IamRepository.prototype,'getSession',async()=>({user,workspace:{tenantId:'tenant',tenantName:'Technical',tenantSlug:'test',membershipId:'member',roles:[],permissions:[]}}));
  const bytes=docx('[doplnit]');
  t.mock.method(ContractDocumentEvidenceService.prototype,'exactFile',async()=>({bytes,evidence:{name:'final.docx',mimeType,signedAt:null,documentVersionId:'doc-version'}}));
  let mutations=0;
  t.mock.method(CommercialService.prototype,'signContract',async()=>{mutations++;throw new Error('must not sign');});
  t.mock.method(CommercialService.prototype,'sign',async()=>{mutations++;throw new Error('must not sign');});
  const database={withContext:async(_input:unknown,work:(client:unknown)=>Promise<unknown>)=>work({query:async()=>({rows:[{contract_id:'contract'}]})})};
  const app=buildApp({database:database as never,verifier:{verify:async()=>identity} as never,microsoftGraphAdapter:{} as never,sharepointManagedIdentityClientId:'identity'});
  t.after(()=>app.close());const headers={authorization:'Bearer test','x-tenant-id':'tenant'};
  for(const url of ['/v1/contracts/contract/sign','/v1/contract-parties/party/sign']){
    const result=await app.inject({method:'POST',url,headers,payload:{versionId:'version',signedAt:'2026-10-21T08:00:00Z',reason:'Technical test'}});
    assert.equal(result.statusCode,409);assert.equal(result.json().correlationId,result.headers['x-correlation-id']);
    assert.doesNotMatch(result.body,/\[doplnit\]|unresolved_document_fields/);
  }
  assert.equal((await app.inject({method:'GET',url:'/v1/contracts/contract/versions/version/document-readiness',headers})).statusCode,409);
  assert.equal((await app.inject({method:'GET',url:'/v1/contracts/contract/versions/version/document',headers})).statusCode,200,'history remains downloadable');
  const upload=await app.inject({method:'POST',url:'/v1/contracts/contract/external-document',headers,payload:{fileName:'final.docx',mimeType,contentBase64:Buffer.from(bytes).toString('base64'),idempotencyKey:'technical-final-file'}});
  assert.equal(upload.statusCode,409);assert.match(upload.json().error,/Dokument obsahuje nevyplněná pole/);
  assert.equal(mutations,0);
});
