import assert from "node:assert/strict";
import {afterEach,before,test} from "node:test";
import React,{useState,useCallback} from "react";
import {AsyncNotice,useAsyncRead} from '../app/components/async-content';
import {ReadError} from '../app/lib/read-state';
import {JSDOM} from "jsdom";
import {RowActionMenu} from "../app/components/row-action-menu";
import {ProjectArchiveAction} from '../app/components/project-archive-action';
import {projects as sampleProjects,type ProjectRecord} from '../app/crm-data';
import type {CatalogSnapshot} from '../app/repositories/catalog-repository';
import {TableColumnMenu,TableColumnPreferenceProvider,useTableColumns,type TableColumnDefinition} from "../app/components/table-column-config";
import {TableColumnFilter} from "../app/components/table-column-filter";
import {SummaryStats,toggledSummaryFilter} from "../app/components/summary-stats";
import {projectSalesAggregation,projectUnitSalesBucket,type ProjectSalesBucket} from "../app/lib/project-sales-performance";
import {contractSummaryCategory,contractSummaryCounts,type ContractSummaryCategory} from "../app/lib/contract-summary";
import {contractStageHistory,contractWorkflowPresentation} from '../app/lib/contract-stage-history';
import {ContractWorkflowSteps} from '../app/components/contract-workflow-steps';
import {PackageOpen,UserRound,Users} from "lucide-react";
import {Projects,ProjectOverview,UnitContracts,ContractDetail,ContractWorkflowModal,ClientChangeStatusModal,ComplaintDetailModal,ContractAddendumModal,ContractNoteModal,FormModal,PaymentDetailModal,PaymentRefundForm,paymentRefundAvailability,EditClientModal} from "../app/CRMApp";
import {paymentRepository} from '../app/repositories/payment-repository';
import {relatedUnitHref,relatedClientHref} from '../app/lib/entity-navigation';
import {preferredSalesPartyId} from '../app/lib/business-context';
import {searchWorkspace} from '../app/lib/workspace-search';
import {ClientContractLinks} from '../app/components/client-contract-links';
import {ClientAddressSummary} from '../app/components/client-address-fields';
import {ContractSigningPlanForm} from '../app/components/rs-generation-panel';
import {RelatedUnitLink} from '../app/components/entity-links';
import {useWorkspaceSearch} from '../app/components/workspace-search';
import {catalogRepository} from '../app/repositories/catalog-repository';
import {clientRepository} from '../app/repositories/client-repository';
import {commercialRepository} from '../app/repositories/commercial-repository';
import {ContractEndResult} from '../app/components/contract-end-result';
import type {PaymentRecord} from '../app/repositories/payment-repository';
import {EditAccessoryModal,CreateUnitModal,SalesActionModal} from '../app/CRMApp';
import {ClientDuplicateReview} from '../app/components/client-duplicate-review';
import {salesCommandRepository,SalesCommandRejectedError} from '../app/repositories/sales-command-repository';
import {entraAuth} from '../app/lib/entra-auth';
import {clients as sampleClients,units as sampleUnits,contracts as sampleContracts} from '../app/crm-data';

for(const [input,expected] of [['5 100 000',5100000],['5\u00a0100\u00a0000,50',5100000.5],['5\u202f100\u202f000',5100000],['0',0],['',null],['   ',null]] as const){
 test(`nová jednotka zachová cenu ${JSON.stringify(input)} bez tichého vynechání`,async()=>{
  const saved:import('../app/repositories/catalog-repository').InventoryImportRow[]=[];
  render(<CreateUnitModal project={sampleProjects[0]} close={()=>{}} save={async row=>{saved.push(row);}}/>);
  fireEvent.change(screen.getByLabelText('Označení'),{target:{value:'TECH-PRICE'}});
  fireEvent.change(screen.getByLabelText('Podlahová plocha m²'),{target:{value:'54,2'}});
  fireEvent.change(screen.getByLabelText('Ceníková cena'),{target:{value:input}});
  await userEvent.setup({document}).click(screen.getByRole('button',{name:'Vytvořit jednotku'}));
  await waitFor(()=>assert.equal(saved.length,1));assert.equal(saved[0].price,expected);assert.equal(saved[0].areaM2,54.2);assert.ok(saved[0].idempotencyKey);
 });
}
for(const input of ['chyba','-100','1e6','0xFF','12,3,4','Infinity']){
 test(`nová jednotka odmítne neplatnou cenu ${input} před requestem`,async()=>{
  let calls=0;render(<CreateUnitModal project={sampleProjects[0]} close={()=>{}} save={async()=>{calls++;}}/>);
  fireEvent.change(screen.getByLabelText('Označení'),{target:{value:'TECH-PRICE'}});
  fireEvent.change(screen.getByLabelText('Podlahová plocha m²'),{target:{value:'54,2'}});
  fireEvent.change(screen.getByLabelText('Ceníková cena'),{target:{value:input}});
  await userEvent.setup({document}).click(screen.getByRole('button',{name:'Vytvořit jednotku'}));
  await waitFor(()=>assert.ok(screen.getByText('Doplňte platnou nezápornou cenu')));assert.equal(calls,0);
 });
}

test('opakování vytvoření jednotky zachová cenu i idempotency key a neplatná užitná plocha nezmizí',async()=>{
 const saved:import('../app/repositories/catalog-repository').InventoryImportRow[]=[];
 render(<CreateUnitModal project={sampleProjects[0]} close={()=>{}} save={async row=>{saved.push(row);if(saved.length===1)throw new Error('Zkuste znovu');}}/>);
 fireEvent.change(screen.getByLabelText('Označení'),{target:{value:'TECH-RETRY'}});
 fireEvent.change(screen.getByLabelText('Podlahová plocha m²'),{target:{value:'54,2'}});
 fireEvent.change(screen.getByLabelText('Užitná plocha m²'),{target:{value:'neplatná'}});
 fireEvent.change(screen.getByLabelText('Ceníková cena'),{target:{value:'5 100 000'}});
 const user=userEvent.setup({document});await user.click(screen.getByRole('button',{name:'Vytvořit jednotku'}));
 await waitFor(()=>assert.ok(screen.getByText('Doplňte platnou užitnou plochu')));assert.equal(saved.length,0);
 fireEvent.change(screen.getByLabelText('Užitná plocha m²'),{target:{value:'50,1'}});
 await user.click(screen.getByRole('button',{name:'Vytvořit jednotku'}));await screen.findByText('Zkuste znovu');
 await user.click(screen.getByRole('button',{name:'Vytvořit jednotku'}));await waitFor(()=>assert.equal(saved.length,2));
 assert.deepEqual(saved[0],saved[1]);assert.equal(saved[1].price,5100000);assert.equal(saved[1].usableAreaM2,50.1);
});

