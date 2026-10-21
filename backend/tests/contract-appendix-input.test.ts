import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contractAppendixInput,contractAppendixRequirements,ContractAppendixValidationError} from '../src/shared/contract-appendices.js';
import {ORIGINAL_DOB_FULL_VARIANT,SBK_DOB_DELIVERY_VARIANT} from '../src/documents/template-catalog.js';

test('original appendix positions are explicit, type-specific and never guessed for another template',()=>{
  assert.deepEqual(contractAppendixRequirements('rs',ORIGINAL_DOB_FULL_VARIANT).map(item=>item.label),
    ['Katalogový list Bytu','Situace sklepy','Situace parking','Koordinační situace','Standardní vybavení Bytu','Plná moc']);
  for(const variant of [ORIGINAL_DOB_FULL_VARIANT,SBK_DOB_DELIVERY_VARIANT]){
    const sbk=contractAppendixRequirements('sbk',variant);assert.equal(sbk.length,5);
    assert.deepEqual(sbk.map(item=>item.number),[1,2,3,4,5]);assert.equal(sbk[4].label,'Znění Kupní smlouvy');
  }
  assert.deepEqual(contractAppendixRequirements('rs','default'),[]);
  assert.deepEqual(contractAppendixRequirements('rs',SBK_DOB_DELIVERY_VARIANT),[]);
  assert.deepEqual(contractAppendixRequirements('sbk','unknown'),[]);
});
test('appendix command accepts exact IDs and explicit optimistic concurrency token only',()=>{
  const input={versionId:randomUUID(),number:1,documentId:randomUUID(),documentVersionId:randomUUID(),expectedDocumentVersionId:null};
  assert.deepEqual(contractAppendixInput(input),input);
  assert.deepEqual(contractAppendixInput({...input,documentId:null,documentVersionId:null,expectedDocumentVersionId:input.documentVersionId}),
    {...input,documentId:null,documentVersionId:null,expectedDocumentVersionId:input.documentVersionId});
  for(const invalid of [null,[],{}, {...input,versionId:'417'},{...input,number:'1'},{...input,number:0},{...input,number:1.5},
    {...input,documentVersionId:null},{...input,documentId:null},{...input,expectedDocumentVersionId:undefined},
    {...input,driveId:'foreign-drive'},{...input,siteId:'foreign-site'},{...input,path:'../other.pdf'},
    {...input,filename:'appendix.pdf'},{...input,documentVersionId:'latest'}])
    assert.throws(()=>contractAppendixInput(invalid),ContractAppendixValidationError);
});
