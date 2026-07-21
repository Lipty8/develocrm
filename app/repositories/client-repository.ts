import type { ClientRecord, UnitCommercialContext } from "../crm-data";

export type ClientSnapshot = { clients: ClientRecord[]; unitContexts: Record<string,UnitCommercialContext>; source:"backend-api"|"preview-seed" };
export interface ClientRepository {
  getDirectory(signal?:AbortSignal):Promise<ClientSnapshot>;
  exportContacts(partyIds:string[],format:"bcc"|"csv"):Promise<{value:string;count:number}>;
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
}
export const clientRepository:ClientRepository=new ApiClientRepository();
