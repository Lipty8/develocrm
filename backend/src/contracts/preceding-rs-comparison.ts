import type {RsSource} from './rs-generation-repository.js';
import type {PrecedingRsComparison} from '../shared/rs-readiness.js';
import {buildOriginalContractSnapshot,OriginalContractSnapshotError} from './original-contract-snapshot.js';
import {ORIGINAL_DOB_FULL_VARIANT,ORIGINAL_TEMPLATE_CATALOGS} from '../documents/template-catalog.js';
import {OriginalPaymentPlanError} from './original-payment-plan.js';

// Only shared scalar facts. Never compare/parse legal prose or planned signature
// dates, and never substitute today's client record for the signed RS snapshot.
const fields=['seller.name','seller.address','seller.registrationNumber','seller.registryEntry','seller.representative','seller.bankAccount','seller.bankName',
  'buyer.name','buyer.address','buyer.birthDate','buyer.email','buyer.phone','unit.code','unit.floorNumber',
  'unit.outdoorParkingCode','unit.cellarCode','unit.cellarFloor','unit.garageCode','unit.garageFloor','contract.totalPriceAmount'] as const;

export function precedingRsComparison(source:RsSource):PrecedingRsComparison|undefined{
  if(source.contractType!=='sbk')return undefined;
  const unavailable=(message:string):PrecedingRsComparison=>({status:'unavailable',message,comparedFields:0,differences:[]});
  if(source.signedRsCount!==1||!source.signedRsContractId)
    return unavailable('Pro porovnání musí být jednoznačně určena podepsaná RS tohoto obchodu.');
  const prior=source.precedingRsEvidence;
  if(!prior||prior.contractId!==source.signedRsContractId||prior.versionCount!==1||!prior.documentVersionId)
    return unavailable('Podepsanou verzi RS nelze jednoznačně určit. Ověřte historii smlouvy.');
  const identity={contractId:prior.contractId,reference:prior.reference,contractVersion:prior.versionNumber,documentVersionId:prior.documentVersionId};
  const missing=(message:string)=>({...unavailable(message),...identity});
  if(prior.profile!==ORIGINAL_DOB_FULL_VARIANT||!prior.verifiedGeneration||!prior.buyerPartyId||!prior.snapshot||Array.isArray(prior.snapshot))
    return missing('RS nemá srovnatelný uložený přehled údajů. Porovnejte podepsaný dokument ručně; jeho hodnoty se nepřebírají automaticky.');
  const expected=Object.keys(ORIGINAL_TEMPLATE_CATALOGS.reservation_contract.fields);
  if(expected.some(key=>typeof prior.snapshot?.[key]!=='string'||!prior.snapshot[key].trim())||Object.keys(prior.snapshot).length!==expected.length)
    return missing('Uložené údaje podepsané RS nejsou úplné. Je nutná kontrola podepsaného dokumentu.');
  if(source.templateVariant!==ORIGINAL_DOB_FULL_VARIANT)
    return missing('Vybraná varianta SBK nepodporuje automatické porovnání s touto RS.');
  let current:Record<string,string>;
  try{current=buildOriginalContractSnapshot(source);}catch(error){
    if(!(error instanceof OriginalContractSnapshotError)&&!(error instanceof OriginalPaymentPlanError))throw error;
    return missing('Nejprve doplňte údaje připravované SBK. Poté lze porovnat rozdíly proti podepsané RS.');
  }
  const personalFields=new Set<string>(['buyer.address','buyer.birthDate','buyer.email','buyer.phone']);
  const differences=fields.filter(field=>prior.snapshot![field]!==current[field]).map(field=>({field,
    label:ORIGINAL_TEMPLATE_CATALOGS.future_purchase_contract.fields[field].label,
    previous:personalFields.has(field)?'Údaj v podepsané RS':prior.snapshot![field],
    current:personalFields.has(field)?'Změněný údaj v SBK':current[field],valuesRestricted:personalFields.has(field)}));
  const buyerChanged=prior.buyerPartyId!==source.buyers[0].id;
  return{...identity,status:'compared',comparedFields:fields.length,differences,buyerChanged,
    message:differences.length||buyerChanged?'Údaje připravované SBK se liší od podepsané RS. Ověřte, že změny byly schválené. Podepsaná RS se nemění.':'Porovnané údaje odpovídají podepsané RS. Nejde o porovnání celého právního textu ani příloh.'};
}
