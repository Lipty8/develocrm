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
    return response.json() as Promise<ClientSnapshot>;
  }
  async exportContacts(partyIds:string[],format:"bcc"|"csv"):Promise<{value:string;count:number}> {
    const response=await fetch("/api/clients/export",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({partyIds,format})});
    if(!response.ok)throw new Error("Export není povolen");
    return response.json() as Promise<{value:string;count:number}>;
  }
  async updateParty(input:{id:string;displayName:string}){await mutate(`/api/clients/${input.id}`,"PATCH",{displayName:input.displayName});}
  async upsertContact(input:{partyId:string;contactType:string;value:string;label?:string;isPrimary?:boolean}){await mutate(`/api/clients/${input.partyId}/contacts`,"POST",input);}
}
async function mutate(url:string,method:string,body:unknown){const response=await fetch(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!response.ok)throw new Error("Změnu klienta se nepodařilo uložit");}
export const clientRepository:ClientRepository=new ApiClientRepository();
