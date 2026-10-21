import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ContractDocumentEvidenceService,ContractDocumentError} from '../src/contracts/document-evidence-service.js';

test('pre-sign verifies exact native appendix version bytes, never the latest item contents',async t=>{
  const bytes=new TextEncoder().encode('%PDF-technical appendix');
  let body=bytes,versions=['1.0','2.0'],databaseError:string|null=null;
  const downloads:Array<{itemId:string;version:string}>=[];
  const database={withContext:async(_input:unknown,work:(client:unknown)=>Promise<unknown>)=>work({query:async(sql:string)=>{
    if(sql.includes('app.assert_contract_appendices')){if(databaseError)throw new Error(databaseError);return{rows:[]};}
    if(sql.includes('FROM contract_documents l'))return{rows:[{number:1,documentId:'appendix-doc',documentVersionId:'exact-appendix-version',
      hash:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,driveId:'configured-drive',itemId:'appendix-item',externalVersionId:'1.0'}]};
    if(sql.includes('FROM sharepoint_connections'))return{rows:[{site_id:'configured-site',drive_id:'configured-drive'}]};
    throw new Error('unexpected test query');
  }})};
  const graph={getVersions:async()=>versions.map(id=>({id})),downloadFile:async(connection:{siteId:string;driveId:string},itemId:string,version:string)=>{
    assert.deepEqual(connection,{siteId:'configured-site',driveId:'configured-drive'});downloads.push({itemId,version});return body;
  }};
  const service=new ContractDocumentEvidenceService(database as never,graph as never,{} as never,'identity');
  t.mock.method(service,'exactFile',async()=>({bytes:new TextEncoder().encode('%PDF-final main contract'),evidence:{name:'final.pdf',mimeType:'application/pdf',signedAt:null}}));
  const context={tenantId:'tenant',membershipId:'member',userId:'user',contractId:'contract',versionId:'version'};
  await service.signableFile(context);assert.deepEqual(downloads,[{itemId:'appendix-item',version:'1.0'}]);
  body=new TextEncoder().encode('%PDF-changed');
  await assert.rejects(service.signableFile(context),error=>error instanceof ContractDocumentError&&error.code==='DOCUMENT_HASH_MISMATCH');
  body=bytes;versions=['2.0'];
  await assert.rejects(service.signableFile(context),error=>error instanceof ContractDocumentError&&error.code==='DOCUMENT_VERSION_UNAVAILABLE');
  databaseError='CONTRACT_APPENDIX_INCOMPLETE';
  await assert.rejects(service.signableFile(context),error=>error instanceof ContractDocumentError&&error.code==='CONTRACT_APPENDIX_INCOMPLETE'&&!error.message.includes('CONTRACT_APPENDIX'));
});
