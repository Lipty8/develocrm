import type {DocumentContext} from "../documents/repository.js";
import type {DocumentTemplateGenerationService} from "../documents/template-generation-service.js";
import {RsGenerationRepository,type RsSource,type RsAccessory} from "./rs-generation-repository.js";

import type {RsReadiness,RsReadinessIssue} from '../shared/rs-readiness.js';
import {sellerSettingFields} from '../shared/project-contract-settings.js';
import {isOriginalContractVariant,templateCatalog} from '../documents/template-catalog.js';
import {originalContractIssues} from './original-contract-readiness.js';
import {ORIGINAL_CONTRACT_TERMS} from './original-payment-plan.js';
import {buildOriginalContractSnapshot,OriginalContractSnapshotError} from './original-contract-snapshot.js';
import {originalMoney} from './original-money.js';
import {signaturePaymentTerms} from './signature-payment-terms.js';
import {precedingRsComparison} from './preceding-rs-comparison.js';
import {contractAppendixRequirements,contractAppendixInput,type ContractAppendixInput} from '../shared/contract-appendices.js';
export type {RsReadiness,RsReadinessIssue} from '../shared/rs-readiness.js';
export class RsGenerationError extends Error{constructor(readonly code:string,readonly issues:RsReadinessIssue[]=[]){super("Rezervační smlouvu se nepodařilo vytvořit.");this.name="RsGenerationError";}}

