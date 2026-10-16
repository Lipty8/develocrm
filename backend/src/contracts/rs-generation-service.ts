import type {DocumentContext} from "../documents/repository.js";
import type {DocumentTemplateGenerationService} from "../documents/template-generation-service.js";
import {RsGenerationRepository,type RsSource,type RsAccessory} from "./rs-generation-repository.js";

import type {RsReadiness,RsReadinessIssue} from '../shared/rs-readiness.js';
import {sellerSettingFields} from '../shared/project-contract-settings.js';
export type {RsReadiness,RsReadinessIssue} from '../shared/rs-readiness.js';
export class RsGenerationError extends Error{constructor(readonly code:string,readonly issues:RsReadinessIssue[]=[]){super("Rezervační smlouvu se nepodařilo vytvořit.");this.name="RsGenerationError";}}

export class RsGenerationService{
  constructor(private readonly repository:RsGenerationRepository,private readonly generator:DocumentTemplateGenerationService){}
  async readiness(input:DocumentContext&{contractId:string}):Promise<RsReadiness>{
    const source=await this.repository.load({...input,permission:"contract.read"});
    if(!source)return{ready:false,contractId:input.contractId,issues:[issue("contract","contract","Rezervační smlouva nebyla nalezena nebo k ní nemáte přístup.")]};
    const issues=validate(source).map(item=>({...item,action:issueAction(item,source)}));
    return{ready:issues.length===0,issues,contractId:source.contractId,projectId:source.projectId,templateVersionId:source.templateVersionId,
      summary:{project:{id:source.projectId,label:source.projectName},unit:{id:source.unitId,label:source.unitCode},buyers:source.buyers.map(b=>({id:b.id,label:b.displayName})),
        seller:source.settings?.name??null,unitPrice:source.unitPrice,totalPrice:source.totalPrice,reservationFee:source.reservationFee,
        reservationFeeDueDays:source.reservationFeeDueDays,reservationPeriodDays:source.reservationPeriodDays,accessories:source.accessories.map(a=>a.code),
        template:source.templateVersionId?{name:source.templateName??'Rezervační smlouva',version:source.templateVersionLabel??'',effectiveFrom:source.templateEffectiveFrom??null}:null},
      currentDocument:source.documentId&&source.documentVersionId&&source.contractVersion?{documentId:source.documentId,documentVersionId:source.documentVersionId,contractVersionId:source.contractVersionId??undefined,version:source.contractVersion,webUrl:source.webUrl}:null};
  }
  async generate(input:DocumentContext&{contractId:string;idempotencyKey:string}){
    const completed=await this.repository.completedGeneration?.(input);
    if(completed){
      const version=await this.repository.bind({...input,...completed});
      return {operationId:completed.operationId,documentId:completed.documentId,documentVersionId:completed.documentVersionId,contractVersionId:version.versionId,contractVersion:version.versionNumber,replayed:true};
    }
    const source=await this.repository.load({...input,permission:"contract.manage"});if(!source)throw new RsGenerationError("contract_not_found");
    const issues=validate(source);if(issues.length)throw new RsGenerationError("not_ready",issues);
    const snapshot=buildSnapshot(source);const generated=await this.generator.generate({...input,projectId:source.projectId,templateVersionId:source.templateVersionId!,idempotencyKey:input.idempotencyKey,
      unitId:source.unitId,partyId:source.buyers[0].id,salesCaseId:source.salesCaseId,contractId:source.contractId,documentId:source.documentMimeType==='application/pdf'?undefined:source.documentId??undefined,documentName:`Rezervační smlouva ${source.reference}`,snapshot});
    if(!generated.documentId||!generated.documentVersionId)throw new RsGenerationError("generation_incomplete");
    const version=await this.repository.bind({...input,contractId:source.contractId,operationId:generated.operationId,documentId:generated.documentId,documentVersionId:generated.documentVersionId,templateVersionId:source.templateVersionId!,snapshot});
    return{...generated,contractVersionId:version.versionId,contractVersion:version.versionNumber};
  }
}

