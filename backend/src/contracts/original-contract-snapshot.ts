import type {RsSource,RsAccessory} from './rs-generation-repository.js';
import {ORIGINAL_DOB_FULL_VARIANT,ORIGINAL_TEMPLATE_CATALOGS} from '../documents/template-catalog.js';
import {originalPaymentPlan} from './original-payment-plan.js';
import {originalMoney} from './original-money.js';
import {signingPlanDay} from '../shared/contract-signing-plan.js';
import {originalAccessoryKind} from '../shared/accessory-legal-details.js';
import {originalAccessoryIssues} from './original-contract-readiness.js';

export class OriginalContractSnapshotError extends Error{
  constructor(readonly field:string){super('Údaje pro smlouvu nejsou úplné nebo konzistentní.');this.name='OriginalContractSnapshotError';}
}
const fail=(field:string):never=>{throw new OriginalContractSnapshotError(field);};
function text(value:unknown,field:string):string{
  if(typeof value!=='string'||!value.trim()||value.length>4000||/[\u0000-\u001f\u007f]/.test(value)||/[{}]/.test(value))return fail(field);
  return value.trim();
}
export function originalContractDate(value:unknown,field:string){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return fail(field);
  const parsed=new Date(`${value}T12:00:00Z`);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return fail(field);
  const [year,month,day]=value.split('-');return`${Number(day)}. ${Number(month)}. ${year}`;
}
function area(value:number|null|undefined,field:string){
  if(value==null||!Number.isFinite(value)||value<=0||!/^\d{1,8}(?:\.\d{1,2})?$/.test(String(value)))return fail(field);
  return new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:2,useGrouping:false}).format(value);
}
function money(value:number|null|undefined,field:string){
  if(value==null)return fail(field);
  try{const result=originalMoney(value);if(result.minor<=BigInt(0))return fail(field);return result;}catch{return fail(field);}
}
function one(source:RsSource,type:string,field:string):RsAccessory{
  const values=source.accessories.filter(item=>originalAccessoryKind(item)===type);
  if(values.length!==1)return fail(field);return values[0];
}

/** Only scalar substitutions into the pinned original. This mapper neither
 * approves a template nor proves the source's legal ownership facts. The
 * existing readiness/approval gates must pass before live generation.
 * Input is the authorized repository projection, never a request's render data.
 */