const duplicateFixture:import('../app/repositories/client-repository').DuplicateMatch={id:'duplicate-outside-loaded-page',name:'TECH Test',kind:'FO',strength:'strong',reasons:['Stejný e-mail'],email:'test@example.test',phone:'+420777000743',projects:['Technical project'],units:['7403']};
const duplicateUnit={...sampleUnits[0],id:'TEST-DUP',backendId:'c6fdff2d-b304-4df9-a8fb-688c50ee8703',projectBackendId:'cd3605bd-9ef7-461b-b3f2-54f0447fff60'};
async function fillDuplicateParty(){
 await userEvent.setup({document}).click(screen.getByRole('button',{name:'Klient v databázi není – založit nový'}));
 fireEvent.change(screen.getByLabelText('Jméno'),{target:{value:'TECH'}});fireEvent.change(screen.getByLabelText('Příjmení'),{target:{value:'Test'}});
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'test@example.test'}});
}
for(const mode of ['interest','pre_reservation'] as const)test(`duplicita v ${mode}: výběr existujícího klienta zachová UUID bez založení další party`,async()=>{
 const find=clientRepository.findDuplicates,create=clientRepository.createParty;let creates=0;
 const saved:Array<{partyId:string;newParty?:unknown}>=[];
 clientRepository.findDuplicates=async input=>{assert.equal(input.projectId,duplicateUnit.projectBackendId);assert.equal('duplicateOverride' in input,false);return[duplicateFixture];};clientRepository.createParty=async()=>{creates++;return{id:'unwanted'};};
 try{render(<SalesActionModal action={{unit:duplicateUnit,mode}} clientRows={[]} close={()=>{}} save={async value=>{saved.push(value);}}/>);await fillDuplicateParty();
  const user=userEvent.setup({document});await user.click(screen.getByRole('button',{name:'Pokračovat'}));
  await screen.findByText('Klient s těmito údaji už pravděpodobně existuje.');assert.equal(saved.length,0);assert.ok(screen.getByText('Technical project · 7403'));
  assert.equal(screen.getByRole('link',{name:'Otevřít klienta'}).getAttribute('href'),'/clients/duplicate-outside-loaded-page');
  await user.click(screen.getByRole('button',{name:'Použít existujícího klienta'}));assert.equal((screen.getByRole('radio') as HTMLInputElement).checked,true);
  await user.click(screen.getByRole('button',{name:'Pokračovat'}));await waitFor(()=>assert.equal(saved.length,1));assert.equal(saved[0].partyId,duplicateFixture.id);assert.equal(saved[0].newParty,undefined);assert.equal(creates,0);
 }finally{clientRepository.findDuplicates=find;clientRepository.createParty=create;}
});
test('selhání duplicate checku v jednání nedovolí vytvoření a lze bezpečně opakovat kontrolu',async()=>{
 const original=clientRepository.findDuplicates;let checks=0;let saved=0;
 clientRepository.findDuplicates=async()=>{if(++checks===1)throw new Error('Kontrolu duplicit se nepodařilo provést. Zkuste to prosím znovu.');return[];};
 try{render(<SalesActionModal action={{unit:duplicateUnit,mode:'pre_reservation'}} clientRows={[]} close={()=>{}} save={async()=>{saved++;}}/>);await fillDuplicateParty();const user=userEvent.setup({document});await user.click(screen.getByRole('button',{name:'Pokračovat'}));await screen.findByText('Kontrolu duplicit se nepodařilo provést. Zkuste to prosím znovu.');assert.equal(saved,0);
  await user.click(screen.getByRole('button',{name:'Pokračovat'}));await waitFor(()=>assert.equal(saved,1));assert.equal(checks,2);
 }finally{clientRepository.findDuplicates=original;}
});
test('explicitní override v jednání se po změně údajů zruší a musí být znovu potvrzen',async()=>{
 const original=clientRepository.findDuplicates;let checks=0;const sent:Array<{duplicateOverride?:boolean}>=[];
 clientRepository.findDuplicates=async()=>{checks++;return[{...duplicateFixture,strength:'possible'}];};
 try{render(<SalesActionModal action={{unit:duplicateUnit,mode:'pre_reservation'}} clientRows={[]} close={()=>{}} save={async value=>{if(value.newParty)sent.push(value.newParty);}}/>);await fillDuplicateParty();const user=userEvent.setup({document});await user.click(screen.getByRole('button',{name:'Pokračovat'}));await screen.findByText('Našli jsme podobného klienta. Ověřte prosím další údaje.');await user.click(screen.getByRole('button',{name:'Přesto vytvořit nového'}));
  fireEvent.change(screen.getByLabelText('Příjmení'),{target:{value:'Jiný test'}});await user.click(screen.getByRole('button',{name:'Pokračovat'}));assert.equal(sent.length,0);assert.equal(checks,2);
  await user.click(screen.getByRole('button',{name:'Přesto vytvořit nového'}));await user.click(screen.getByRole('button',{name:'Pokračovat'}));await waitFor(()=>assert.equal(sent.length,1));assert.equal(sent[0].duplicateOverride,true);assert.equal(checks,2);
 }finally{clientRepository.findDuplicates=original;}
});
test('nový klient a hold po ztracené odpovědi zopakují stejný request bez falešné duplicity',async t=>{
 const original=clientRepository.findDuplicates;let checks=0;let successes=0;const requests:Array<{idempotencyKey:string;newParty:unknown}>=[];
 clientRepository.findDuplicates=async()=>{checks++;return checks===1?[]:[duplicateFixture];};
 t.mock.method(entraAuth,'getAccessToken',async()=>null);t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
  requests.push(JSON.parse(String(init?.body)));if(requests.length===1)throw new TypeError('test-only connection lost after commit');return Response.json({party_id:'replayed-party',hold_id:'replayed-hold',sales_case_id:'replayed-case'});
 });
 try{render(<SalesActionModal action={{unit:duplicateUnit,mode:'pre_reservation'}} clientRows={[]} close={()=>{}} save={async value=>{await salesCommandRepository.createHold({unitId:duplicateUnit.backendId,type:'pre_reservation',newParty:value.newParty,expiresAt:value.expiresAt,reason:value.reason,idempotencyKey:value.idempotencyKey});successes++;}}/>);await fillDuplicateParty();const user=userEvent.setup({document});
  await user.click(screen.getByRole('button',{name:'Pokračovat'}));await screen.findByText('Výsledek uložení se nepodařilo ověřit. Zkuste to prosím znovu.');assert.equal(requests.length,1);
  await user.click(screen.getByRole('button',{name:'Pokračovat'}));await waitFor(()=>assert.equal(successes,1));assert.equal(requests.length,2);assert.equal(checks,1);assert.deepEqual(requests[0],requests[1]);assert.equal(screen.queryByText('Výsledek uložení se nepodařilo ověřit. Zkuste to prosím znovu.'),null);
 }finally{clientRepository.findDuplicates=original;}
});
test('změněné zadání dostane nový klíč a odmítnutý command znovu ověří duplicity',async()=>{
 const original=clientRepository.findDuplicates;let checks=0;const keys:string[]=[];
 clientRepository.findDuplicates=async()=>{checks++;return[];};
 try{render(<SalesActionModal action={{unit:duplicateUnit,mode:'pre_reservation'}} clientRows={[]} close={()=>{}} save={async value=>{keys.push(value.idempotencyKey);throw new SalesCommandRejectedError('Technický konflikt',409);}}/>);await fillDuplicateParty();const user=userEvent.setup({document});
  await user.click(screen.getByRole('button',{name:'Pokračovat'}));await screen.findByText('Technický konflikt');await user.click(screen.getByRole('button',{name:'Pokračovat'}));await waitFor(()=>assert.equal(keys.length,2));assert.equal(keys[0],keys[1]);assert.equal(checks,2);
  fireEvent.change(screen.getByLabelText('Telefon'),{target:{value:'+420777000742'}});await user.click(screen.getByRole('button',{name:'Pokračovat'}));await waitFor(()=>assert.equal(keys.length,3));assert.notEqual(keys[1],keys[2]);assert.equal(checks,3);
 }finally{clientRepository.findDuplicates=original;}
});
test('read-only duplicate check nespouští globální obnovu pracovního prostoru',async t=>{
 t.mock.method(entraAuth,'getAccessToken',async()=>null);t.mock.method(globalThis,'fetch',async()=>Response.json({matches:[]}));
 let mutations=0;const listen=()=>{mutations++;};window.addEventListener('develocrm:data-mutated',listen);
 try{await clientRepository.findDuplicates({projectId:duplicateUnit.projectBackendId,kind:'individual',firstName:'TECH',lastName:'Test'});assert.equal(mutations,0);}finally{window.removeEventListener('develocrm:data-mutated',listen);}
});
test('nové jednání bez kontextu nevybere automaticky prvního klienta adresáře',async()=>{
 let calls=0;render(<SalesActionModal action={{unit:duplicateUnit,mode:'pre_reservation'}} clientRows={[sampleClients[0]]} close={()=>{}} save={async()=>{calls++;}}/>);
 assert.equal((screen.getByRole('radio') as HTMLInputElement).checked,false);
 await userEvent.setup({document}).click(screen.getByRole('button',{name:'Pokračovat'}));await screen.findByText('Vyberte klienta nebo zájemce');assert.equal(calls,0);
});
test('historický zájem ani starý kupující bez aktivního obchodu se nepředvyberou',()=>{
 const context:import('../app/crm-data').UnitCommercialContext={salesCaseId:null,buyers:[{partyId:'old-buyer',name:'Historical',email:'',role:'buyer',share:null}],buyerHistory:[],stage:null,hold:null,interests:[{date:'',partyId:'old-interest',name:'Historical',type:'',result:'',status:'closed'}]};
 assert.equal(preferredSalesPartyId(context),'');
 context.interests.push({date:'',partyId:'active-interest',name:'Active',type:'',result:'',status:'active'});
 assert.equal(preferredSalesPartyId(context),'active-interest');
 context.salesCaseId='active-case';assert.equal(preferredSalesPartyId(context),'old-buyer');
 assert.equal(preferredSalesPartyId({...context,salesCaseId:null,interests:context.interests.map(item=>({...item,status:undefined}))}),'');
});
test('sdílený přehled duplicit používá stejnou akci otevření pro samostatný formulář',async()=>{
 let opened='';render(<ClientDuplicateReview matches={[duplicateFixture]} override={false} onOverride={()=>{}} onUse={()=>{}} onOpen={id=>{opened=id;}}/>);
 await userEvent.setup({document}).click(screen.getByRole('button',{name:'Otevřít klienta'}));assert.equal(opened,duplicateFixture.id);
});

test('celý formulář příslušenství uloží právní formu a neúplný podíl zastaví před requestem',async()=>{
 const saved:Array<import('../backend/src/shared/accessory-legal-details').AccessoryUpdateInput>=[];
 render(<EditAccessoryModal item={{id:'technical-accessory',code:'TECH-P1',type:'Parkovací stání',category:'parking',areaM2:null,amount:500000,project:'Technical',available:true}} close={()=>{}} save={async value=>{saved.push(value);}}/>);
 fireEvent.change(screen.getByRole('combobox',{name:'Právní forma příslušenství'}),{target:{value:'garage_coownership'}});
 fireEvent.change(screen.getByRole('spinbutton',{name:'Podíl – čitatel'}),{target:{value:'1'}});
 await userEvent.setup({document}).click(screen.getByRole('button',{name:'Uložit'}));
 await waitFor(()=>assert.match(screen.getByText(/Zkontrolujte smluvní vymezení/).textContent??'',/podíl/));assert.equal(saved.length,0);
 fireEvent.change(screen.getByRole('spinbutton',{name:'Podíl – jmenovatel'}),{target:{value:'25'}});
 await userEvent.setup({document}).click(screen.getByRole('button',{name:'Uložit'}));
 await waitFor(()=>assert.equal(saved.length,1));assert.deepEqual(saved[0].legalDetails,{legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25});assert.equal(saved[0].amount,500000);
});

