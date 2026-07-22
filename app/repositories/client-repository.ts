import type { ClientRecord, UnitCommercialContext } from "../crm-data";

export type ClientSnapshot = { clients: ClientRecord[]; unitContexts: Record<string,UnitCommercialContext>; source:"backend-api"|"preview-seed" };
export interface ClientRepository {
  getDirectory(signal?:AbortSignal):Promise<ClientSnapshot>;
  exportContacts(partyIds:string[],format:"bcc"|"csv"):Promise<{value:string;count:number}>;
  updateParty(input:{id:string;displayName:string}):Promise<void>;
  upsertContact(input:{partyId:string;contactType:string;value:string;label?:string;isPrimary?:boolean}):Promise<void>;
}
export class ApiClientRepository implements ClientRepository {
  async getDirectory(signal?:AbortSignal):Promise<ClientSnapshot> {
    const response=await fetch("/api/clients",{signal,cache:"no-store"});
    if(!response.ok)throw new Error("Klienty se nepodařilo načíst");
    const snapshot=await response.json() as ClientSnapshot;if(typeof window!=="undefined"){const edits=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");snapshot.clients=snapshot.clients.map(c=>({...c,...(edits[c.id]||{})}));}return snapshot;
  }
  async exportContacts(partyIds:string[],format:"bcc"|"csv"):Promise<{value:string;count:number}> {
    const response=await fetch("/api/clients/export",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({partyIds,format})});
    if(!response.ok)throw new Error("Export není povolen");
    return response.json() as Promise<{value:string;count:number}>;
  }
  async updateParty(input:{id:string;displayName:string}){try{await mutate(`/api/clients/${input.id}`,"PATCH",{displayName:input.displayName});}catch{if(typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");e[input.id]={...(e[input.id]||{}),name:input.displayName};localStorage.setItem("develocrm.client.edits",JSON.stringify(e));}}}
  async upsertContact(input:{partyId:string;contactType:string;value:string;label?:string;isPrimary?:boolean}){try{await mutate(`/api/clients/${input.partyId}/contacts`,"POST",input);}catch{if(typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.client.edits")||"{}");e[input.partyId]??={};if(input.contactType==="email")e[input.partyId].email=input.value;if(input.contactType==="phone")e[input.partyId].phone=input.value;localStorage.setItem("develocrm.client.edits",JSON.stringify(e));}}}
}
async function mutate(url:string,method:string,body:unknown){const response=await fetch(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!response.ok)throw new Error("Změnu klienta se nepodařilo uložit");}
export const clientRepository:ClientRepository=new ApiClientRepository();