function validate(source:RsSource):RsReadinessIssue[]{
  const issues:RsReadinessIssue[]=[];
  if(source.caseStatus&&source.caseStatus!=='active')issues.push(issue('closed_case','contract','Obchod již byl ukončen. Historickou smlouvu nelze znovu připravit ani podepsat.'));
  if(!source.settings)issues.push(issue("seller_settings","project.seller","Projekt nemá vyplněné smluvní údaje prodávajícího."));
  else for(const field of sellerSettingFields)if(!source.settings[field.key]?.trim())issues.push(issue("seller_field",`project.seller.${field.key}`,`Prodávající: doplňte ${field.label.toLocaleLowerCase('cs-CZ')}.`));
  if(!source.templateVersionId)issues.push(issue("approved_template","template","Pro projekt není schválená účinná šablona rezervační smlouvy."));
  if(source.buyers.length!==1)issues.push(issue("buyer_count","buyers","Tato verze šablony vyžaduje právě jednoho kupujícího."));
  const buyer=source.buyers[0];
  if(buyer){if(buyer.partyType!=="individual")issues.push(issue("buyer_type","buyer.type","Tato verze šablony podporuje pouze fyzickou osobu."));
    if(!['pan','paní'].includes(buyer.salutation??''))issues.push(issue("buyer_salutation","buyer.salutation","Kupující nemá vyplněné platné oslovení pan / paní."));
    if(!buyer.firstName||!buyer.lastName)issues.push(issue("buyer_name","buyer.name","Kupující nemá vyplněné celé jméno."));
    if(!buyer.birthDate)issues.push(issue("buyer_birth_date","buyer.birthDate","Kupující nemá vyplněné datum narození."));
    if(!buyer.address)issues.push(issue("buyer_address","buyer.address","Kupující nemá vyplněnou adresu trvalého bydliště."));
    if(!buyer.email)issues.push(issue("buyer_email","buyer.email","Kupující nemá vyplněný e-mail."));
    if(!buyer.phone)issues.push(issue("buyer_phone","buyer.phone","Kupující nemá vyplněný telefon."));}
  if(!source.layout)issues.push(issue("unit_layout","unit.layout","Jednotka nemá vyplněnou dispozici."));
  if(!source.floorLabel)issues.push(issue("unit_floor","unit.floor","Jednotka nemá vyplněné podlaží."));
  if(!Number.isFinite(source.areaM2)||source.areaM2<=0)issues.push(issue('unit_area','unit.area','Jednotka nemá platnou podlahovou plochu.'));
  if((source.terraceM2??0)>0)issues.push(issue('unsupported_terrace','unit.terrace','Jednotka má terasu, kterou tato verze mapování šablony neumí bezpečně popsat. Je nutné ověřit odpovídající schválenou šablonu.'));
  if(!source.completionYear)issues.push(issue("completion_year","project.completionYear","Projekt nemá nastavený rok plánovaného dokončení."));
  if(source.unitPrice==null||source.totalPrice==null)issues.push(issue("price","unit.price","Smlouva nemá uložený cenový snapshot jednotky a příslušenství."));
  if(source.reservationFee==null)issues.push(issue("reservation_fee","contract.reservationFee","Smlouva nemá nastavený rezervační poplatek."));
  if(!Number.isInteger(source.reservationFeeDueDays)||source.reservationFeeDueDays<1)issues.push(issue("reservation_fee_due","contract.reservationFeeDueDays","Smlouva nemá platnou splatnost rezervačního poplatku."));
  if(source.accessories.some(accessory=>accessory.type==='wallbox'))issues.push(issue("unsupported_wallbox","unit.accessories","Tato verze šablony neumí bezpečně popsat wallbox. Použijte schválenou rozšířenou šablonu."));
  return issues;
}
function issueAction(item:RsReadinessIssue,source:RsSource):RsReadinessIssue['action']{
  const back=`returnTo=${encodeURIComponent(`/contracts/${source.contractId}`)}`;
  if(item.field.startsWith('buyer')&&source.buyers[0])return{href:`/clients/${source.buyers[0].id}?${back}`,label:'Otevřít kupujícího'};
  if(item.field.startsWith('unit'))return{href:`/units/${source.unitId}?${back}`,label:'Otevřít jednotku'};
  if(item.field==='template')return{href:`/contracts?view=templates&project=${source.projectId}&${back}`,label:'Otevřít šablony'};
  if(item.field.startsWith('project'))return{href:`/projects/${source.projectId}?${back}`,label:'Otevřít projekt'};
  return undefined;
}
export function buildSnapshot(source:RsSource):Record<string,string>{const buyer=source.buyers[0],seller=source.settings!;const underground=(a:RsAccessory)=>a.type==='garage'||a.type==='parking'&&(/\bPP\b/i.test(a.floorLabel??'')||/garáž/i.test(a.description??''));const parking=source.accessories.filter(a=>a.type==='parking'&&!underground(a)),garage=source.accessories.filter(underground),cellars=source.accessories.filter(a=>a.type==='cellar');
  return{"seller.name":seller.name,"seller.address":seller.address,"seller.registryEntry":seller.registryEntry,"seller.registrationNumber":seller.registrationNumber,"seller.representative":seller.representative,"seller.email":seller.email,"seller.dataBox":seller.dataBox,"seller.bankAccount":seller.bankAccount,
    "buyer.salutation":buyer.salutation==='paní'?'Paní':'Pan',"buyer.name":`${buyer.firstName} ${buyer.lastName}`,"buyer.address":buyer.address!,"buyer.birthDate":formatDate(buyer.birthDate!),"buyer.email":buyer.email!,"buyer.phone":buyer.phone!,"buyer.dataBoxLine":buyer.dataBox?`Datová schránka: ${buyer.dataBox}`:"Datová schránka neuvedena",
    "project.name":source.projectName,"project.completionYear":source.completionYear!,"contract.reservationPeriodDays":String(source.reservationPeriodDays),"contract.date":formatDate(new Date().toISOString()),
    "unit.subjectClause":`Jednotka č. ${source.unitCode} (dále jen „Byt“) zahrnující byt o dispozici ${source.layout}, nacházející se v ${source.floorLabel} Domu, o podlahové ploše ${formatArea(source.areaM2)} m², jak je specifikován v katalogovém listě v příloze č. 1;`,
    "unit.balconyClause":source.balconyM2&&source.balconyM2>0?`K Bytu náleží výlučné užívací právo k balkonu o výměře ${formatArea(source.balconyM2)} m², přístupnému výlučně z Bytu.`:"K Bytu nenáleží balkon ani terasa.",
    "unit.gardenClause":source.gardenM2&&source.gardenM2>0?`K Bytu náleží výlučné užívací právo k předzahrádce o výměře ${formatArea(source.gardenM2)} m², tvořící část Pozemku přiléhající k Domu.`:"K Bytu nenáleží předzahrádka.",
    "unit.outdoorParkingClause":parkingClause(parking,false),"unit.cellarClause":cellarClause(cellars),"unit.garageClause":parkingClause(garage,true),
    "payment.reservationFeeClause":`Zájemce se tímto zavazuje, že do ${source.reservationFeeDueDays} pracovních dnů od podpisu této smlouvy uhradí Investorovi částku ${formatMoney(source.reservationFee!)} (slovy: ${czechMoneyWords(source.reservationFee!)}) jako poplatek za rezervaci Předmětu rezervace po Rezervační dobu (dále jen „Rezervační poplatek“), a to na účet č. ú. ${seller.bankAccount}, vedený u ${seller.bankName}, vždy s variabilním symbolem ${source.unitCode}.`,
    "contract.totalPriceClause":`Cena za Předmět rezervace byla sjednána ve výši ${formatMoney(source.totalPrice!)} (slovy: ${czechMoneyWords(source.totalPrice!)}) včetně DPH.`};}