test('plánovaná data podpisu se uloží k přesné verzi a neprezentují se jako skutečný podpis',async()=>{
 const original=commercialRepository.setSigningPlan;let sent:unknown;let refreshes=0;
 commercialRepository.setSigningPlan=async(contractId,value)=>{sent={contractId,...value};};
 try{
  render(<ContractSigningPlanForm contractId="contract-test" plan={{versionId:'version-test',sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-03',editable:true}} disabled={false} onSaved={async()=>{refreshes++;}}/>);
  assert.ok(screen.getByText(/Nejde o evidenci skutečného podpisu/));
  const buyer=screen.getByLabelText<HTMLInputElement>('Kupující – plánované datum podpisu');
  fireEvent.change(buyer,{target:{value:'2026-11-04'}});
  await userEvent.setup({document}).click(screen.getByRole('button',{name:'Uložit plánovaná data'}));
  await waitFor(()=>assert.equal(refreshes,1));assert.deepEqual(sent,{contractId:'contract-test',versionId:'version-test',sellerPlannedOn:'2026-11-02',buyerPlannedOn:'2026-11-04'});
 }finally{commercialRepository.setSigningPlan=original;}
});
test('selhání uložení plánovaných dat zachová formulář a zobrazí českou chybu',async()=>{
 const original=commercialRepository.setSigningPlan;commercialRepository.setSigningPlan=async()=>{throw new Error('Vytvořte novou verzi smlouvy.');};
 try{render(<ContractSigningPlanForm contractId="contract-test" plan={{versionId:'version-test',sellerPlannedOn:null,buyerPlannedOn:null,editable:true}} disabled={false} onSaved={async()=>assert.fail('nesmí obnovit úspěch')}/>);
  await userEvent.setup({document}).click(screen.getByRole('button',{name:'Uložit plánovaná data'}));
  assert.equal((await screen.findByRole('alert')).textContent,'Vytvořte novou verzi smlouvy.');
  assert.equal(screen.getByRole('button',{name:'Uložit plánovaná data'}).hasAttribute('disabled'),false);
 }finally{commercialRepository.setSigningPlan=original;}
});
test('přehled klienta rozliší bydliště a doručování a respektuje kontaktní oprávnění',()=>{
 const client={kind:'FO' as const,address:{addressType:'residence',line1:'Bydliště TEST',city:'Praha',countryCode:'CZ'},deliveryAddress:null,canReadContractIdentity:true};
 const view=render(<dl><ClientAddressSummary client={client}/></dl>);
 assert.ok(screen.getByText('Bydliště TEST, Praha, CZ'));assert.ok(screen.getByText('Doručovací adresa'));assert.ok(screen.getByText('—'));
 view.rerender(<dl><ClientAddressSummary client={{...client,canReadContractIdentity:false}}/></dl>);
 assert.equal(screen.queryByText('Bydliště TEST, Praha, CZ'),null);assert.equal(screen.queryByText('Doručovací adresa'),null);
});
test('doručovací adresa není automatický fallback bydliště a kopíruje se jen explicitně',async()=>{
 const client={...sampleClients[0],kind:'FO' as const,canReadContractIdentity:true,
   address:{addressType:'residence',line1:'Testovací bydliště 1',city:'Testovací město',countryCode:'CZ'},deliveryAddress:null};
 let saved:Parameters<React.ComponentProps<typeof EditClientModal>['save']>[0]|undefined;
 render(<EditClientModal client={client} close={()=>{}} save={async value=>{saved=value;}}/>);
 const user=userEvent.setup({document});
 const residence=screen.getByRole('group',{name:'Adresa bydliště'}),delivery=screen.getByRole('group',{name:'Doručovací adresa'});
 assert.equal(within(delivery).getByRole<HTMLInputElement>('textbox',{name:'Ulice a číslo'}).value,'');
 await user.click(screen.getByRole('button',{name:'Použít stejnou adresu pro doručování'}));
 assert.equal(within(delivery).getByRole<HTMLInputElement>('textbox',{name:'Ulice a číslo'}).value,'Testovací bydliště 1');
 await user.clear(within(delivery).getByRole('textbox',{name:'Ulice a číslo'}));await user.type(within(delivery).getByRole('textbox',{name:'Ulice a číslo'}),'Jiná testovací adresa 2');
 assert.equal(within(residence).getByRole<HTMLInputElement>('textbox',{name:'Ulice a číslo'}).value,'Testovací bydliště 1');
 await user.click(screen.getByRole('button',{name:/^Uložit$/}));await waitFor(()=>assert.ok(saved));
 assert.equal(saved!.address?.addressType,'residence');assert.equal(saved!.deliveryAddress?.addressType,'correspondence');
 assert.equal(saved!.deliveryAddress?.line1,'Jiná testovací adresa 2');
});

test('neúplná doručovací adresa zastaví celý submit ještě před změnou profilu',async()=>{
 let saves=0;render(<EditClientModal client={{...sampleClients[0],canReadContractIdentity:true,address:null,deliveryAddress:null}} close={()=>{}} save={async()=>{saves++;}}/>);
 assert.equal(screen.getByRole('button',{name:'Použít stejnou adresu pro doručování'}).hasAttribute('disabled'),true);
 const user=userEvent.setup({document});const delivery=screen.getByRole('group',{name:'Doručovací adresa'});
 await user.type(within(delivery).getByRole('textbox',{name:'Ulice a číslo'}),'Technická ulice 3');
 await user.click(screen.getByRole('button',{name:/^Uložit$/}));await screen.findByText('Doplňte město.');assert.equal(saves,0);
});

test('uložená doručovací adresa se předvyplní, bez kontaktního oprávnění se skrytá adresa neposílá',async()=>{
 const deliveryAddress={addressType:'correspondence',line1:'Technická adresa 4',line2:null,city:'Praha',postalCode:null,countryCode:'CZ'};
 const client={...sampleClients[0],canReadContractIdentity:true,address:null,deliveryAddress};
 let saved:Parameters<React.ComponentProps<typeof EditClientModal>['save']>[0]|undefined;
 const view=render(<EditClientModal client={client} close={()=>{}} save={async value=>{saved=value;}}/>);
 assert.equal(within(screen.getByRole('group',{name:'Doručovací adresa'})).getByRole<HTMLInputElement>('textbox',{name:'Ulice a číslo'}).value,deliveryAddress.line1);
 view.rerender(<EditClientModal client={{...client,canReadContractIdentity:false}} close={()=>{}} save={async value=>{saved=value;}}/>);
 assert.equal(screen.queryByRole('group',{name:'Doručovací adresa'}),null);
 await userEvent.setup({document}).click(screen.getByRole('button',{name:/^Uložit$/}));await waitFor(()=>assert.ok(saved));
 assert.equal(saved!.address,undefined);assert.equal(saved!.deliveryAddress,undefined);
});

test('ukončení smlouvy vyžaduje viditelné potvrzení bez systémového dialogu',async()=>{
 const original=paymentRepository.list;const originalConfirm=window.confirm;
 paymentRepository.list=async()=>({payments:[],source:'postgresql'});
 window.confirm=()=>{throw new Error('Native confirm must not be used');};
 try{
  const user=userEvent.setup({document});let calls=0;
  render(<ContractWorkflowModal contract={{...sampleContracts[0],id:'technical-contract',reference:'TECH-RS',type:'RS',statusCode:'signed'}} close={()=>{}} save={async()=>{calls++;}}/>);
  await user.selectOptions(screen.getByRole('combobox',{name:'Nový stav'}),'cancelled');
  await user.type(screen.getByRole('textbox',{name:'Důvod'}),'Technický test');
  await user.click(screen.getByRole('button',{name:'Uložit'}));
  assert.ok(await screen.findByText('Potvrďte zrušení nebo ukončení smlouvy.'));assert.equal(calls,0);
  await user.click(screen.getByRole('checkbox',{name:'Potvrzuji zrušení nebo ukončení smlouvy TECH-RS.'}));
  await user.click(screen.getByRole('button',{name:'Uložit'}));
  await waitFor(()=>assert.equal(calls,1));
 }finally{paymentRepository.list=original;window.confirm=originalConfirm;}
});

test('rozhodnutí o vratce neslibuje převod peněz a zachová explicitní rozhodnutí',async()=>{
 const original=paymentRepository.list;
 const payment:PaymentRecord={id:'technical-obligation',label:'Rezervační poplatek',paid:1000,unit:'TECH',unitId:'technical-unit',projectId:'technical-project',project:'Technický projekt',client:'Technický klient',salesCaseId:'technical-case',type:'reservation_fee',amount:1000,currency:'CZK',dueAt:'2026-10-29',status:'paid',transactions:[],events:[]};
 paymentRepository.list=async()=>({payments:[payment],source:'postgresql'});
 let saved:Parameters<React.ComponentProps<typeof ContractWorkflowModal>['save']>[0]|undefined;
 try{
  const user=userEvent.setup({document});
  render(<ContractWorkflowModal contract={{...sampleContracts[0],id:'technical-contract',reference:'TECH-RS',type:'RS',statusCode:'signed'}} close={()=>{}} save={async value=>{saved=value;}}/>);
  await user.selectOptions(screen.getByRole('combobox',{name:'Nový stav'}),'cancelled');
  const group=await screen.findByRole('group',{name:'Rozhodnutí o přijatých platbách'});
  assert.match(group.textContent??'',/CRM peníze neposílá/);
  assert.match(group.textContent??'',/provedenou vratku pak zaevidujete v detailu platby/i);
  assert.doesNotMatch(group.textContent??'',/peníze se odešlou/);
  await user.type(screen.getByRole('textbox',{name:'Důvod'}),'Technický test');
  await user.click(screen.getByRole('checkbox',{name:'Potvrzuji zrušení nebo ukončení smlouvy TECH-RS.'}));
  await user.click(screen.getByRole('button',{name:'Uložit'}));
  await screen.findByText('Rozhodněte o přijaté platbě Rezervační poplatek');assert.equal(saved,undefined);
  await user.selectOptions(screen.getByRole('combobox',{name:'Rozhodnutí o Rezervační poplatek'}),'partial');
  await user.type(screen.getByRole('spinbutton',{name:'Částka k vrácení'}),'400');
  await user.click(screen.getByRole('button',{name:'Uložit'}));
  await waitFor(()=>assert.ok(saved));
  assert.deepEqual(saved!.refundDecisions,[{obligationId:payment.id,decision:'partial',amount:400}]);
  assert.equal(saved!.to,'cancelled');assert.equal(typeof saved!.idempotencyKey,'string');
 }finally{paymentRepository.list=original;}
});

test('přehled projektu nabízí jen otevřenou práci a skutečné termíny vlastního projektu',async()=>{
 const original=[...sampleContracts];let tab='';
 const project={...sampleProjects[0],backendId:'technical-project',units:1,attention:99,plannedHandover:'—'};
 const base={...original[0],projectId:project.backendId,project:project.name,salesCaseStatus:'active'};
 const payment:PaymentRecord={id:'pending',label:'Splátka',paid:0,unit:'TECH-A',unitId:'unit',projectId:project.backendId,project:project.name,client:'Technický klient',salesCaseId:'case',type:'installment',amount:1000,currency:'CZK',dueAt:'2026-11-03',status:'pending',transactions:[],events:[]};
 const handover:import('../app/repositories/handover-repository').HandoverRecord={id:'planned',projectId:project.backendId,project:project.name,unitId:'unit',unit:'TECH-A',scheduledAt:'2026-11-04T10:00:00Z',client:'Technický klient',owner:'Technik',salesCaseId:'case',status:'planned',readiness:50,attention:null,place:null,note:null,completedAt:null,participants:[],history:[]};
 try{
  sampleContracts.splice(0,sampleContracts.length,{...base,id:'cancelled',statusCode:'cancelled'},{...base,id:'closed-approved',statusCode:'approved',salesCaseStatus:'cancelled'},{...base,id:'current',statusCode:'draft'},{...base,id:'foreign',projectId:'other-project',statusCode:'draft'},{...base,id:'signed',statusCode:'signed'});
  render(<ProjectOverview project={project} onTab={value=>{tab=value;}} taskRows={[{id:'done',title:'Hotový úkol',object:'Jednotka',project:project.name,projectId:project.backendId,due:'',priority:'Vysoká',owner:'Technik',done:true}]} paymentRows={[{...payment,id:'cancelled',unit:'CANCELLED',status:'cancelled',dueAt:'2026-01-01'},{...payment,id:'foreign',projectId:'other-project',unit:'FOREIGN',dueAt:'2026-01-01'},payment]} handoverRows={[{...handover,id:'completed',unit:'COMPLETED',status:'handed_over',scheduledAt:'2026-01-01T10:00:00Z'},{...handover,id:'foreign',unit:'FOREIGN',projectId:'other-project'},handover]}/>);
  assert.ok(screen.getByText('1 položek'));assert.ok(screen.getByText('1 smlouva čeká na další krok'));
  assert.equal(screen.queryByText('Hotový úkol'),null);assert.equal(screen.queryByText(/Kontrola smluvních dat/),null);
  assert.ok(screen.getByRole('button',{name:/3\. 11\. 2026\s*Splatnost · TECH-A/}));
  assert.ok(screen.getByRole('button',{name:/4\. 11\. 2026 11:00\s*Příprava předání TECH-A/}));
  assert.equal(screen.queryByText(/COMPLETED|FOREIGN/),null);
  await userEvent.setup({document}).click(screen.getByRole('button',{name:/Dokončit rozpracované smlouvy/}));assert.equal(tab,'contracts');
 }finally{sampleContracts.splice(0,sampleContracts.length,...original);}
});

test('přehled bez otevřené práce nemá falešné CTA ani smyšlený termín',()=>{
 const original=[...sampleContracts];const project={...sampleProjects[0],backendId:'technical-project',units:1,attention:99,plannedHandover:'—'};
 try{
  sampleContracts.splice(0,sampleContracts.length,{...original[0],id:'historical',projectId:project.backendId,salesCaseStatus:'cancelled',statusCode:'approved'});
  render(<ProjectOverview project={project} onTab={()=>{}} taskRows={[]} paymentRows={[]} handoverRows={[]}/>);
  assert.equal(screen.queryByRole('button',{name:/Dokončit rozpracované smlouvy/}),null);
  assert.ok(screen.getByText('Žádné otevřené úkoly ani rozpracované smlouvy'));assert.ok(screen.getByText('Žádné evidované termíny.'));
  assert.equal(screen.queryByText('23. 7.'),null);assert.equal(screen.queryByText('99 položek'),null);
 }finally{sampleContracts.splice(0,sampleContracts.length,...original);}
});

test('seznam smluv jednotky zachová historický návrh bez akce na změnu stavu',()=>{
 const original=[...sampleContracts];
 try{
  sampleContracts.splice(0,sampleContracts.length,{...original[0],id:'historical-sbk',unitId:'technical-unit',type:'SBK',typeCode:'sbk',statusCode:'draft',salesCaseStatus:'cancelled',reference:'TECH-HISTORICAL-SBK'});
  render(<UnitContracts unit={{...sampleUnits[0],backendId:'technical-unit'}} openContract={()=>{}} nextContractAction={null} onWorkflow={()=>{throw new Error('Historical contract must not advance');}}/>);
  assert.ok(screen.getByText(/TECH-HISTORICAL-SBK/));
  assert.equal(screen.queryByRole('button',{name:/Změnit stav/}),null);
  assert.ok(screen.getByRole('button',{name:'Otevřít smlouvu'}));
 }finally{sampleContracts.splice(0,sampleContracts.length,...original);}
});

test('ukončení smlouvy ukazuje uvolnění nebo konkrétní překážku bez finančního slibu',()=>{
 const view=render(<ContractEndResult outcome={{state:'released',reasons:[],salesCaseId:'case',unitId:'unit'}}/>);
 assert.ok(screen.getByText('Obchod ukončen – jednotka uvolněna.'));
 view.rerender(<ContractEndResult outcome={{state:'blocked',reasons:[{code:'OWNERSHIP_UNVERIFIED',message:'Nejprve ověřte vlastnictví.'}],salesCaseId:'case',unitId:'unit'}}/>);
 assert.ok(screen.getByText('Smlouva ukončena – jednotku zatím nelze uvolnit.'));
 assert.ok(screen.getByText('Nejprve ověřte vlastnictví.'));view.unmount();
});

test('neuhrazená pohledávka zůstává dostupná i po ukončení smlouvy',()=>{
 const payment:PaymentRecord={id:'debt',projectId:'project',project:'TECH',unitId:'unit',unit:'TECH60',client:'Technical buyer',salesCaseId:'case',contractId:'contract',contractStatus:'terminated',type:'reservation_fee',label:'Rezervační poplatek',amount:250000,paid:50000,currency:'CZK',dueAt:'2026-10-15',status:'partially_paid',transactions:[],events:[]};
 const view=render(<PaymentDetailModal payment={payment} close={()=>{}} openUnit={()=>{}} canRecord canReverse={false} saved={()=>{}}/>);
 assert.ok(screen.getByRole('button',{name:'Uhradit platbu'}));view.unmount();
});

test('vazby jednotek používají UUID nebo jednoznačný projekt, nikdy první cizí jednotku',()=>{
 const rows=[{...sampleUnits[0],id:'417',backendId:'11111111-1111-4111-8111-111111111111',projectBackendId:'p1',project:'A'},{...sampleUnits[0],id:'417',backendId:'22222222-2222-4222-8222-222222222222',projectBackendId:'p2',project:'B'}];
 assert.equal(relatedUnitHref({unit:'417',projectId:'p2'},rows),'/units/22222222-2222-4222-8222-222222222222');
 assert.equal(relatedUnitHref({unit:'417'},rows),null);
 assert.equal(relatedUnitHref({unit:'418',projectId:'p1'},rows),null);
 assert.equal(relatedUnitHref({unitId:rows[1].backendId},[]),'/units/22222222-2222-4222-8222-222222222222');
 assert.equal(relatedUnitHref({unit:'417',project:'A'},[rows[0],rows[0]]),null);
});

test('dva stejně pojmenovaní klienti se nezamění, UUID funguje i mimo načtený katalog',()=>{
 const a={...sampleClients[0],id:'11111111-1111-4111-8111-111111111111',name:'Jan Novák'};const b={...a,id:'22222222-2222-4222-8222-222222222222'};
 assert.equal(relatedClientHref('Jan Novák',[a,b]),null);
 assert.equal(relatedClientHref(b.id,[a,b]),`/clients/${b.id}`);
 assert.equal(relatedClientHref(b.id,[]),`/clients/${b.id}`);
});

test('workspace hledání používá vlastní snapshot, normalizuje české názvy a nefalšuje dokumenty',()=>{
 const data={projects:[{...sampleProjects[0],backendId:'project-b',name:'Hrdlička',code:'HRD'}],units:[{...sampleUnits[0],id:'417',backendId:'unit-b',project:'Hrdlička'}],clients:[{...sampleClients[0],id:'party-b',name:'Firma Žluťoučká',contact:'',email:'klient@firma.cz'}],contracts:[{...sampleContracts[0],id:'contract-b',reference:'RS-417',unit:'417'}]};
 assert.equal(searchWorkspace(data,'hrdlicka')[0].href,'/projects/project-b');
 assert.equal(searchWorkspace(data,'zlutoucka')[0].href,'/clients/party-b');
 assert.equal(searchWorkspace(data,'klient@firma')[0].href,'/clients/party-b');
 assert.equal(searchWorkspace(data,'RS-417')[0].type,'Smlouva');
 assert.equal(searchWorkspace(data,'RS-417')[0].href,'/contracts/contract-b');
 assert.ok(searchWorkspace(data,'417').every(row=>['Projekt','Jednotka','Klient','Smlouva'].includes(row.type)));
 assert.deepEqual(searchWorkspace({projects:[],units:[],clients:[],contracts:[]},'417'),[]);
 assert.deepEqual(searchWorkspace(data,'4'),[]);
});

test('klientské smlouvy zahrnou více projektů podle party ID, ne shody jména',()=>{
 const base={...sampleContracts[0],client:'Jan Novák',parties:[{id:'cp',partyId:'buyer',name:'Jan Novák',role:'buyer',signatureStatus:'pending'}]};
 render(<ClientContractLinks partyId="buyer" contracts={[{...base,id:'c1',reference:'RS-A',project:'A'},{...base,id:'c2',reference:'RS-B',project:'B'},{...base,id:'c3',reference:'Cizí RS',parties:[{...base.parties[0],partyId:'someone-else'}]}]}/>);
 assert.equal(screen.getByRole('link',{name:/RS-A/}).getAttribute('href'),'/contracts/c1');
 assert.equal(screen.getByRole('link',{name:/RS-B/}).getAttribute('href'),'/contracts/c2');
 assert.equal(screen.queryByText('Cizí RS'),null);
});

test('odkaz na jednotku zůstává funkční i když scoped katalog jednotku neobsahuje',()=>{
 render(<RelatedUnitLink reference={{unitId:'22222222-2222-4222-8222-222222222222'}}>Jednotka 417</RelatedUnitLink>);
 assert.equal(screen.getByRole('link',{name:'Jednotka 417'}).getAttribute('href'),'/units/22222222-2222-4222-8222-222222222222');
});

test('globální hledání načítá neomezený autorizovaný snapshot bez přepsání obrazovky a při chybě nevydává seed za výsledek',async()=>{
 const original={catalog:catalogRepository.getCatalog,directory:clientRepository.getDirectory,commercial:commercialRepository.getSnapshot};
 let calls=0;
 const Harness=()=>{const state=useWorkspaceSearch('Hrdlicka',true);return <div>{state.loading?<p role="status">Načítám</p>:state.error?<p role="alert">{state.error}</p>:state.results.map(row=><a key={row.href} href={row.href}>{row.title}</a>)}</div>;};
 try{
  catalogRepository.getCatalog=async(_signal,projectId)=>{assert.equal(projectId,undefined);calls++;return{projects:[{...sampleProjects[0],name:'Hrdlička',backendId:'other-project'}],units:[],accessories:[],memberships:[],structures:[],source:'backend-api'};};
  clientRepository.getDirectory=async(_signal,projectId)=>{assert.equal(projectId,undefined);return{clients:[],unitContexts:{},source:'backend-api'};};
  commercialRepository.getSnapshot=async(_signal,projectId)=>{assert.equal(projectId,undefined);return{contracts:[],currentPrices:{},priceBreakdowns:{},priceHistories:{},priceProposals:[],contractSummary:{},source:"backend-api"};};
  const beforeNames=sampleProjects.map(project=>project.name);
  const view=render(<Harness/>);await waitFor(()=>assert.ok(screen.getByRole('link',{name:'Hrdlička'})));
  assert.equal(calls,1);assert.deepEqual(sampleProjects.map(project=>project.name),beforeNames);view.unmount();
  catalogRepository.getCatalog=async()=>{throw new Error('403');};
  render(<Harness/>);await waitFor(()=>assert.ok(screen.getByRole('alert').textContent?.includes('nepodařilo')));
  assert.equal(screen.queryByRole('link',{name:'Hrdlička'}),null);
 }finally{catalogRepository.getCatalog=original.catalog;clientRepository.getDirectory=original.directory;commercialRepository.getSnapshot=original.commercial;}
});

let cleanup:()=>void;
let render:typeof import("@testing-library/react").render;
let screen:typeof import("@testing-library/react").screen;
let within:typeof import("@testing-library/react").within;
let fireEvent:typeof import("@testing-library/react").fireEvent;
let waitFor:typeof import("@testing-library/react").waitFor;
let act:typeof import("@testing-library/react").act;
let userEvent:typeof import("@testing-library/user-event").default;

test('historie kroku nespojí nové zahájení se starým dokončením',()=>{
 const event=(id:string,fromStatus:string|null,toStatus:string,occurredAt:string)=>({id,fromStatus,toStatus,occurredAt,actor:'Test',note:id,source:'manual' as const});
 const created=event('created',null,'draft','2026-10-20T08:00:00Z');
 const oldExit=event('old-exit','draft','sent','2026-10-20T09:00:00Z');
 const reopened=event('reopened','approved','draft','2026-10-26T08:00:00Z');
 const newExit=event('new-exit','draft','sent','2026-10-26T09:00:00Z');
 const history=[reopened,oldExit,created];
 const current=contractStageHistory(history,'draft','draft');
 assert.equal(current.started,reopened);assert.equal(current.completed,undefined);assert.equal(current.events.length,3);
 const completed=contractStageHistory([newExit,...history],'draft','sent');
 assert.equal(completed.started,reopened);assert.equal(completed.completed,newExit);
 // Even a partial event feed cannot mark the authoritative current stage completed.
 assert.equal(contractStageHistory([oldExit,created],'draft','draft').completed,undefined);
 // Input order, bad timestamps and same-state metadata events must not invent a visit.
 const noTransition=event('metadata','draft','draft','2026-10-26T08:30:00Z');
 const bad=event('bad','draft','sent','invalid');
 assert.equal(contractStageHistory([created,bad,newExit,oldExit,noTransition,reopened],'draft','sent').completed,newExit);
 assert.equal(contractStageHistory([noTransition,...history],'draft','draft').started,reopened);
 assert.equal(contractStageHistory([oldExit],'draft','sent').completed,undefined);
 assert.equal(contractStageHistory([],'draft','draft').started,undefined);
 // Equal timestamps retain the backend's recorded-at/id ordering.
 const sameExit={...newExit,occurredAt:reopened.occurredAt};
 assert.equal(contractStageHistory([sameExit,reopened,oldExit,created],'draft','sent').completed,sameExit);
 assert.equal(contractStageHistory([reopened,sameExit,oldExit,created],'draft','draft').completed,undefined);
 assert.deepEqual(history,[reopened,oldExit,created]);
});

test('detail opakovaně otevřeného kroku ukáže dokončení až pro stejný průchod',()=>{
 const history=[
  {id:'reset',fromStatus:'approved',toStatus:'draft',occurredAt:'2026-10-26T08:00:00Z',actor:'Test',note:'Nová verze',source:'manual' as const},
  {id:'old-exit',fromStatus:'draft',toStatus:'sent',occurredAt:'2026-10-20T09:00:00Z',actor:'Test',note:'Původní odeslání',source:'manual' as const},
  {id:'created',fromStatus:null,toStatus:'draft',occurredAt:'2026-10-20T08:00:00Z',actor:'Test',note:'Založeno',source:'manual' as const},
 ];
 const contract={...sampleContracts[0],id:'stage-history-only',typeCode:'other',statusCode:'draft',history,parties:[],versions:[]};
 const props={close:()=>{},openUnit:()=>{},openClient:()=>{},openDocument:()=>{},canManage:false,isAdmin:false,onChanged:()=>{}};
 const view=render(<ContractDetail contract={contract} {...props}/>);
 const completion=()=>view.container.querySelector('.workflow-step-detail dl > div:nth-child(2) dd')?.textContent;
 assert.equal(completion(),'—');assert.ok(screen.getByText('Nová verze'));
 view.rerender(<ContractDetail contract={{...contract,statusCode:'sent',history:[{...history[1],id:'new-exit',occurredAt:'2026-10-26T09:00:00Z'},...history]}} {...props}/>);
 assert.equal(completion(),'26. 10. 2026 10:00');
});

test('přeskočené nebo nedoložené kroky nejsou dokončené jen kvůli pozici v pořadí',()=>{
 const event=(fromStatus:string|null,toStatus:string,occurredAt:string)=>({fromStatus,toStatus,occurredAt});
 const history=[event('approved','signed','2026-10-26T11:00:00Z'),event('sent','approved','2026-10-26T10:00:00Z'),event('draft','sent','2026-10-26T09:00:00Z'),event(null,'draft','2026-10-26T08:00:00Z')];
 const steps=contractWorkflowPresentation(history,'signed');
 assert.deepEqual(steps.map(s=>s.state),['complete','complete','unrecorded','complete','current']);
 assert.equal(steps[2].stateLabel,'Bez záznamu');
 assert.deepEqual(contractWorkflowPresentation([],'approved').map(s=>s.state),['unrecorded','unrecorded','unrecorded','current','pending']);
 for(const status of ['cancelled','terminated'])assert.equal(contractWorkflowPresentation(history,status).some(s=>s.state==='current'),false);
 const reopened=[event('approved','draft','2026-10-26T12:00:00Z'),...history];
 assert.deepEqual(contractWorkflowPresentation(reopened,'draft').map(s=>s.state),['current','pending','pending','pending','pending']);
 const invalid=[event(null,'negotiation','invalid'),...history];
 assert.equal(contractWorkflowPresentation(invalid,'signed')[2].state,'unrecorded');
 // Old signing is the same visible Approved stage, not an invented extra stage.
 const legacy=[event('signing','signed','2026-10-26T11:00:00Z'),event('approved','signing','2026-10-26T10:30:00Z'),...history.slice(1)];
 assert.equal(contractWorkflowPresentation(legacy,'signed')[3].state,'complete');
 const visit=contractStageHistory(legacy,'approved','signed');
 assert.equal(visit.started?.occurredAt,'2026-10-26T10:00:00Z');assert.equal(visit.completed?.occurredAt,'2026-10-26T11:00:00Z');
 assert.equal(contractWorkflowPresentation(legacy,'signing')[3].state,'current');
});

test('seznam i detail používají stejné doložené kroky a detail zachová interakci',()=>{
 const history=[
  {id:'signed',fromStatus:'approved',toStatus:'signed',occurredAt:'2026-10-26T11:00:00Z',actor:'Test',note:'',source:'manual' as const},
  {id:'approved',fromStatus:'sent',toStatus:'approved',occurredAt:'2026-10-26T10:00:00Z',actor:'Test',note:'',source:'manual' as const},
  {id:'sent',fromStatus:'draft',toStatus:'sent',occurredAt:'2026-10-26T09:00:00Z',actor:'Test',note:'',source:'manual' as const},
  {id:'created',fromStatus:null,toStatus:'draft',occurredAt:'2026-10-26T08:00:00Z',actor:'Test',note:'',source:'manual' as const},
 ];
 let selected='';
 const view=render(<><div data-testid="compact"><ContractWorkflowSteps compact history={history} status="signed"/></div><div data-testid="detail"><ContractWorkflowSteps history={history} status="signed" selected="signed" onSelect={code=>{selected=code;}}/></div></>);
 const states=(testId:string)=>[...screen.getByTestId(testId).querySelectorAll('[data-state]')].map(e=>[e.getAttribute('data-stage'),e.getAttribute('data-state')]);
 assert.deepEqual(states('compact'),states('detail'));
 const negotiation=screen.getByRole('button',{name:'Ve vyjednávání · Bez záznamu'});
 assert.equal(negotiation.classList.contains('done'),false);fireEvent.click(negotiation);assert.equal(selected,'negotiation');
 assert.equal(screen.getByRole('button',{name:'Podepsaná · Aktuální krok'}).getAttribute('aria-pressed'),'true');
 view.rerender(<ContractWorkflowSteps compact history={history} status="terminated"/>);
 assert.equal(view.container.querySelector('.current'),null);
});

test('záložka Verze zpřístupní přesný starší dokument i když poslední verze nemá soubor',()=>{
  const meta={name:'Technická verze',basedOnVersionId:null,source:'generated',createdAt:'2026-10-23T10:00:00Z',signedAt:null};
  render(<ContractDetail contract={{...sampleContracts[0],id:'history-contract',typeCode:'rs',statusCode:'cancelled',history:[],parties:[],versions:[
    {...meta,id:'v2',number:2,status:'working'},
    {...meta,id:'v1',number:1,status:'superseded',documentVersionId:'dv1',documentReady:true,documentName:'exact-v1.docx'},
  ]}} close={()=>{}} openUnit={()=>{}} openClient={()=>{}} openDocument={()=>{}} canManage={false} isAdmin={false} onChanged={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:/^Verze\s*2$/}));
  assert.ok(screen.getByRole('button',{name:'Stáhnout dokument v1'}));
  assert.equal(screen.queryByRole('button',{name:'Stáhnout dokument v2'}),null);
  assert.ok(screen.getByText('Bez dokumentu.'));
});

test('ukončená ani zrušená RS nespouští generování a neukazuje V přípravě jako aktuální krok',()=>{
 for(const status of ['terminated','cancelled']){
  const view=render(<ContractDetail contract={{...sampleContracts[0],id:'closed-contract',typeCode:'rs',statusCode:status,history:[],parties:[],versions:[]}} close={()=>{}} openUnit={()=>{}} openClient={()=>{}} onWorkflow={()=>{throw new Error('Closed workflow');}} openDocument={()=>{}} canManage={true} isAdmin={true} onChanged={()=>{}}/>);
  assert.ok(screen.getByText(/Smlouva již nemá aktivní krok/));
  assert.equal(screen.queryByRole('button',{name:'Změnit stav'}),null);
  assert.equal(screen.queryByRole('button',{name:/V přípravě Aktuální krok/}),null);
  assert.equal(screen.queryByText('Znovu zkontrolovat'),null);
  assert.equal(screen.queryByText('Vygenerovat rezervační smlouvu'),null);
  view.unmount();
 }
});

test('portfolio nepřebírá stará projektová data a KPI zůstává stejné při změně filtru',async()=>{
 let resolveCatalog!:(snapshot:CatalogSnapshot)=>void;let requests=0;
 const response=new Promise<CatalogSnapshot>(resolve=>{resolveCatalog=resolve;});
 const loadCatalog=()=>{requests++;return response;};
 const base={...sampleProjects[0],backendId:undefined,coverImageUrl:null,buildings:[],available:0,preReserved:0,reserved:0,sold:0,handedOver:0};
 const records=[{...base,name:'Portfolio active',lifecycleStatus:'active',units:2,available:2},{...base,name:'Portfolio completed',lifecycleStatus:'completed',units:3,available:3},{...base,name:'Portfolio archived',lifecycleStatus:'completed',archivedAt:'2026-10-14T10:00:00Z',units:99,available:99}] as ProjectRecord[];
 render(<Projects openProject={()=>{}} loadCatalog={loadCatalog}/>);
 assert.ok(screen.getByRole('status').textContent?.includes('Načítám projekty'));
 assert.equal(screen.queryByText('Aktivní projekty'),null);
 await act(async()=>resolveCatalog({projects:records,units:[],accessories:[],memberships:[],structures:[],source:'backend-api'}));
 const metric=(label:string)=>screen.getByText(label).parentElement?.querySelector('strong')?.textContent;
 assert.equal(metric('Aktivní projekty'),'1');assert.equal(metric('Jednotky celkem'),'5');
 assert.ok(screen.getByRole('heading',{name:'Portfolio completed'}));assert.equal(screen.queryByRole('heading',{name:'Portfolio archived'}),null);
 const user=userEvent.setup();await user.selectOptions(screen.getByRole('combobox',{name:'Zobrazení projektů'}),'completed');
 assert.equal(screen.queryByRole('heading',{name:'Portfolio active'}),null);assert.ok(screen.getByRole('heading',{name:'Portfolio completed'}));
 await user.selectOptions(screen.getByRole('combobox',{name:'Zobrazení projektů'}),'archived');
 assert.ok(screen.getByRole('heading',{name:'Portfolio archived'}));assert.equal(metric('Jednotky celkem'),'5');
 await user.selectOptions(screen.getByRole('combobox',{name:'Zobrazení projektů'}),'visible');
 assert.equal(screen.queryByRole('heading',{name:'Portfolio archived'}),null);assert.equal(requests,1);
});

test('chyba načtení portfolia nevydává nuly nebo stará data za aktuální KPI',async()=>{
 render(<Projects openProject={()=>{}} loadCatalog={async()=>{throw new Error('transport unavailable');}}/>);
 await screen.findByRole('alert');assert.equal(screen.queryByText('Aktivní projekty'),null);
});

test('archivace projektu vyžaduje potvrzení, ukáže závazky a obnovuje bez změny obchodního stavu',async()=>{
 const calls:Array<{url:string;body?:string}>=[];let changed=0;
 const request=async(input:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(input),body:init?.body as string|undefined});return Response.json(init?.method==='PATCH'?{changed:true}:{activeCases:2,activeContracts:1,unpaidObligations:1});};
 const project={backendId:'00000000-0000-4000-8000-000000000001',name:'Archive UI test',lifecycleStatus:'completed'} as ProjectRecord;
 const view=render(<ProjectArchiveAction project={project} request={request} onChanged={()=>changed++}/>);
 const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Akce projektu'}));await user.click(screen.getByRole('menuitem',{name:'Archivovat projekt'}));
 await screen.findByText(/Projekt má probíhající obchodní procesy/);assert.equal(calls.filter(call=>call.body).length,0);
 await user.click(screen.getByRole('button',{name:'Archivovat projekt'}));await waitFor(()=>assert.equal(changed,1));
 assert.deepEqual(JSON.parse(calls.find(call=>call.body)!.body!),{archived:true});
 view.rerender(<ProjectArchiveAction project={{...project,archivedAt:'2026-10-14T10:00:00Z'}} request={request} onChanged={()=>changed++}/>);
 await user.click(screen.getByRole('button',{name:'Akce projektu'}));await user.click(screen.getByRole('menuitem',{name:'Obnovit z archivu'}));
 await screen.findByText(/Projekt se znovu zobrazí/);await user.click(screen.getByRole('button',{name:'Obnovit z archivu'}));await waitFor(()=>assert.equal(changed,2));
 assert.deepEqual(JSON.parse(calls.filter(call=>call.body).at(-1)!.body!),{archived:false});
});