export function buildOriginalContractSnapshot(source:RsSource):Record<string,string>{
  if(source.templateVariant!==ORIGINAL_DOB_FULL_VARIANT||!['rs','sbk'].includes(source.contractType??'rs'))return fail('template.variant');
  const sbk=source.contractType==='sbk',catalog=ORIGINAL_TEMPLATE_CATALOGS[sbk?'future_purchase_contract':'reservation_contract'];
  if(!source.settings)return fail('project.seller');const seller=source.settings;
  if(source.buyers.length!==1||source.buyers[0].partyType!=='individual')return fail('buyer.type');
  const buyer=source.buyers[0];if(!['pan','paní'].includes(buyer.salutation??''))return fail('buyer.salutation');
  if(!Number.isInteger(source.floorNumber)||(source.floorNumber??0)<1)return fail('unit.floorNumber');
  const balcony=(source.balconyM2??0)>0,terrace=(source.terraceM2??0)>0;
  if(balcony===terrace)return fail('unit.outdoorSpace');area(source.gardenM2,'unit.garden');
  if(originalAccessoryIssues(source).length)return fail('unit.accessories');
  const cellar=one(source,'cellar','unit.cellar'),garage=one(source,'garage','unit.garage'),parking=one(source,'outdoor_parking','unit.outdoorParking');
  const total=money(source.totalPrice,'contract.totalPrice'),fee=money(source.reservationFee,'payment.reservationFee');
  if(fee.minor>total.minor)return fail('payment.reservationFee');
  const plan=source.signingPlan;
  if(!plan||!signingPlanDay(plan.sellerPlannedOn)||!signingPlanDay(plan.buyerPlannedOn))return fail('contract.signingDates');
  const result:Record<string,string>={
    'seller.name':text(seller.name,'seller.name'),'seller.address':text(seller.address,'seller.address'),
    'seller.registryEntry':text(seller.registryEntry,'seller.registryEntry'),'seller.registrationNumber':text(seller.registrationNumber,'seller.registrationNumber'),
    'seller.representative':text(seller.representative,'seller.representative'),'seller.email':text(seller.email,'seller.email'),
    'seller.dataBox':text(seller.dataBox,'seller.dataBox'),'seller.bankAccount':text(seller.bankAccount,'seller.bankAccount'),
    'seller.bankName':text(seller.bankName,'seller.bankName'),'seller.signatureName':text(seller.signatureName,'seller.signatureName'),
    'buyer.salutation':buyer.salutation==='paní'?'Paní':'Pan','buyer.name':`${text(buyer.firstName,'buyer.firstName')} ${text(buyer.lastName,'buyer.lastName')}`,
    'buyer.address':text(buyer.address,'buyer.address'),'buyer.birthDate':originalContractDate(buyer.birthDate,'buyer.birthDate'),
    'buyer.email':text(buyer.email,'buyer.email'),'buyer.phone':text(buyer.phone,'buyer.phone'),
    'unit.code':text(source.unitCode,'unit.code'),'unit.floorNumber':`${source.floorNumber}.`,
    'unit.outdoorSpaceCase':sbk?(balcony?'Balkonu':'Terasy'):(balcony?'balkonu':'terasy'),
    'unit.outdoorParkingCode':text(parking.code,'unit.outdoorParkingCode'),'unit.cellarCode':text(cellar.code,'unit.cellarCode'),
    'unit.cellarFloor':text(cellar.floorLabel,'unit.cellarFloor'),'unit.garageCode':text(garage.code,'unit.garageCode'),
    'unit.garageFloor':text(garage.floorLabel,'unit.garageFloor'),'unit.variableSymbol':text(source.variableSymbol,'unit.variableSymbol'),
    'contract.totalPriceAmount':total.display,'contract.totalPriceWords':total.words,
    'contract.sellerPlannedDate':originalContractDate(plan.sellerPlannedOn,'contract.sellerPlannedDate'),
    'contract.buyerPlannedDate':originalContractDate(plan.buyerPlannedOn,'contract.buyerPlannedDate'),
  };
  if(sbk){
    if(source.signedRsCount!==1)return fail('contract.predecessor');
    const paid=money(source.paidReservationFee,'payment.reservationFeePaid');
    const payments=originalPaymentPlan({type:'sbk',totalPrice:total.decimal,reservationFeeAmount:fee.decimal,paidReservationFeeAmount:paid.decimal});
    Object.assign(result,{
      'buyer.deliveryAddress':text(buyer.deliveryAddress,'buyer.deliveryAddress'),
      'seller.clientChangesBankAccount':text(seller.clientChangesBankAccount,'seller.clientChangesBankAccount'),
      'unit.area':area(source.areaM2,'unit.area'),'unit.outdoorSpaceArea':area(balcony?source.balconyM2:source.terraceM2,'unit.outdoorSpaceArea'),
      'unit.gardenArea':area(source.gardenM2,'unit.gardenArea'),'payment.reservationFeePaidAmount':paid.display,
      'payment.firstInstallmentAmount':originalMoney(payments[0].amount).display,'payment.finalInstallmentAmount':originalMoney(payments[1].amount).display,
    });
  }else Object.assign(result,{'buyer.dataBox':buyer.dataBox?text(buyer.dataBox,'buyer.dataBox'):'neuvedena','payment.reservationFeeAmount':fee.display,'payment.reservationFeeWords':fee.words});
  if(Object.keys(result).length!==Object.keys(catalog.fields).length||Object.keys(catalog.fields).some(key=>!result[key]))return fail('template.fields');
  return result;
}
