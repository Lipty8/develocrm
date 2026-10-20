import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {inspectDocxTemplate,renderDocxTemplate} from '../src/documents/docx-template.js';
import {buildOriginalContractSnapshot,OriginalContractSnapshotError} from '../src/contracts/original-contract-snapshot.js';
import {buildSnapshot,RsGenerationService} from '../src/contracts/rs-generation-service.js';
import type {RsSource} from '../src/contracts/rs-generation-repository.js';
import {ORIGINAL_DOB_FULL_VARIANT,ORIGINAL_TEMPLATE_CATALOGS} from '../src/documents/template-catalog.js';
import {originalMoney} from '../src/contracts/original-money.js';

function fixture(type:'rs'|'sbk'='rs'):RsSource{return{
 contractId:'technical-contract',projectId:'technical-project',projectName:'Technical project',projectCode:'TECH',completionYear:'2028',
 unitId:'technical-unit',unitCode:'T-701',contractType:type,templateVariant:ORIGINAL_DOB_FULL_VARIANT,
 floorNumber:3,floorLabel:'3.NP',layout:'2+kk',areaM2:55.5,balconyM2:5,terraceM2:null,gardenM2:12,
 unitPrice:4500000,totalPrice:5000000.03,reservationFee:250000,reservationFeeDueDays:3,reservationPeriodDays:30,
 settings:{name:'TECHNICKÝ PRODÁVAJÍCÍ s.r.o.',address:'Testovací sídlo 1, Praha',registrationNumber:'00000000',registryEntry:'Technický zápis',representative:'Testovacím zástupcem',email:'seller@example.test',dataBox:'TEST',bankAccount:'TEST-1',bankName:'TECHNICKÁ BANKA',signatureName:'Testovací zástupce',clientChangesBankAccount:'TEST-2',deliveryAddress:'Testovací doručování 2'},
 salesCaseId:'technical-case',reference:'TECH-RS-SBK',status:'draft',caseStatus:'active',variableSymbol:'701001',signedRsCount:1,paidReservationFee:250000,
 signingPlan:{versionId:'technical-version',sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03',editable:true},
 buyers:[{id:'technical-buyer',partyType:'individual',displayName:'Testovací Kupující',salutation:'paní',firstName:'Testovací',lastName:'Kupující',birthDate:'1990-01-01',registrationNumber:null,address:'Testovací bydliště 1, Praha, CZ',deliveryAddress:'Testovací doručování 3, Brno, CZ',email:'buyer@example.test',phone:'+420 777 000 701',dataBox:null}],
 accessories:[{code:'S-1',type:'cellar',legalForm:'cellar_unit',amount:100000,floorLabel:'1.PP',description:null},{code:'P-1',type:'parking',legalForm:'outdoor_parking_use_right',amount:200000,floorLabel:null,description:null},{code:'G-1',type:'garage',legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25,amount:200000,floorLabel:'1.PP',description:null}],
 templateVersionId:'technical-template-version',templateHash:'sha256:technical',templateApprovalStatus:'draft',approvedTemplateCount:0,documentId:null,documentVersionId:null,webUrl:null,contractVersion:null,
};}
const normalized=(value:string)=>value.replace(/\u00a0/g,' ');

test('originálová RS mapuje přesně svých 32 scalar polí bez skládání právních odstavců',()=>{
 const source=fixture();const result=buildOriginalContractSnapshot(source);
 assert.deepEqual(Object.keys(result).sort(),Object.keys(ORIGINAL_TEMPLATE_CATALOGS.reservation_contract.fields).sort());assert.equal(Object.keys(result).length,32);
 assert.equal(result['buyer.salutation'],'Paní');assert.equal(result['buyer.name'],'Testovací Kupující');assert.equal(result['buyer.birthDate'],'1. 1. 1990');
 assert.equal(result['buyer.dataBox'],'neuvedena');assert.equal(result['seller.signatureName'],'Testovací zástupce');assert.equal(result['unit.variableSymbol'],'701001');
 assert.equal(result['unit.floorNumber'],'3.');assert.equal(result['unit.outdoorSpaceCase'],'balkonu');
 assert.equal(result['contract.sellerPlannedDate'],'2. 11. 2026');assert.equal(result['contract.buyerPlannedDate'],'3. 11. 2026');
 assert.equal(normalized(result['contract.totalPriceAmount']),'5 000 000,03');assert.equal(result['contract.totalPriceWords'],'pět milionů celých tři setiny');
 assert.equal(result['payment.reservationFeeWords'],'dvě stě padesát tisíc');assert.deepEqual(buildSnapshot(source),result);
 assert.ok(!Object.keys(result).some(key=>key.endsWith('Clause')||key==='contract.date'));
});
test('originálová SBK mapuje přesně 37 polí a používá centrální přesný platební plán',()=>{
 const source=fixture('sbk');source.balconyM2=null;source.terraceM2=7.25;
 const result=buildSnapshot(source);assert.deepEqual(Object.keys(result).sort(),Object.keys(ORIGINAL_TEMPLATE_CATALOGS.future_purchase_contract.fields).sort());assert.equal(Object.keys(result).length,37);
 assert.equal(result['unit.outdoorSpaceCase'],'Terasy');assert.equal(result['unit.outdoorSpaceArea'],'7,25');assert.equal(result['unit.area'],'55,5');
 assert.equal(result['buyer.deliveryAddress'],'Testovací doručování 3, Brno, CZ');assert.equal(result['seller.clientChangesBankAccount'],'TEST-2');
 assert.equal(normalized(result['payment.reservationFeePaidAmount']),'250 000');assert.equal(normalized(result['payment.firstInstallmentAmount']),'1 000 000,01');assert.equal(normalized(result['payment.finalInstallmentAmount']),'3 750 000,02');
 assert.equal(result['buyer.dataBox'],undefined);assert.equal(result['payment.reservationFeeAmount'],undefined);
});
test('žádná chybějící hodnota se nenahrazuje datem vytvoření, bydlištěm nebo cenou nula',()=>{
 for(const source of [
  {...fixture(),signingPlan:null},{...fixture(),settings:null},{...fixture(),totalPrice:null},
  {...fixture(),totalPrice:0},{...fixture(),floorNumber:null},{...fixture(),accessories:[]},
  {...fixture(),balconyM2:5,terraceM2:6},{...fixture(),templateVariant:'default'},
  {...fixture(),buyers:[]},{...fixture(),buyers:[{...fixture().buyers[0],partyType:'organization' as const}]},
  {...fixture('sbk'),buyers:[{...fixture('sbk').buyers[0],deliveryAddress:null}]},
 ])assert.throws(()=>buildOriginalContractSnapshot(source),OriginalContractSnapshotError);
 assert.throws(()=>buildSnapshot({...fixture(),accessories:[...fixture().accessories,{code:'P-2',type:'parking',amount:1,floorLabel:'garáž',description:'venkovní'}]}),OriginalContractSnapshotError);
});
test('zaplacená RS se nepředstírá předpisem ani historickou smlouvou jiného obchodu',()=>{
 for(const extra of [{signedRsCount:0},{signedRsCount:2},{paidReservationFee:0},{paidReservationFee:100000},{paidReservationFee:300000}])
  assert.throws(()=>buildSnapshot({...fixture('sbk'),...extra}));
});
test('mapování je deterministické, nemutuje zdroj a neobsahuje nepoužitá data',()=>{
 const source=fixture();const before=JSON.stringify(source),first=buildSnapshot(source);
 assert.equal(JSON.stringify(source),before);assert.deepEqual(first,buildSnapshot(source));
 assert.ok(!Object.values(first).includes(source.projectId));assert.ok(!Object.values(first).includes(source.salesCaseId));assert.equal(first['project.name'],undefined);
 source.buyers[0].address='Změněná testovací adresa';const next=buildSnapshot(source);assert.notEqual(next['buyer.address'],first['buyer.address']);assert.equal(first['buyer.address'],'Testovací bydliště 1, Praha, CZ');
});
test('scalar mapper nezapíná schválení, právní fakta ani generationSupported',async()=>{
 for(const contractType of ['rs','sbk'] as const){const source=fixture(contractType);const readiness=await new RsGenerationService({load:async()=>source} as never,{} as never).readiness({tenantId:'technical-tenant',userId:'technical-user',membershipId:'technical-member',contractId:source.contractId});
  assert.equal(readiness.ready,false);assert.ok(!readiness.issues.some(issue=>issue.code==='accessory_legal_basis'));assert.ok(readiness.issues.some(issue=>issue.code==='original_profile_review'));
 }
 assert.equal(ORIGINAL_TEMPLATE_CATALOGS.reservation_contract.generationSupported,false);assert.equal(ORIGINAL_TEMPLATE_CATALOGS.future_purchase_contract.generationSupported,false);
});
test('smluvní forma se nedovozuje z kategorie, označení nebo popisu a nesprávný podíl blokuje mapper',()=>{
 const missing=fixture();delete missing.accessories[2].legalForm;
 assert.throws(()=>buildSnapshot(missing),OriginalContractSnapshotError);
 const wrong=fixture('sbk');wrong.accessories[2].shareDenominator=24;
 assert.throws(()=>buildSnapshot(wrong),OriginalContractSnapshotError);
 const missingShare=fixture('sbk');delete missingShare.accessories[2].shareDenominator;delete missingShare.accessories[2].shareNumerator;
 assert.throws(()=>buildSnapshot(missingShare),OriginalContractSnapshotError);
 const formula=fixture();delete formula.accessories[2].shareDenominator;delete formula.accessories[2].shareNumerator;
 assert.equal(buildSnapshot(formula)['unit.garageCode'],'G-1');
 formula.accessories[2].shareNumerator=2;formula.accessories[2].shareDenominator=25;
 assert.throws(()=>buildSnapshot(formula),OriginalContractSnapshotError);
});
test('chybějící právní údaje odkazují na skutečnou projektovou záložku, ne ignorovaný query parametr',async()=>{
 const source=fixture();for(const item of source.accessories)delete item.legalForm;
 const readiness=await new RsGenerationService({load:async()=>source} as never,{} as never).readiness({tenantId:'technical-tenant',userId:'technical-user',membershipId:'technical-member',contractId:source.contractId});
 const issues=readiness.issues.filter(item=>item.code==='accessory_legal_basis');assert.equal(issues.length,3);
 assert.ok(issues[0].action?.href.startsWith('/projects/technical-project/cellars?returnTo='));
 assert.ok(issues[1].action?.href.startsWith('/projects/technical-project/parking?returnTo='));
 assert.ok(issues.every(item=>!item.action?.href.includes('tab=')));
});
test('přesné peníze neignorují haléře, záporné hodnoty ani přetečení DB rozsahu',()=>{
 for(const value of ['NaN','1e6','1000000000000','1.005','-1','2 000',Infinity])assert.throws(()=>originalMoney(value));
 assert.equal(originalMoney('5000000.03').decimal,'5000000.03');assert.equal(originalMoney('999999999999.99').minor,BigInt('99999999999999'));
 assert.equal(originalMoney(2000000000).words,'dvě miliardy');assert.equal(originalMoney(1000000000).words,'jedna miliarda');
 assert.equal(originalMoney(21000000).words,'dvacet jedna milionů');assert.equal(originalMoney('1.01').words,'jedna celá jedna setina');
});
for(const type of ['rs','sbk'] as const)test(`${type}: připravenost pojmenuje neplatnou smluvní částku dříve než scalar renderer`,async()=>{
 for(const [changes,code] of [
  [{totalPrice:0},'contract_price'],[{totalPrice:NaN},'contract_price'],
  [{totalPrice:5000000.005},'contract_price'],[{reservationFee:0},'contract_fee'],
  [{reservationFee:0.001},'contract_fee'],[{reservationFee:6000000},'contract_fee'],
 ] as const){
  const source={...fixture(type),...changes};
  assert.throws(()=>buildSnapshot(source),OriginalContractSnapshotError);
  const result=await new RsGenerationService({load:async()=>source} as never,{} as never).readiness({tenantId:'technical-tenant',userId:'technical-user',membershipId:'technical-member',contractId:source.contractId});
  assert.ok(result.issues.some(item=>item.code===code),`${code}: ${JSON.stringify(changes)}`);
  assert.equal(result.ready,false);assert.ok(result.issues.some(item=>item.code==='original_profile_review'));
 }
});
test('platné haléřové částky a chybějící hodnoty zachovají existující pravidla připravenosti',async()=>{
 for(const type of ['rs','sbk'] as const){
  const source=fixture(type),service=new RsGenerationService({load:async()=>source} as never,{} as never);
  const input={tenantId:'technical-tenant',userId:'technical-user',membershipId:'technical-member',contractId:source.contractId};
  const valid=await service.readiness(input);
  assert.ok(!valid.issues.some(item=>['contract_price','contract_fee'].includes(item.code)));
  source.totalPrice=null;source.reservationFee=null;
  const missing=await service.readiness(input);
  assert.ok(missing.issues.some(item=>item.code==='price'));assert.ok(missing.issues.some(item=>item.code==='reservation_fee'));
  assert.ok(!missing.issues.some(item=>['contract_price','contract_fee'].includes(item.code)));
 }
});
for(const type of ['rs','sbk'] as const)test(`skutečná neaktivní ${type.toUpperCase()} šablona přijme serverové scalar mapování a zachová ostatní části Wordu`,async()=>{
 const template=await readFile(new URL(`../templates/review/${type}-dejvice-original-review.docx`,import.meta.url));
 const snapshot=buildSnapshot(fixture(type)),tokens=Object.keys(snapshot);
 const output=renderDocxTemplate(template,snapshot,{allowedTokens:tokens,requiredTokens:tokens}).bytes;
 assert.equal(inspectDocxTemplate(output).tokens.length,0);
 const before=unzipSync(template),after=unzipSync(output);assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());
 for(const part of Object.keys(before))if(part!=='word/document.xml')assert.deepEqual(after[part],before[part],part);
 const xml=new TextDecoder().decode(after['word/document.xml']);
 assert.match(xml,/Testovací Kupující/);assert.match(xml,/5[\s\u00a0]000[\s\u00a0]000,03/);assert.match(xml,/2\. 11\. 2026/);assert.doesNotMatch(xml,/\{\{/);
});