before(async()=>{
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://develocrm.test"});
  Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,MouseEvent:dom.window.MouseEvent,CustomEvent:dom.window.CustomEvent,KeyboardEvent:dom.window.KeyboardEvent,getComputedStyle:dom.window.getComputedStyle,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
  Object.defineProperty(globalThis,"navigator",{value:dom.window.navigator,configurable:true});
  const library=await import("@testing-library/react");
  ({cleanup,render,screen,fireEvent,waitFor,act,within}=library);
  userEvent=(await import("@testing-library/user-event")).default;
});

afterEach(()=>{cleanup();window.localStorage.clear();});

test('změna obchodního kontextu okamžitě skryje stará data a pozdní odpověď je nepřepíše',async()=>{
 const finish:Record<string,(value:string)=>void>={};
 function Harness({id}:{id:string}){const read=useAsyncRead(id,useCallback(()=>new Promise<string>(resolve=>{finish[id]=resolve;}),[id]));return <><AsyncNotice loading={read.loading} error={read.error}/>{read.data&&<span>{read.data}</span>}</>;}
 const view=render(<Harness id="a"/>);
 await act(async()=>finish.a('Obchod A'));assert.ok(screen.getByText('Obchod A'));
 view.rerender(<Harness id="b"/>);assert.equal(screen.queryByText('Obchod A'),null);assert.ok(screen.getByRole('status'));
 view.rerender(<Harness id="c"/>);
 await act(async()=>finish.b('Pozdní obchod B'));assert.equal(screen.queryByText('Pozdní obchod B'),null);
 await act(async()=>finish.c('Obchod C'));assert.ok(screen.getByText('Obchod C'));
});

