import type { UnitRecord } from "../crm-data";
import { projects as previewProjects } from "../crm-data";

export type ProjectRecord = (typeof previewProjects)[number];
export type CatalogSnapshot = { projects: ProjectRecord[]; units: UnitRecord[]; source: "backend-api" | "preview-seed" };

export interface CatalogRepository {
  getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot>;
  updateProject(input: {id:string;name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null}): Promise<void>;
  updateUnit(input: {id:string;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null}): Promise<void>;
  assignAccessory(unitId:string, accessoryId:string): Promise<void>;
  removeAccessory(assignmentId:string): Promise<void>;
}

export class ApiCatalogRepository implements CatalogRepository {
  async getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot> {
    const response = await fetch("/api/catalog", { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Katalog projektů se nepodařilo načíst");
    const snapshot=await response.json() as CatalogSnapshot;
    if(typeof window!=="undefined"){const edits=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");snapshot.projects=snapshot.projects.map(p=>({...p,...(edits.projects?.[p.code]||{})}));snapshot.units=snapshot.units.map(u=>({...u,...(edits.units?.[u.code]||{})}));}
    return snapshot;
  }
  async updateProject(input: CatalogRepository["updateProject"] extends (input: infer I)=>Promise<void> ? I : never){try{await requestJson(`/api/catalog/projects/${input.id}`,"PATCH",input);}catch{if(typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");e.projects??={};e.projects[input.id]={...input};localStorage.setItem("develocrm.catalog.edits",JSON.stringify(e));}}}
  async updateUnit(input: CatalogRepository["updateUnit"] extends (input: infer I)=>Promise<void> ? I : never){try{await requestJson(`/api/catalog/units/${input.id}`,"PATCH",input);}catch{if(typeof window!=="undefined"){const e=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");e.units??={};e.units[input.id]={...input};localStorage.setItem("develocrm.catalog.edits",JSON.stringify(e));}}}
  async assignAccessory(unitId:string,accessoryId:string){await requestJson(`/api/catalog/units/${unitId}/accessories`,"POST",{accessoryId});}
  async removeAccessory(assignmentId:string){await requestJson(`/api/catalog/accessory-assignments/${assignmentId}`,"DELETE");}
}

async function requestJson(url:string,method:string,body?:unknown){const response=await fetch(url,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error("Změnu se nepodařilo uložit");}

export const catalogRepository: CatalogRepository = new ApiCatalogRepository();
