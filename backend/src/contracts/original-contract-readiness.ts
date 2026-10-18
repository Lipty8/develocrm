import type {RsSource} from './rs-generation-repository.js';
import type {RsReadinessIssue} from '../shared/rs-readiness.js';
import {additionalSellerSettingFields} from '../shared/project-contract-settings.js';

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
  const cellars=source.accessories.filter(a=>a.type==='cellar');
  const garages=source.accessories.filter(a=>a.type==='garage');
  const outdoor=source.accessories.filter(a=>a.type==='outdoor_parking');
  for(const [items,key,label] of [[cellars,'cellar','sklep'],[garages,'garage','garážové stání'],[outdoor,'outdoorParking','venkovní parkovací stání']] as const){
    if(items.length!==1)add('accessory_variant',`unit.${key}`,`Kompletní varianta vyžaduje právě jedno ${label}. Ověřte příslušenství a jeho smluvní zařazení.`);
    else if(key!=='outdoorParking'&&!items[0].floorLabel?.trim())add('accessory_floor',`unit.${key}`,`U příslušenství ${items[0].code} chybí podlaží.`);
  }
  if(source.accessories.some(a=>!['cellar','garage','outdoor_parking'].includes(a.type)))
    add('accessory_classification','unit.accessories','Některé příslušenství nemá jednoznačné smluvní zařazení nebo není touto variantou podporované.');
  // No canonical legal-right metadata currently proves the source's garage
  // co-ownership. Keep the gate explicit, even if all physical items exist.
  add('accessory_legal_basis','unit.accessories','Je nutné ověřit právní formu příslušenství a spoluvlastnický podíl garáže podle smluvní varianty.');
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