test('načítání, prázdno, zákaz a chyba jsou odlišné, opakování načtení funguje',async()=>{
 let calls=0;
 const request=async()=>{if(++calls===1)throw new ReadError(403);return [] as string[];};
 function Harness(){const read=useAsyncRead('permission',request);return <AsyncNotice loading={read.loading} error={read.error} empty={read.data?.length===0} retry={read.retry}/>;}
 render(<Harness/>);assert.ok(screen.getByRole('status'));
 await screen.findByText('Nedostatečné oprávnění');assert.equal(screen.queryByText('Žádné záznamy'),null);
 await userEvent.setup().click(screen.getByRole('button',{name:'Zkusit znovu'}));
 await screen.findByText('Žádné záznamy');assert.equal(calls,2);
});

const columns:readonly TableColumnDefinition[]=[
  {id:"name",label:"Název",required:true,defaultVisible:true},
  {id:"price",label:"Cena",defaultVisible:true},
  {id:"status",label:"Stav",defaultVisible:false},
];

function ColumnHarness(){
  const state=useTableColumns("interaction-table",columns);
  return <><TableColumnMenu columns={columns} state={state}/><output>{state.visibleIds.join(",")}</output></>;
}

test("column picker se otevře, okamžitě skryje sloupec, uloží preferenci a umí reset",async()=>{
  const user=userEvent.setup({document});
  render(<TableColumnPreferenceProvider userKey="tester"><ColumnHarness/></TableColumnPreferenceProvider>);
  await waitFor(()=>assert.match(screen.getByRole("status").textContent??"",/price/));
  await user.click(screen.getByRole("button",{name:/Sloupce/}));
  const price=screen.getByRole("checkbox",{name:"Cena"});
  await user.click(price);
  assert.doesNotMatch(screen.getByRole("status").textContent??"",/price/);
  await waitFor(()=>assert.match(window.localStorage.getItem("develocrm.table-columns.v2:tester:interaction-table")??"",/name/));
  await user.click(screen.getByRole("button",{name:/Obnovit výchozí sloupce/}));
  assert.match(screen.getByRole("status").textContent??"",/price/);
});

