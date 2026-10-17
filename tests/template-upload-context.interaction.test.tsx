import assert from 'node:assert/strict';
import {test} from 'node:test';
import {templateUploadContext} from '../app/lib/template-upload-context';
import type {DocumentTemplate} from '../app/repositories/template-repository';

const template=(id:string,projectId:string,outputTypeCode='reservation_contract'):DocumentTemplate=>({
  id,projectId,projectName:projectId,code:id,name:id,outputTypeCode,contractType:'RS',variantKey:'default',
  status:'draft',canManage:true,canApprove:true,versions:[],
});

test('stará odpověď předchozího projektu nesmí předvyplnit jiný projekt',()=>{
  const result=templateUploadContext([template('old','previous')],{projectId:'current',outputTypeCode:'future_purchase_contract'});
  assert.equal(result.projectId,'current');
  assert.equal(result.outputTypeCode,'future_purchase_contract');
  assert.equal(result.existing,undefined);
});

test('vybraná šablona má přednost před prvním řádkem',()=>{
  const result=templateUploadContext([template('first','project'),template('selected','project')],{projectId:'project',selectedTemplateId:'selected'});
  assert.equal(result.existing?.id,'selected');
});

test('filtr SBK nepřevezme metadata RS',()=>{
  const result=templateUploadContext([template('rs','project'),template('sbk','project','future_purchase_contract')],{projectId:'project',outputTypeCode:'future_purchase_contract',selectedTemplateId:'rs'});
  assert.equal(result.existing?.id,'sbk');
});

test('globální pohled zachová kontext vybrané šablony',()=>{
  const result=templateUploadContext([template('first','one'),template('selected','two')],{selectedTemplateId:'selected'});
  assert.equal(result.projectId,'two');
  assert.equal(result.existing?.id,'selected');
});

test('prázdný seznam použije pouze autorizovaný výchozí projekt',()=>{
  assert.equal(templateUploadContext([],{fallbackProjectId:'allowed'}).projectId,'allowed');
  assert.equal(templateUploadContext([],{}).projectId,'');
});