function parkingClause(items:RsAccessory[],garage:boolean){const label=garage?"Garážové stání":"Venkovní parkovací stání";if(!items.length)return`${label} k Bytu nenáleží.`;const codes=items.map(item=>item.code).join(", ");return garage?`S vlastnictvím Garáže je spojeno užívací právo k vnitřnímu parkovacímu stání ${codes}. Plánek umístění parkovacího stání je v příloze č. 3.`:`K Bytu náleží venkovní parkovací stání ${codes} umístěné na Pozemku. Plánek umístění parkovacího stání je v příloze č. 4.`;}
function cellarClause(items:RsAccessory[]){if(!items.length)return"Sklep k Bytu nenáleží.";const codes=items.map(item=>item.code).join(", "),floor=items.map(item=>item.floorLabel).find(Boolean);return`K Bytu náleží sklep ${codes}${floor?` nacházející se v ${floor} Domu`:""}, jak je specifikován v příloze č. 2.`;}
function issue(code:string,field:string,message:string):RsReadinessIssue{return{code,field,message};}
function formatDate(value:string){return new Intl.DateTimeFormat("cs-CZ",{dateStyle:"long",timeZone:"Europe/Prague"}).format(new Date(value));}
function formatArea(value:number){return new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:2}).format(value);}
function formatMoney(value:number){return new Intl.NumberFormat("cs-CZ",{style:"currency",currency:"CZK",maximumFractionDigits:0}).format(value);}
function czechMoneyWords(value:number){const amount=Math.round(value);if(amount===0)return"nula korun českých";const groups:[[number,string,string,string],number][]=[[[1_000_000_000,"miliarda","miliardy","miliard"],Math.floor(amount/1_000_000_000)],[[1_000_000,"milion","miliony","milionů"],Math.floor(amount/1_000_000)%1000],[[1_000,"tisíc","tisíce","tisíc"],Math.floor(amount/1_000)%1000]];const parts:string[]=[];for(const [[,one,few,many],count] of groups)if(count){const last=count%100,unit=count%10;parts.push(chunkWords(count),unit===1&&last!==11?one:unit>=2&&unit<=4&&(last<12||last>14)?few:many);}const remainder=amount%1000;if(remainder)parts.push(chunkWords(remainder));return`${parts.join(" ")} korun českých`;}
function chunkWords(value:number){const units=["","jeden","dva","tři","čtyři","pět","šest","sedm","osm","devět","deset","jedenáct","dvanáct","třináct","čtrnáct","patnáct","šestnáct","sedmnáct","osmnáct","devatenáct"],tens=["","","dvacet","třicet","čtyřicet","padesát","šedesát","sedmdesát","osmdesát","devadesát"],hundreds=["","sto","dvě stě","tři sta","čtyři sta","pět set","šest set","sedm set","osm set","devět set"];const result:string[]=[];if(value>=100){result.push(hundreds[Math.floor(value/100)]);value%=100;}if(value>=20){result.push(tens[Math.floor(value/10)]);value%=10;}if(value)result.push(units[value]);return result.join(" ");}