test("row menu podporuje click, akci, zavření a klávesu Escape",async()=>{
  const user=userEvent.setup({document});let selected="";
  render(<RowActionMenu label="Akce smlouvy" actions={[{label:"Otevřít",onSelect:()=>{selected="open";}},{label:"Archivovat",danger:true,onSelect:()=>{selected="archive";}}]}/>);
  const trigger=screen.getByRole("button",{name:"Akce smlouvy"});
  await user.click(trigger);assert.ok(screen.getByRole("menu"));
  await user.click(screen.getByRole("menuitem",{name:"Otevřít"}));assert.equal(selected,"open");assert.equal(screen.queryByRole("menu"),null);
  await user.click(trigger);await user.keyboard("{Escape}");assert.equal(screen.queryByRole("menu"),null);
});

test("hlavička sloupce řadí a její popover aplikuje filtr",async()=>{
  const user=userEvent.setup({document});
  function Harness(){const[sort,setSort]=useState<"none"|"asc"|"desc">("none");const[active,setActive]=useState(false);return <table><thead><tr><TableColumnFilter label="Cena" sortDirection={sort} onSort={setSort}/><TableColumnFilter label="Stav" active={active}><button onClick={()=>setActive(true)}>Jen aktivní</button></TableColumnFilter></tr></thead><tbody><tr><td>{sort}</td><td>{active?"aktivní":"vše"}</td></tr></tbody></table>}
  render(<Harness/>);
  await user.click(screen.getByRole("button",{name:"Seřadit sloupec Cena"}));assert.equal(screen.getByText("asc").textContent,"asc");
  await user.click(screen.getAllByRole("button",{name:"Filtrovat sloupec Stav"})[0]);await user.click(screen.getByRole("button",{name:"Jen aktivní"}));assert.equal(screen.getByText("aktivní").textContent,"aktivní");
});