export class RsGenerationService{
  constructor(private readonly repository:RsGenerationRepository,private readonly generator:DocumentTemplateGenerationService){}
  async setSigningPlan(input:Parameters<RsGenerationRepository['setSigningPlan']>[0]){return this.repository.setSigningPlan(input);}
  async setAppendix(context:DocumentContext&{contractId:string},body:unknown){
    const input:ContractAppendixInput=contractAppendixInput(body);
    const source=await this.repository.load({...context,permission:'contract.manage'});
    if(!source)throw new RsGenerationError('contract_not_found');
    if(!contractAppendixRequirements(source.contractType??'rs',source.templateVariant).some(item=>item.number===input.number))
      throw new RsGenerationError('appendix_not_supported');
    return this.repository.setAppendix({...context,...input});
  }
  async preparePaymentTerms(input:DocumentContext&{contractId:string;versionId:string}){
    const source=await this.repository.load({...input,permission:'contract.manage'});
    if(!source)throw new RsGenerationError('contract_not_found');
    if(!isOriginalContractVariant(source.templateVariant))throw new Error('PAYMENT_TERMS_TEMPLATE_PROFILE_REQUIRED');
    return this.repository.preparePaymentTerms(input);
  }
  async readiness(input:DocumentContext&{contractId:string}):Promise<RsReadiness>{
    const source=await this.repository.load({...input,permission:"contract.read"});
    if(!source)return{ready:false,contractId:input.contractId,issues:[issue("contract","contract","Smlouva nebyla nalezena nebo k ní nemáte přístup.")]};
    const issues=validate(source).map(item=>({...item,action:issueAction(item,source)}));
    const original=isOriginalContractVariant(source.templateVariant);
    const paymentPlan=validPaymentTerms(source);
    return{ready:issues.length===0,issues,contractType:source.contractType??'rs',contractId:source.contractId,projectId:source.projectId,templateVersionId:source.templateVersionId,
      summary:{project:{id:source.projectId,label:source.projectName},unit:{id:source.unitId,label:source.unitCode},buyers:source.buyers.map(b=>({id:b.id,label:b.displayName})),
        seller:source.settings?.name??null,unitPrice:source.unitPrice,totalPrice:source.totalPrice,reservationFee:source.reservationFee,precedingRsComparison:precedingRsComparison(source),
        appendices:original?{contractVersionId:source.signingPlan?.versionId??null,editable:source.appendixEditable===true,
          items:contractAppendixRequirements(source.contractType??'rs',source.templateVariant).map(required=>{
            const selected=source.appendixSelections?.find(item=>item.number===required.number);
            return{...required,documentId:selected?.documentId??null,documentVersionId:selected?.documentVersionId??null,
              name:selected?.name??null,version:selected?.version??null,available:selected?.available===true};
          })}:undefined,
        reservationFeeDueDays:original?ORIGINAL_CONTRACT_TERMS.rsFeeWorkingDays:source.reservationFeeDueDays,
        reservationPeriodDays:original?ORIGINAL_CONTRACT_TERMS.reservationCalendarDays:source.reservationPeriodDays,accessories:source.accessories.map(a=>a.code),signingPlan:original||source.contractType==='sbk'?source.signingPlan:undefined,
        paymentTimingLabel:original?(source.contractType==='sbk'?`První splátka: ${ORIGINAL_CONTRACT_TERMS.sbkFirstWorkingDays} pracovních dnů od účinného podpisu. Doplatek: ${ORIGINAL_CONTRACT_TERMS.sbkFinalCalendarDays} dnů od doručení výzvy.`:`${ORIGINAL_CONTRACT_TERMS.rsFeeWorkingDays} pracovní dny od podpisu poslední smluvní strany`):undefined,
        paymentPlan:original&&paymentPlan?{versionId:source.signingPlan?.versionId??null,variableSymbol:paymentPlan.variableSymbol,rows:paymentPlan.rows}:undefined,
        paymentPlanPreparation:original&&source.signingPlan?{versionId:source.signingPlan.versionId,
          canPrepare:source.signingPlan.editable&&source.status==='draft'&&!source.hasPaymentObligations&&!source.paymentTerms,
          hasExistingObligations:source.hasPaymentObligations===true}:undefined,
        template:source.templateVersionId?{name:source.templateName??'Smlouva',version:source.templateVersionLabel??'',effectiveFrom:source.templateEffectiveFrom??null,approvalStatus:source.templateApprovalStatus??'approved'}:null},
      currentDocument:source.documentId&&source.documentVersionId&&source.contractVersion&&(!source.signingPlan||source.signingPlan.versionId===source.contractVersionId)?{documentId:source.documentId,documentVersionId:source.documentVersionId,contractVersionId:source.contractVersionId??undefined,version:source.contractVersion,webUrl:source.webUrl}:null};
  }
  async generate(input:DocumentContext&{contractId:string;idempotencyKey:string;expectedContractType?:'rs'}){
    const completed=await this.repository.completedGeneration?.(input);
    if(completed){
      if(input.expectedContractType&&(completed.contractType??'rs')!==input.expectedContractType)throw new RsGenerationError('contract_type_mismatch');
      const version=await this.repository.bind({...input,...completed});
      return {operationId:completed.operationId,documentId:completed.documentId,documentVersionId:completed.documentVersionId,contractVersionId:version.versionId,contractVersion:version.versionNumber,replayed:true};
    }
    const source=await this.repository.load({...input,permission:"contract.manage"});if(!source)throw new RsGenerationError("contract_not_found");
    if(input.expectedContractType&&(source.contractType??'rs')!==input.expectedContractType)throw new RsGenerationError('contract_type_mismatch');
    const issues=validate(source).map(item=>({...item,action:issueAction(item,source)}));if(issues.length)throw new RsGenerationError("not_ready",issues);
    const snapshot=buildSnapshot(source);const requiredAppendices=contractAppendixRequirements(source.contractType??'rs',source.templateVariant);
    const contractAppendices=requiredAppendices.length?{versionId:source.signingPlan!.versionId,items:requiredAppendices.map(required=>{
      const selected=source.appendixSelections!.find(item=>item.number===required.number)!;
      return{number:required.number,documentId:selected.documentId!,documentVersionId:selected.documentVersionId!};
    })}:undefined;
    const generated=await this.generator.generate({...input,projectId:source.projectId,templateVersionId:source.templateVersionId!,idempotencyKey:input.idempotencyKey,contractAppendices,
      unitId:source.unitId,partyId:source.buyers[0].id,salesCaseId:source.salesCaseId,contractId:source.contractId,documentId:source.documentMimeType==='application/pdf'?undefined:source.documentId??undefined,documentName:`${source.contractType==='sbk'?'Smlouva o budoucí kupní smlouvě':'Rezervační smlouva'} ${source.reference}`,snapshot});
    if(!generated.documentId||!generated.documentVersionId)throw new RsGenerationError("generation_incomplete");
    const version=await this.repository.bind({...input,contractId:source.contractId,operationId:generated.operationId,documentId:generated.documentId,documentVersionId:generated.documentVersionId,templateVersionId:source.templateVersionId!,snapshot});
    return{...generated,contractVersionId:version.versionId,contractVersion:version.versionNumber};
  }
}

