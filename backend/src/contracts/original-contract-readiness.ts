import type {RsSource} from './rs-generation-repository.js';
import type {RsReadinessIssue} from '../shared/rs-readiness.js';
import {additionalSellerSettingFields} from '../shared/project-contract-settings.js';
import {normalizeAccessoryLegalDetails,originalAccessoryKind} from '../shared/accessory-legal-details.js';
import {ORIGINAL_TEMPLATE_CATALOGS} from '../documents/template-catalog.js';

/** Only explicit canonical rights can prove compatibility with the pinned legal text. */
export function originalAccessoryIssues(source:RsSource):RsReadinessIssue[]{
  const issues:RsReadinessIssue[]=[];
  const expected=ORIGINAL_TEMPLATE_CATALOGS[source.contractType==='sbk'?'future_purchase_contract':'reservation_contract'].legalRequirements?.garageShare;
  for(const item of source.accessories){
    const field=`unit.accessories.${item.id??item.code}`;
    try{normalizeAccessoryLegalDetails({legalForm:item.legalForm??null,shareNumerator:item.shareNumerator,shareDenominator:item.shareDenominator});}
    catch{issues.push({code:'accessory_legal_basis',field,message:`U příslušenství ${item.code} je neplatné smluvní vymezení nebo podíl.`});continue;}
    const kind=originalAccessoryKind(item);
    if(!kind)issues.push({code:'accessory_legal_basis',field,message:`U příslušenství ${item.code} doplňte nebo ověřte smluvní vymezení. Tato varianta podporuje sklep jako jednotku, venkovní užívací právo a podíl na garáži.`});
    if(kind==='garage'&&((item.shareNumerator!=null&&item.shareNumerator!==1)||(expected&&(item.shareNumerator!==expected.numerator||item.shareDenominator!==expected.denominator))))
      issues.push({code:'accessory_legal_share',field,message:expected?`Garážové stání ${item.code}: tato varianta smlouvy obsahuje podíl ${expected.numerator}/${expected.denominator}. Ověřte podklady a doplňte skutečný podíl; pro jiný podíl je potřeba schválená odpovídající varianta.`:`Garážové stání ${item.code}: podíl neodpovídá znění této varianty smlouvy (1 / konečný počet stání).`});
  }
  return issues;
}

/** Additional readiness for the pinned complete original variant. No legal
 * prose is composed here; missing canonical facts are never inferred from a
 * filename, accessory description, old document or generation timestamp.
 */
export function originalContractIssues(source:RsSource):RsReadinessIssue[]{
  const issues:RsReadinessIssue[]=[];
  const add=(code:string,field:string,message:string)=>issues.push({code,field,message});
  const sbk=source.contractType==='sbk';
  for(const field of additionalSellerSettingFields){
    if((field.key==='signatureName'||sbk)&&!source.settings?.[field.key]?.trim())
      add('seller_field',`project.seller.${field.key}`,`Prodávající: doplňte ${field.label.toLocaleLowerCase('cs-CZ')}.`);
  }
  if(!Number.isInteger(source.floorNumber)||(source.floorNumber??0)<1)
    add('unit_floor_number','unit.floor','Jednotka nemá vyplněné číslo nadzemního podlaží. Textový název podlaží nestačí.');
  const balcony=(source.balconyM2??0)>0,terrace=(source.terraceM2??0)>0;
  if(balcony===terrace)add('outdoor_space_variant','unit.outdoorSpace','Kompletní varianta vyžaduje právě balkon nebo terasu. Pro jinou kombinaci je potřeba ověřená odpovídající varianta smlouvy.');
  if((source.gardenM2??0)<=0)add('garden_variant','unit.garden','Kompletní varianta obsahuje předzahrádku, která u jednotky není uvedena.');
  // The source contains one cellar, one outdoor right and one garage share.
  // A generic parking category is not evidence that it is outdoor parking.
  const cellars=source.accessories.filter(a=>originalAccessoryKind(a)==='cellar');
  const garages=source.accessories.filter(a=>originalAccessoryKind(a)==='garage');
  const outdoor=source.accessories.filter(a=>originalAccessoryKind(a)==='outdoor_parking');
  if(source.accessories.some(a=>!originalAccessoryKind(a)))add('accessory_classification','unit.accessories','Některé příslušenství nemá doložené smluvní zařazení podporované touto variantou.');
  for(const [items,key,label] of [[cellars,'cellar','sklep'],[garages,'garage','garážové stání'],[outdoor,'outdoorParking','venkovní parkovací stání']] as const){
    if(items.length!==1)add('accessory_variant',`unit.${key}`,`Kompletní varianta vyžaduje právě jedno ${label}. Ověřte příslušenství a jeho smluvní zařazení.`);
    else if(key!=='outdoorParking'&&!items[0].floorLabel?.trim())add('accessory_floor',`unit.${key}`,`U příslušenství ${items[0].code} chybí podlaží.`);
  }
  issues.push(...originalAccessoryIssues(source));
  if(!source.signingPlan?.sellerPlannedOn||!source.signingPlan.buyerPlannedOn)
    add('planned_signing_dates','contract.signingDates','Doplňte plánovaná data podpisu prodávajícího a kupujícího. Datum vytvoření dokumentu je nenahrazuje.');
  if(!source.variableSymbol)add('payment_reference','contract.payment','Platební povinnost nemá jednoznačný variabilní symbol pro tuto smlouvu.');
  if(sbk){
    if(!source.buyers[0]?.deliveryAddress?.trim())add('buyer_delivery_address','buyer.deliveryAddress','Kupující nemá vyplněnou doručovací adresu.');
    if(source.signedRsCount!==1)add('signed_rs','contract.predecessor','Pro přípravu SBK musí být v tomto obchodním případu jednoznačně určena účinná podepsaná RS.');
    if(!source.paidReservationFee||source.paidReservationFee!==source.reservationFee)
      add('reservation_fee_paid','contract.payment','Zaplacený rezervační poplatek neodpovídá částce, jejíž úhradu tato varianta SBK potvrzuje.');
  }
  return issues;
}