test("souhrn klientů funguje jako kombinovatelný filtr a druhý klik výběr zruší",async()=>{
  const user=userEvent.setup({document});
  const records=[{name:"Adam",status:"Aktivní klient"},{name:"Alena",status:"Zájemce"},{name:"Boris",status:"Aktivní klient"},{name:"Cyril",status:"Archiv"}];
  function Harness(){const[selected,setSelected]=useState<string[]>([]);const[query,setQuery]=useState("");const visible=records.filter(item=>(!selected.length||selected.includes(item.status))&&item.name.toLocaleLowerCase("cs-CZ").includes(query.toLocaleLowerCase("cs-CZ")));return <><SummaryStats label="Souhrn klientských vztahů" selectedId={selected.length===1?selected[0]:undefined} onSelect={status=>setSelected(toggledSummaryFilter(selected,status))} items={[{id:"Aktivní klient",label:"Aktivní klient",value:2,icon:Users,tone:"success"},{id:"Zájemce",label:"Zájemce",value:1,icon:UserRound,tone:"info"},{id:"Archiv",label:"Archiv",value:1,icon:PackageOpen,tone:"neutral"}]}/><input aria-label="Hledat klienta" value={query} onChange={event=>setQuery(event.target.value)}/><output aria-label="Klienti">{visible.map(item=>item.name).join(",")}</output></>}
  render(<Harness/>);
  const active=screen.getByRole("button",{name:"Aktivní klient: 2"});
  await user.click(active);assert.equal(active.getAttribute("aria-pressed"),"true");assert.equal(screen.getByLabelText("Klienti").textContent,"Adam,Boris");
  await user.type(screen.getByRole("textbox",{name:"Hledat klienta"}),"bo");assert.equal(screen.getByLabelText("Klienti").textContent,"Boris");
  await user.click(active);assert.equal(active.getAttribute("aria-pressed"),"false");assert.equal(screen.getByLabelText("Klienti").textContent,"Boris");
});

test("souhrn inventáře filtruje tři stavy a Celkem stavový filtr vymaže",async()=>{
  const user=userEvent.setup({document});
  function Harness(){const[selected,setSelected]=useState<string[]>([]);return <><SummaryStats label="Souhrn sklepů" selectedId={selected.length===0?"all":selected[0]} onSelect={status=>setSelected(status==="all"?[]:toggledSummaryFilter(selected,status))} items={[{id:"all",label:"Celkem",value:10,icon:PackageOpen},{id:"Volné",label:"Volné",value:4,icon:PackageOpen,tone:"success"},{id:"Předpřiřazené",label:"Předpřiřazené",value:3,icon:PackageOpen,tone:"warning"},{id:"Přiřazené",label:"Přiřazené",value:3,icon:PackageOpen,tone:"info"}]}/><output>{selected.join(",")||"vše"}</output></>}
  render(<Harness/>);
  await user.click(screen.getByRole("button",{name:"Předpřiřazené: 3"}));assert.equal(screen.getByRole("status").textContent,"Předpřiřazené");
  await user.click(screen.getByRole("button",{name:"Celkem: 10"}));assert.equal(screen.getByRole("status").textContent,"vše");
});

test("souhrn jednotek používá projektovou projekci, kombinuje quick filtr s hledáním a Celkem filtr ruší",async()=>{
  const user=userEvent.setup({document});
  const project={units:4,available:1,preReserved:1,reserved:1,sold:1,handedOver:0};
  const aggregation=projectSalesAggregation(project);
  const records=[
    {id:"101",status:"Volný",salesBucket:"available" as const},
    {id:"102",status:"V jednání",salesBucket:"in_negotiation" as const},
    {id:"201",status:"Rezervovaná",salesBucket:"in_negotiation" as const},
    {id:"301",status:"Prodaná",salesBucket:"sold" as const},
  ];
  function Harness(){const[selected,setSelected]=useState<ProjectSalesBucket|"">("");const[query,setQuery]=useState("");const visible=records.filter(item=>(!selected||projectUnitSalesBucket(item)===selected)&&item.id.includes(query));return <><SummaryStats label="Souhrn jednotek" selectedId={selected||"all"} onSelect={id=>setSelected(id==="all"?"":id as ProjectSalesBucket)} items={[{id:"all",label:"Celkem",value:project.units,icon:PackageOpen},{id:"available",label:"Volné",value:aggregation.available,icon:PackageOpen},{id:"in_negotiation",label:"V jednání",value:aggregation.inNegotiation,icon:PackageOpen},{id:"sold",label:"Prodané",value:aggregation.sold,icon:PackageOpen}]}/><input aria-label="Hledat jednotku" value={query} onChange={event=>setQuery(event.target.value)}/><output aria-label="Jednotky">{visible.map(item=>item.id).join(",")}</output></>}
  render(<Harness/>);
  assert.equal(aggregation.available+aggregation.inNegotiation+aggregation.sold,project.units);
  await user.click(screen.getByRole("button",{name:"V jednání: 2"}));assert.equal(screen.getByLabelText("Jednotky").textContent,"102,201");
  await user.type(screen.getByRole("textbox",{name:"Hledat jednotku"}),"20");assert.equal(screen.getByLabelText("Jednotky").textContent,"201");
  await user.click(screen.getByRole("button",{name:"Celkem: 4"}));assert.equal(screen.getByLabelText("Jednotky").textContent,"201");
});

test("souhrn smluv klasifikuje dodatky a postoupení jako Ostatní a kombinuje filtr s hledáním",async()=>{
  const user=userEvent.setup({document});
  const records=[
    {reference:"DEJ-101-RS",typeCode:"rs",type:"RS"},
    {reference:"DEJ-102-SBK",typeCode:"sbk",type:"SBK"},
    {reference:"DEJ-103-KS",typeCode:"ks",type:"KS"},
    {reference:"DEJ-101-D1",typeCode:"amendment",type:"Dodatek",parentContractId:"rs-1"},
    {reference:"DEJ-102-P",typeCode:"assignment_sbk",type:"Postoupení SBK",baseContractType:"sbk"},
  ];
  const counts=contractSummaryCounts(records);
  function Harness(){const[selected,setSelected]=useState<ContractSummaryCategory|"">("");const[query,setQuery]=useState("");const visible=records.filter(item=>(!selected||contractSummaryCategory(item)===selected)&&item.reference.toLocaleLowerCase("cs-CZ").includes(query.toLocaleLowerCase("cs-CZ")));return <><SummaryStats label="Souhrn smluv" selectedId={selected||"all"} onSelect={id=>setSelected(id==="all"?"":id as ContractSummaryCategory)} items={[{id:"all",label:"Celkem",value:counts.total,icon:PackageOpen},{id:"rs",label:"RS",value:counts.rs,icon:PackageOpen},{id:"sbk",label:"SBK",value:counts.sbk,icon:PackageOpen},{id:"ks",label:"KS",value:counts.ks,icon:PackageOpen},{id:"other",label:"Ostatní",value:counts.other,icon:PackageOpen}]}/><input aria-label="Hledat smlouvu" value={query} onChange={event=>setQuery(event.target.value)}/><output aria-label="Smlouvy">{visible.map(item=>item.reference).join(",")}</output></>}
  render(<Harness/>);
  assert.equal(counts.rs+counts.sbk+counts.ks+counts.other,counts.total);
  await user.click(screen.getByRole("button",{name:"Ostatní: 2"}));assert.equal(screen.getByLabelText("Smlouvy").textContent,"DEJ-101-D1,DEJ-102-P");
  await user.type(screen.getByRole("textbox",{name:"Hledat smlouvu"}),"102");assert.equal(screen.getByLabelText("Smlouvy").textContent,"DEJ-102-P");
  await user.click(screen.getByRole("button",{name:"Celkem: 5"}));assert.equal(screen.getByLabelText("Smlouvy").textContent,"DEJ-102-SBK,DEJ-102-P");
});

