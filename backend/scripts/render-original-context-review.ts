import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import type {RsSource} from '../src/contracts/rs-generation-repository.js';
import {buildOriginalContractSnapshot} from '../src/contracts/original-contract-snapshot.js';
import {ORIGINAL_DOB_FULL_VARIANT} from '../src/documents/template-catalog.js';
import {inspectDocxTemplate,renderDocxTemplate} from '../src/documents/docx-template.js';

// Offline, explicit synthetic context only. No DB, Graph, approval or activation.
const [rsOriginal,sbkOriginal,directory]=process.argv.slice(2);
if(!rsOriginal||!sbkOriginal||!directory)throw new Error('Usage: render-original-context-review.ts RS.docx SBK.docx /absolute/output');
type Manifest={sourceSha256:string;templateSha256:string;status:string;activationAllowed:boolean;sampleIsSynthetic:boolean;
  schema:{fields:Record<string,{required:boolean}>};sampleValues:Record<string,string>;
  slots:Array<{paragraph:number;start:number;end:number;original:string;replacement:string;key:string|null}>};
const digest=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const decode=(value:string)=>value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const text=(xml:string)=>[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(p=>[...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t=>decode(t[1])).join(''));
const structure=(xml:string)=>xml.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/g,'$1$2');
await mkdir(resolve(directory),{recursive:true});
for(const kind of ['rs','sbk'] as const){
  const base=new URL('../templates/review/',import.meta.url);
  const m=JSON.parse(await readFile(new URL(`${kind}-review-manifest.json`,base),'utf8')) as Manifest;
  assert.equal(m.status,'draft');assert.equal(m.activationAllowed,false);assert.equal(m.sampleIsSynthetic,true);
  const original=await readFile(resolve(kind==='rs'?rsOriginal:sbkOriginal));assert.equal(digest(original),m.sourceSha256,'Wrong original');
  const template=await readFile(new URL(`${kind}-dejvice-original-review.docx`,base));assert.equal(digest(template),m.templateSha256,'Wrong template');
  const v=m.sampleValues;
  const source:RsSource={
    contractId:'technical-review-contract',projectId:'technical-review-project',projectName:'Rezidence Dejvice',projectCode:'TECH-REVIEW',completionYear:'2027',
    unitId:'technical-review-unit',unitCode:'TECH-701',contractType:kind,templateVariant:ORIGINAL_DOB_FULL_VARIANT,
    floorNumber:3,floorLabel:'3. NP',layout:'2+kk',areaM2:55.5,balconyM2:5,terraceM2:null,gardenM2:12,unitPrice:4500000.03,totalPrice:5000000.03,
    reservationFee:250000,reservationFeeDueDays:3,reservationPeriodDays:30,
    settings:{name:v['seller.name'],address:v['seller.address'],registrationNumber:v['seller.registrationNumber'],registryEntry:v['seller.registryEntry'],
      representative:v['seller.representative'],email:v['seller.email'],dataBox:v['seller.dataBox'],bankAccount:v['seller.bankAccount'],bankName:v['seller.bankName'],
      signatureName:v['seller.signatureName'],clientChangesBankAccount:v['seller.clientChangesBankAccount'],deliveryAddress:undefined},
    salesCaseId:'technical-review-case',reference:`TECH-REVIEW-${kind.toUpperCase()}`,status:'draft',caseStatus:'active',variableSymbol:'701001',signedRsCount:1,paidReservationFee:250000,
    signingPlan:{versionId:'technical-review-version',sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03',editable:true},
    buyers:[{id:'technical-review-buyer',partyType:'individual',displayName:'TESTOVACÍ KUPUJÍCÍ NEPODEPISOVAT',salutation:'paní',firstName:'TESTOVACÍ',lastName:'KUPUJÍCÍ NEPODEPISOVAT',birthDate:'1990-01-01',registrationNumber:null,
      address:'Testovací 701, 160 00 Praha 6',deliveryAddress:'Doručovací 701, 160 00 Praha 6',email:'buyer@example.test',phone:'+420 777 000 701',dataBox:null}],
    accessories:[{code:'S-TEST1',type:'cellar',legalForm:'cellar_unit',amount:100000,floorLabel:'1. PP',description:null},
      {code:'P-TEST1',type:'parking',legalForm:'outdoor_parking_use_right',amount:200000,floorLabel:null,description:null},
      {code:'P-TEST2',type:'garage',legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25,amount:200000,floorLabel:'1. PP',description:null}],
    templateVersionId:'technical-review-template',templateHash:`sha256:${m.templateSha256}`,templateApprovalStatus:'draft',approvedTemplateCount:0,documentId:null,documentVersionId:null,webUrl:null,contractVersion:null,
  };
  const snapshot=buildOriginalContractSnapshot(source),fields=Object.keys(m.schema.fields).sort();
  assert.deepEqual(Object.keys(snapshot).sort(),fields);
  const output=renderDocxTemplate(template,snapshot,{allowedTokens:fields,requiredTokens:fields}).bytes;
  const inspected=inspectDocxTemplate(output);assert.deepEqual(inspected.tokens,[]);assert.deepEqual(inspected.malformedTokens,[]);assert.deepEqual(inspected.legacyMarkers,[]);
  const a=unzipSync(original),b=unzipSync(output);assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());
  for(const part of Object.keys(a))if(part!=='word/document.xml')assert.equal(digest(a[part]),digest(b[part]),`Preserve-only part ${part}`);
  const before=strFromU8(a['word/document.xml']),after=strFromU8(b['word/document.xml']);assert.equal(structure(before),structure(after));
  const expected=text(before).map((paragraph,index)=>{
    for(const slot of m.slots.filter(s=>s.paragraph===index).sort((x,y)=>y.start-x.start)){
      assert.equal(paragraph.slice(slot.start,slot.end),slot.original);
      paragraph=paragraph.slice(0,slot.start)+(slot.key?snapshot[slot.key]:slot.replacement)+paragraph.slice(slot.end);
    }return paragraph;
  });
  const actual=text(after);assert.equal(actual.length,expected.length);
  for(let i=0;i<actual.length;i++)assert.equal(digest(actual[i]),digest(expected[i]),`Unexplained paragraph ${i}`);
  const fileName=`${kind}-technicky-vyplneny-ke-kontrole-2026-10-20.docx`;
  await writeFile(resolve(directory,fileName),output);
  await writeFile(resolve(directory,`${kind}-verification.json`),JSON.stringify({synthetic:true,activation:false,sourceSha256:m.sourceSha256,templateSha256:m.templateSha256,
    outputSha256:digest(output),snapshotSha256:digest(JSON.stringify(snapshot)),snapshot,paragraphs:actual.length,fields:fields.length,
    exactSourceComparison:true,preserveOnlyParts:true,structureUnchanged:true,unresolved:0,contentReviewRequired:true},null,2)+'\n');
  console.log(JSON.stringify({kind,paragraphs:actual.length,fields:fields.length,preserveOnlyParts:true,unresolved:0,outputSha256:digest(output),activation:false}));
}
