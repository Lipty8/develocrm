import type { ClientRecord, UnitCommercialContext } from "../crm-data";
import { clientUsesBrowserAdapter, responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";

export type ClientSnapshot = { clients: ClientRecord[]; unitContexts: Record<string,UnitCommercialContext>; source:"backend-api"|"preview-seed" };
export type ClientPageInput={page:number;pageSize:number;query?:string;quickProject?:string;types?:string[];projects?:string[];unit?:string;relations?:string[];contracts?:string[];phone?:string;email?:string;sort?:string;direction?:"asc"|"desc";includeArchived?:boolean};
export type DuplicateMatch={id:string;name:string;kind:"FO"|"PO";strength:"strong"|"possible";reasons:string[];email:string;phone:string;projects:string[];units:string[]};
export type ArchiveImpact={units:number;interests:number;salesCases:number;contracts:number;payments:number;tasks:number;handovers:number;documents:number};
export type NewPartyInput={projectId:string;kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;duplicateOverride?:boolean};
export interface ClientRepository {
  getDirectory(signal?:AbortSignal):Promise<ClientSnapshot>;
  getPage(input:ClientPageInput,signal?:AbortSignal):Promise<{clients:ClientRecord[];total:number;page:number;pageSize:number}>;
  exportContacts(partyIds:string[],format:"bcc"|"csv"):Promise<{value:string;count:number}>;
  updateParty(input:{id:string;displayName:string}):Promise<void>;
  updateProfile(input:{id:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;vatNumber?:string;contactPerson?:string}):Promise<void>;
  upsertAddress(input:{partyId:string;addressType:string;line1:string;line2?:string;city:string;postalCode?:string;countryCode:string}):Promise<void>;
  createParty(input:NewPartyInput):Promise<{id:string}>;
  findDuplicates(input:Omit<NewPartyInput,"projectId"|"duplicateOverride">):Promise<DuplicateMatch[]>;
  linkToProject(partyId:string,projectId:string):Promise<void>;
  getArchiveImpact(partyId:string):Promise<ArchiveImpact>;
  archiveParty(partyId:string,reason:string):Promise<ArchiveImpact>;
  upsertContact(input:{partyId:string;contactType:string;value:string;label?:string;isPrimary?:boolean}):Promise<void>;
}
export class ApiClientRepository implements ClientRepository {
  async getDirectory(signal?:AbortSignal):Promise<ClientSnapshot> {
    const response=await apiFetch("/api/clients",{signal,cache:"no-store"});
    if(!response.ok)throw new Error("Klienty se nepodařilo načíst");
    const snapshot=await response.json() as ClientSnapshot;if(typeof window!=="undefined"&&clientUsesBrowserAdapter()){const edits=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");snapshot.clients=snapshot.clients.map(c=>({...c,...(edits[c.id]||{})}));const created=JSON.parse(localStorage.getItem("develocrm.new.clients")||"[]");snapshot.clients.push(...created.filter((row:{id:string})=>!snapshot.clients.some(item=>item.id===row.id)));applyPreviewSalesCommands(snapshot);}return snapshot;
  }
  async getPage(input:ClientPageInput,signal?:AbortSignal){const query=new URLSearchParams({page:String(input.page),pageSize:String(input.pageSize)});for(const [key,value] of Object.entries(input)){if(key==="page"||key==="pageSize"||value==null||value===""||(Array.isArray(value)&&!value.length))continue;query.set(key,Array.isArray(value)?value.join(","):String(value));}const response=await apiFetch(`/api/clients?${query}`,{signal,cache:"no-store"});if(!response.ok)throw new Error("Stránku klientů se nepodařilo načíst");const payload=await response.json() as {clients:ClientRecord[];total?:number;page?:number;pageSize?:number};return{clients:payload.clients,total:payload.total??payload.clients.length,page:payload.page??input.page,pageSize:payload.pageSize??input.pageSize};}
  async exportContacts(partyIds:string[],format:"bcc"|"csv"):Promise<{value:string;count:number}> {
    const response=await apiFetch("/api/clients/export",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({partyIds,format})});
    if(!response.ok)throw new Error("Export není povolen");
    return response.json() as Promise<{value:string;count:number}>;
  }
  async updateParty(input:{id:string;displayName:string}){const preview=await mutate(`/api/clients/${input.id}`,"PATCH",{displayName:input.displayName},true);if(preview&&typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");e[input.id]={...(e[input.id]||{}),name:input.displayName};localStorage.setItem("develocrm.client.edits",JSON.stringify(e));}}
  async updateProfile(input:{id:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;vatNumber?:string;contactPerson?:string}){const preview=await mutate(`/api/clients/${input.id}/profile`,"PATCH",input,true);if(preview&&typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");const name=input.legalName||[input.firstName,input.lastName].filter(Boolean).join(" ");e[input.id]={...(e[input.id]||{}),...input,name};localStorage.setItem("develocrm.client.edits",JSON.stringify(e));}}
  async upsertAddress(input:{partyId:string;addressType:string;line1:string;line2?:string;city:string;postalCode?:string;countryCode:string}){const preview=await mutate(`/api/clients/${input.partyId}/addresses`,"POST",input,true);if(preview&&typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");e[input.partyId]={...(e[input.partyId]||{}),address:{...input}};localStorage.setItem("develocrm.client.edits",JSON.stringify(e));}}
  async createParty(input:NewPartyInput){const response=await apiFetch("/api/clients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});if(response.ok)return response.json() as Promise<{id:string}>;if(response.status===503&&responseAllowsBrowserFallback(response)){const id=`preview-party-${Date.now()}`;const name=input.legalName||[input.firstName,input.lastName].filter(Boolean).join(" ");const edits=JSON.parse(localStorage.getItem("develocrm.new.clients")||"[]");edits.push({id,name,type:input.kind==="individual"?"Fyzická osoba":"Právnická osoba",kind:input.kind==="individual"?"FO":"PO",email:input.email??"",phone:input.phone??"",contact:[input.email,input.phone].filter(Boolean).join(" · "),units:[],unitRelations:[],projects:"",projectNames:[],state:"Zájemce",contractStatus:"Bez smlouvy",initials:name.split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase()});localStorage.setItem("develocrm.new.clients",JSON.stringify(edits));return{id};}const payload=await response.json().catch(()=>({})) as {error?:string;matches?:DuplicateMatch[]};const error=new Error(payload.error||"Klienta se nepodařilo vytvořit") as Error&{matches?:DuplicateMatch[]};error.matches=payload.matches;throw error;}
  async findDuplicates(input:Omit<NewPartyInput,"projectId"|"duplicateOverride">){const response=await apiFetch("/api/clients/duplicates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});if(response.status===503&&responseAllowsBrowserFallback(response))return[];if(!response.ok)throw new Error("Kontrolu podobných klientů nelze dokončit");return((await response.json()) as {matches:DuplicateMatch[]}).matches;}
  async linkToProject(partyId:string,projectId:string){await mutate(`/api/clients/${partyId}/projects`,"POST",{projectId});}
  async getArchiveImpact(partyId:string){const response=await apiFetch(`/api/clients/${partyId}/archive-impact`,{cache:"no-store"});if(!response.ok)throw new Error("Vazby klienta nelze ověřit");return((await response.json()) as {impact:ArchiveImpact}).impact;}
  async archiveParty(partyId:string,reason:string){const response=await apiFetch(`/api/clients/${partyId}/archive`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason})});if(!response.ok){const payload=await response.json().catch(()=>({})) as {error?:string};throw new Error(payload.error||"Klienta nelze archivovat");}return((await response.json()) as {impact:ArchiveImpact}).impact;}
  async upsertContact(input:{partyId:string;contactType:string;value:string;label?:string;isPrimary?:boolean}){const preview=await mutate(`/api/clients/${input.partyId}/contacts`,"POST",input,true);if(preview&&typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");e[input.partyId]??={};if(input.contactType==="email")e[input.partyId].email=input.value;if(input.contactType==="phone")e[input.partyId].phone=input.value;localStorage.setItem("develocrm.client.edits",JSON.stringify(e));}}
}
async function mutate(url:string,method:string,body:unknown,allowPreview=false){const response=await apiFetch(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(response.ok)return false;if(allowPreview&&response.status===503&&responseAllowsBrowserFallback(response))return true;const payload=await response.json().catch(()=>({})) as {error?:string};throw new Error(payload.error||"Změnu klienta se nepodařilo uložit");}
type PreviewSalesCommand={kind:"interest"|"hold"|"convert"|"cancel";id?:string;partyId?:string;partyIds?:string[];type?:"pre_reservation"|"reservation";expiresAt?:string;recordedAt?:string};
function applyPreviewSalesCommands(snapshot:ClientSnapshot){
  const groups=JSON.parse(localStorage.getItem("develocrm.sales.commands")||"{}") as Record<string,PreviewSalesCommand[]>;
  for(const [unitKey,stored] of Object.entries(groups)){
    const context=snapshot.unitContexts[unitKey]??{buyers:[],interests:[],stage:null,hold:null};
    for(const command of [...stored].reverse()){
      if(command.kind==="interest"&&command.partyId){
        const party=snapshot.clients.find(item=>item.id===command.partyId);
        if(party&&!context.interests.some(item=>item.partyId===party.id))context.interests.unshift({date:new Date(command.recordedAt??Date.now()).toLocaleDateString("cs-CZ"),partyId:party.id,name:party.name,type:"Zájem",result:"Aktivní"});
      }
      if(command.kind==="hold"&&command.type){
        context.hold={id:command.id??`preview-hold-${unitKey}`,type:command.type,expiresAt:command.expiresAt??""};
        context.stage=command.type;
        context.buyers=(command.partyIds??[]).map(partyId=>snapshot.clients.find(item=>item.id===partyId)).filter((item):item is ClientRecord=>Boolean(item)).map(item=>({partyId:item.id,name:item.name,email:item.email,role:"buyer",share:null}));
        for(const buyer of context.buyers){
          const interest=context.interests.find(item=>item.partyId===buyer.partyId);
          const type=command.type==="reservation"?"Rezervace":"Předrezervace";
          if(interest){interest.type=type;interest.result=command.type==="reservation"?"Přešel do rezervace":"Přešel do předrezervace";}
          else context.interests.unshift({date:new Date(command.recordedAt??Date.now()).toLocaleDateString("cs-CZ"),partyId:buyer.partyId,name:buyer.name,type,result:command.type==="reservation"?"Přešel do rezervace":"Přešel do předrezervace"});
        }
      }
      if(command.kind==="convert"&&context.hold){
        context.hold={...context.hold,type:"reservation",expiresAt:command.expiresAt??context.hold.expiresAt};
        context.stage="reservation";
        for(const buyer of context.buyers){const interest=context.interests.find(item=>item.partyId===buyer.partyId);if(interest){interest.type="Rezervace";interest.result="Přešel do rezervace";}}
      }
      if(command.kind==="cancel"){
        for(const buyer of context.buyers){const interest=context.interests.find(item=>item.partyId===buyer.partyId);if(interest)interest.result="Zrušeno";}
        context.hold=null;context.stage="interest";context.buyers=[];
      }
    }
    snapshot.unitContexts[unitKey]=context;
  }
}
export const clientRepository:ClientRepository=new ApiClientRepository();
