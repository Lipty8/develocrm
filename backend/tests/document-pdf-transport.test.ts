import assert from 'node:assert/strict';
import test from 'node:test';
import {buildApp} from '../src/app.js';
import {IamRepository} from '../src/iam/repository.js';
import {SharePointDocumentUploadService,type DocumentUploadInput} from '../src/documents/upload-service.js';
import {PDF_DOCUMENT_MAX_BYTES} from '../src/documents/file-limits.js';

test('PDF HTTP transport accepts >8 MiB, rejects oversize, and keeps template limits',async t=>{
  const identity={issuer:'https://identity.test',subject:'subject',entraTenantId:'entra',email:'technical@example.test',displayName:'Technical'};
  const user={id:'user',email:identity.email,displayName:identity.displayName};
  t.mock.method(IamRepository.prototype,'resolveUser',async()=>user);
  t.mock.method(IamRepository.prototype,'getSession',async()=>({user,workspace:{tenantId:'tenant',tenantName:'Technical',tenantSlug:'test',membershipId:'member',roles:[],permissions:[]}}));
  let calls=0;
  t.mock.method(SharePointDocumentUploadService.prototype,'upload',async(input:DocumentUploadInput)=>{
    calls++;assert.equal(input.bytes.byteLength,10*1024*1024);
    assert.equal(input.tenantId,'tenant');assert.equal(input.membershipId,'member');
    return{documentId:'document',documentVersionId:'version',itemId:'item',driveId:'configured',webUrl:null,etag:'etag',replayed:false};
  });
  const app=buildApp({database:{} as never,verifier:{verify:async()=>identity} as never,microsoftGraphAdapter:{} as never,sharepointManagedIdentityClientId:'identity'});
  t.after(()=>app.close());
  const headers={authorization:'Bearer fixture','x-tenant-id':'tenant'};
  const bytes=Buffer.alloc(10*1024*1024);bytes.write('%PDF-1.6');
  const payload={projectId:'project',documentName:'Technical appendix',fileName:'standard.pdf',mimeType:'application/pdf',contentBase64:bytes.toString('base64'),idempotencyKey:'technical-upload',versionLabel:'v1'};
  const response=await app.inject({method:'POST',url:'/v1/documents/sharepoint-upload',headers,payload});
  assert.equal(response.statusCode,201);assert.equal(calls,1);
  const oversized=Buffer.alloc(PDF_DOCUMENT_MAX_BYTES+1).toString('base64');
  const rejected=await app.inject({method:'POST',url:'/v1/documents/sharepoint-upload',headers,payload:{...payload,contentBase64:oversized}});
  assert.equal(rejected.statusCode,400);assert.match(rejected.json().error,/příliš velký/);assert.equal(calls,1);
  const template=await app.inject({method:'POST',url:'/v1/document-templates/upload',headers,payload:{...payload,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',fileName:'template.docx'}});
  assert.equal(template.statusCode,413);assert.equal(calls,1);
});