function validate(source:RsSource):RsReadinessIssue[]{
  const issues:RsReadinessIssue[]=[];
  const original=isOriginalContractVariant(source.templateVariant)||source.contractType==='sbk';
  if(source.paymentTerms!=null&&!isOriginalContractVariant(source.templateVariant))
    issues.push(issue('payment_terms_template_mismatch','template','Platební plán neodpovídá vybrané variantě šablony. Před generováním ověřte správnou projektovou šablonu.'));
  if(source.caseStatus&&source.caseStatus!=='active')issues.push(issue('closed_case','contract','Obchod již byl ukončen. Historickou smlouvu nelze znovu připravit ani podepsat.'));
  if(!source.settings)issues.push(issue("seller_settings","project.seller","Projekt nemá vyplněné smluvní údaje prodávajícího."));
  else for(const field of sellerSettingFields)if(!source.settings[field.key]?.trim())issues.push(issue("seller_field",`project.seller.${field.key}`,`Prodávající: doplňte ${field.label.toLocaleLowerCase('cs-CZ')}.`));
  if(!source.templateVersionId||source.templateApprovalStatus&&source.templateApprovalStatus!=='approved'||source.approvedTemplateCount===0)
    issues.push(issue("approved_template","template","Pro tento typ smlouvy není schválená účinná projektová šablona."));
  if((source.approvedTemplateCount??1)>1)issues.push(issue('ambiguous_template','template','Pro tento typ smlouvy je dostupných více účinných šablon. Je nutné jednoznačně určit odpovídající variantu.'));
  if(original){
    const requiredAppendices=contractAppendixRequirements(source.contractType??'rs',source.templateVariant);
    if(source.appendixSelections?.some(selected=>!requiredAppendices.some(required=>required.number===selected.number)))
      issues.push(issue('contract_appendix_unexpected','contract.appendices','Seznam příloh neodpovídá vybrané variantě smlouvy. Před generováním jej zkontrolujte.'));
    for(const required of requiredAppendices){
      const selected=source.appendixSelections?.find(item=>item.number===required.number);
      if(!selected?.available||!selected.documentId||!selected.documentVersionId)
        issues.push(issue('contract_appendix',`contract.appendices.${required.number}`,`Příloha ${required.number}: ${required.label} nemá vybranou dostupnou verzi dokumentu.`));
    }
    issues.push(...originalContractIssues(source));
    if(!validPaymentTerms(source))issues.push(issue('contract_payment_terms','contract.paymentTerms','Platební plán této verze smlouvy chybí nebo neodpovídá aktuálním údajům. Splatnost musí vycházet ze skutečného podpisu, nikoli z vytvoření smlouvy.'));
    const catalog=templateCatalog(source.contractType==='sbk'?'future_purchase_contract':'reservation_contract',source.templateVariant);
    if(!catalog||catalog.generationSupported===false)
      issues.push(issue('original_profile_review','template','Tato varianta smlouvy ještě není připravena k běžnému použití. Zbývá dokončit kontrolu údajů a obsahové schválení.'));
  }
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
  if(!original&&!source.floorLabel)issues.push(issue("unit_floor","unit.floor","Jednotka nemá vyplněné podlaží."));
  if(!Number.isFinite(source.areaM2)||source.areaM2<=0)issues.push(issue('unit_area','unit.area','Jednotka nemá platnou podlahovou plochu.'));
  if(!original&&(source.terraceM2??0)>0)issues.push(issue('unsupported_terrace','unit.terrace','Jednotka má terasu, kterou tato verze mapování šablony neumí bezpečně popsat. Je nutné ověřit odpovídající schválenou šablonu.'));
  if(!original&&!source.completionYear)issues.push(issue("completion_year","project.completionYear","Projekt nemá nastavený rok plánovaného dokončení."));
  if(source.unitPrice==null||source.totalPrice==null)issues.push(issue("price","unit.price","Smlouva nemá uložený cenový snapshot jednotky a příslušenství."));
  if(source.reservationFee==null)issues.push(issue("reservation_fee","contract.reservationFee","Smlouva nemá nastavený rezervační poplatek."));
  if(!original&&(!Number.isInteger(source.reservationFeeDueDays)||source.reservationFeeDueDays<1))issues.push(issue("reservation_fee_due","contract.reservationFeeDueDays","Smlouva nemá platnou splatnost rezervačního poplatku."));
  if(source.accessories.some(accessory=>accessory.type==='wallbox'))issues.push(issue("unsupported_wallbox","unit.accessories","Tato verze šablony neumí bezpečně popsat wallbox. Použijte schválenou rozšířenou šablonu."));
  // Approval/payment preparation are independent gates. Once the business
  // facts are present, preflight the exact mapper even while those gates are
  // closed. This prevents readiness accepting a value the renderer rejects.
  if(isOriginalContractVariant(source.templateVariant)&&issues.every(item=>
    ['approved_template','ambiguous_template','original_profile_review','contract_payment_terms','contract_appendix'].includes(item.code))){
    try{buildOriginalContractSnapshot(source);}
    catch(error){
      if(!(error instanceof OriginalContractSnapshotError))throw error;
      const catalog=templateCatalog(source.contractType==='sbk'?'future_purchase_contract':'reservation_contract',source.templateVariant);
      const label=catalog?.fields[error.field]?.label??({
        'contract.signingDates':'Plánovaná data podpisu','unit.area':'Podlahová plocha',
        'unit.garden':'Plocha předzahrádky','unit.floorNumber':'Nadzemní podlaží',
        'buyer.firstName':'Jméno kupujícího','buyer.lastName':'Příjmení kupujícího',
      } as Record<string,string>)[error.field]??'Údaj pro smlouvu';
      const field=error.field==='unit.variableSymbol'?'contract.payment':error.field.startsWith('seller.')?`project.${error.field}`:
        error.field.startsWith('contract.')&&error.field.endsWith('PlannedDate')?'contract.signingDates':error.field;
      issues.push(issue('invalid_contract_value',field,`Zkontrolujte údaj „${label}“. Hodnota není platná pro připravovanou smlouvu.`));
    }
  }
  return issues;
}
function validPaymentTerms(source:RsSource){
  const plan=signaturePaymentTerms(source.paymentTerms);
  return plan&&plan.contractType===(source.contractType??'rs')&&Number(plan.totalPrice)===source.totalPrice
    &&Number(plan.reservationFee)===source.reservationFee&&plan.buyerPartyId===source.buyers[0]?.id&&source.buyers.length===1
    &&(plan.contractType==='rs'||Number(plan.paidReservationFee)===source.paidReservationFee&&plan.precedingRsContractId===source.signedRsContractId)?plan:null;
}
function issueAction(item:RsReadinessIssue,source:RsSource):RsReadinessIssue['action']{
  const back=`returnTo=${encodeURIComponent(`/contracts/${source.contractId}`)}`;
  if(item.field.startsWith('buyer')&&source.buyers[0])return{href:`/clients/${source.buyers[0].id}?${back}`,label:'Otevřít kupujícího'};
  if(item.code==='accessory_legal_basis'||item.code==='accessory_legal_share'){
    const accessory=source.accessories.find(a=>item.field===`unit.accessories.${a.id??a.code}`);
    return{href:`/projects/${source.projectId}/${accessory?.type==='cellar'?'cellars':'parking'}?${back}`,label:'Doplnit příslušenství'};
  }
  if(item.field.startsWith('unit'))return{href:`/units/${source.unitId}?${back}`,label:'Otevřít jednotku'};
  if(item.field==='template')return{href:`/contracts?view=templates&project=${source.projectId}&${back}`,label:'Otevřít šablony'};
  if(item.field.startsWith('project'))return{href:`/projects/${source.projectId}?${back}`,label:'Otevřít projekt'};
  return undefined;
}
export function buildSnapshot(source:RsSource):Record<string,string>{
  if(isOriginalContractVariant(source.templateVariant))return buildOriginalContractSnapshot(source);
  const buyer=source.buyers[0],seller=source.settings!;const underground=(a:RsAccessory)=>a.type==='garage'||a.type==='parking'&&(/\bPP\b/i.test(a.floorLabel??'')||/garáž/i.test(a.description??''));const parking=source.accessories.filter(a=>a.type==='parking'&&!underground(a)),garage=source.accessories.filter(underground),cellars=source.accessories.filter(a=>a.type==='cellar');
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
function formatMoney(value:number){return`${originalMoney(value).display}\u00a0Kč`;}
function czechMoneyWords(value:number){return`${originalMoney(value).words} korun českých`;}