test("FormModal zobrazuje loading a chybu a chrání před dvojím submittem",async()=>{
  let calls=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  render(<FormModal title="Test" close={()=>{}} onSave={async()=>{calls+=1;await pending;}}><span>Obsah</span></FormModal>);
  const submit=screen.getByRole("button",{name:"Uložit"});
  fireEvent.click(submit);fireEvent.click(submit);
  assert.equal(calls,1);assert.equal(screen.getByRole("button",{name:"Ukládám…"}).hasAttribute("disabled"),true);
  await act(async()=>release());
  cleanup();
  render(<FormModal title="Chyba" close={()=>{}} onSave={async()=>{throw new Error("Uložení bylo odmítnuto");}}><span>Obsah</span></FormModal>);
  await userEvent.setup({document}).click(screen.getByRole("button",{name:"Uložit"}));
  assert.ok(await screen.findByText("Uložení bylo odmítnuto"));
});

test("poznámkový modal provede reálný vstup a předá očištěný text mutaci",async()=>{
  const user=userEvent.setup({document});let saved="";
  render(<ContractNoteModal close={()=>{}} save={async text=>{saved=text;}}/>);
  await user.type(screen.getByRole("textbox",{name:"Poznámka"}),"  Interní informace  ");
  await user.click(screen.getByRole("button",{name:"Uložit poznámku"}));
  await waitFor(()=>assert.equal(saved,"Interní informace"));
});

test("klientská změna nabízí pouze povolený další stav, vyžádá důvod zamítnutí a ukáže historii",async()=>{
  const user=userEvent.setup({document});let transition:readonly string[]=[];
  const change={id:"change-1",title:"Výběr povrchu",unitCode:"417",partyName:"Jan Novák",status:"pending_approval",history:[{id:"event-1",fromStatus:"pricing",toStatus:"pending_approval",note:"Naceněno",actor:"Test Admin",occurredAt:"2026-09-20T08:00:00Z"}]} as never;
  render(<ClientChangeStatusModal change={change} memberships={[{id:"assignee-1",name:"Projektový manažer"}]} close={()=>{}} saved={async(status,note,assignee)=>{transition=[status,note,assignee??""];}}/>);
  assert.ok(screen.getByText(/Naceněno/));
  const select=screen.getByRole("combobox",{name:"Nový stav"});
  assert.deepEqual(Array.from(select.querySelectorAll("option")).map(option=>option.value),["approved","rejected","pricing"]);
  await user.selectOptions(select,"rejected");
  await user.click(screen.getByRole("button",{name:"Uložit změnu"}));
  assert.ok(await screen.findByText("Doplňte důvod zamítnutí nebo zrušení."));
  await user.type(screen.getByRole("textbox",{name:"Poznámka (povinná)"}),"Klient nesouhlasí");
  await user.selectOptions(screen.getByRole("combobox",{name:"Odpovědná osoba"}),"assignee-1");
  await user.click(screen.getByRole("button",{name:"Uložit změnu"}));
  await waitFor(()=>assert.deepEqual(transition,["rejected","Klient nesouhlasí","assignee-1"]));
});

test("detail reklamace umožní změnit stav a řešitele a ukáže historii",async()=>{
  const user=userEvent.setup({document});let saved:Record<string,unknown>|undefined;
  const complaint={id:"complaint-1",title:"Vadná podlaha",unitCode:"417",partyName:"Jan Novák",description:"Poškozená podlahová krytina",status:"new",assigneeMembershipId:null,dueAt:null,history:[{id:"event-1",fromStatus:null,toStatus:"new",note:null,actor:"Test Admin",occurredAt:"2026-09-20T08:00:00Z"}]} as never;
  render(<ComplaintDetailModal complaint={complaint} memberships={[{id:"assignee-1",name:"Správce reklamací"}]} close={()=>{}} save={async input=>{saved=input;}}/>);
  assert.ok(screen.getByText("Poškozená podlahová krytina"));
  assert.ok(screen.getByText("Historie"));
  await user.selectOptions(screen.getByRole("combobox",{name:"Stav"}),"in_progress");
  await user.selectOptions(screen.getByRole("combobox",{name:"Odpovědná osoba"}),"assignee-1");
  await user.type(screen.getByRole("textbox",{name:"Poznámka k postupu"}),"Převzato");
  await user.click(screen.getByRole("button",{name:"Uložit reklamaci"}));
  await waitFor(()=>assert.equal(saved?.status,"in_progress"));
  assert.equal(saved?.assigneeMembershipId,"assignee-1");
  assert.equal(saved?.note,"Převzato");
});

test("modal dodatku předá název a vratka dovolí volitelnou poznámku",async()=>{
  const user=userEvent.setup({document});let addendumTitle:string|undefined;
  const contract={id:"contract-1",reference:"DEJ-417-RS",title:"RS",type:"RS"} as never;
  render(<ContractAddendumModal contract={contract} close={()=>{}} save={async title=>{addendumTitle=title;}}/>);
  await user.type(screen.getByRole("textbox",{name:"Název dodatku (volitelné)"}),"Dodatek ke kupujícím");
  await user.click(screen.getByRole("button",{name:"Vytvořit dodatek"}));
  await waitFor(()=>assert.equal(addendumTitle,"Dodatek ke kupujícím"));
  cleanup();
  let refund:Record<string,unknown>|undefined;window.confirm=()=>true;
  const payment={id:"obligation-1",unit:"417",client:"Jan Novák",paid:100000,refunded:0,refundable:100000,refundAllowed:true,contractReference:"DEJ-417-RS",transactions:[{id:"transaction-1",amount:100000,paidAt:"2026-09-15T08:00:00Z",sourceType:"manual",refunds:[]}]} as never;
  render(<PaymentRefundForm payment={payment} busy={false} error="" cancel={()=>{}} save={async value=>{refund=value;}}/>);
  assert.ok(screen.getByText("K VRÁCENÍ"));
  assert.equal(screen.getByRole("textbox",{name:"Částka vratky"}).getAttribute("value"),"100 000");
  assert.ok(screen.getByRole("note").textContent?.includes("Peníze nejsou prostřednictvím DeveloCRM odesílány."));
  await user.click(screen.getByRole("button",{name:"Potvrdit vratku"}));
  await waitFor(()=>assert.equal(refund?.sourceTransactionId,"transaction-1"));
  assert.equal(refund?.amount,100000);assert.equal(refund?.reason,undefined);assert.equal(typeof refund?.idempotencyKey,"string");
});

test("detail platby zvýrazní vratku, zkrátí souhrn a rozliší historii",()=>{
  const payment={id:"obligation-1",project:"Rezidence Dejvice",unit:"417",client:"Jan Novák",label:"Rezervační poplatek",amount:2471000,paid:2471000,refunded:500000,refundDecision:"full",refundDecidedAmount:2471000,refundable:1971000,refundAllowed:true,status:"paid",dueAt:"2026-09-15",contractReference:"DEJ-417-RS",contractType:"rs",contractStatus:"cancelled",transactions:[{id:"transaction-1",amount:2471000,paidAt:"2026-09-15T08:00:00Z",sourceType:"manual",note:"Připsáno",refunds:[{id:"refund-1",amount:500000,refundedAt:"2026-09-16T08:00:00Z",reason:"Vráceno klientovi"}]}]} as never;
  const {container}=render(<PaymentDetailModal payment={payment} close={()=>{}} openUnit={()=>{}} canRecord={false} canReverse={false} saved={()=>{}}/>);
  const summary=container.querySelector(".payment-refund-overview");
  assert.ok(summary);
  assert.doesNotMatch(summary.textContent??"",/ČISTĚ PŘIJATO/i);
  assert.ok(summary.querySelector(".refund-due-summary")?.textContent?.includes("1 971 000"));
  assert.equal(summary.querySelectorAll(".badge").length,1);
  assert.ok(screen.getByText(/Nevrácená platba z ukončené smlouvy/));
  assert.ok(container.querySelector(".payment-history article strong")?.textContent?.includes("Úhrada +2 471 000 Kč"));
  assert.ok(container.querySelector(".refund-history strong")?.textContent?.includes("Vratka −500 000 Kč"));
  assert.ok(screen.getByRole("button",{name:"Vytvořit vratku"}));
});

test("vratka předvyplní nižší z částky transakce a celkového zůstatku",()=>{
  const payment={id:"obligation-2",unit:"417",client:"Jan Novák",paid:2471000,refunded:500000,refundable:1971000,refundAllowed:true,contractReference:"DEJ-417-RS",transactions:[{id:"transaction-2",amount:2471000,paidAt:"2026-09-15T08:00:00Z",sourceType:"manual",refunds:[]}]} as never;
  render(<PaymentRefundForm payment={payment} busy={false} error="" cancel={()=>{}} save={()=>{}}/>);
  assert.equal(screen.getByRole("textbox",{name:"Částka vratky"}).getAttribute("value"),"1 971 000");
});

test("CTA vratky používá serverovou projekci oprávnění a zbývající částky",()=>{
  const base={paid:150000,refunded:50000,refundDecision:"full",refundable:100000,refundAllowed:true} as const;
  assert.deepEqual(paymentRefundAvailability(base),{refunded:50000,refundable:100000,decisionKnown:true,available:true});
  assert.equal(paymentRefundAvailability({...base,refundAllowed:false} as never).available,false);
  assert.equal(paymentRefundAvailability({...base,refundable:0} as never).available,false);
  assert.deepEqual(paymentRefundAvailability({paid:150000,refunded:0,contractType:"rs",contractStatus:"signed"} as never),{refunded:0,refundable:null,decisionKnown:false,available:false});
});
