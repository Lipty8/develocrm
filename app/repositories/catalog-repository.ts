import type { AccessoryAssignmentRecord, CatalogAccessoryRecord, MembershipOption, ProjectRecord, ProjectStructureOption, UnitRecord } from "../crm-data";
import { projects as previewProjects, units as previewUnits } from "../crm-data";
import { recordPreviewActivity } from "./activity-repository";

export type CatalogSnapshot = { projects: ProjectRecord[]; units: UnitRecord[]; accessories:CatalogAccessoryRecord[]; memberships:MembershipOption[]; structures:ProjectStructureOption[]; source: "backend-api" | "preview-seed" };
export type ProjectUpdate={id:string;name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null};
export type UnitUpdate={id:string;structureId?:string|null;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null};

export interface CatalogRepository {
  getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot>;
  updateProject(input:ProjectUpdate): Promise<void>;
  recordProjectConstructionStatus(input:{projectId:string;statusCode:string;effectiveAt:string;note:string}):Promise<void>;
  updateUnit(input:UnitUpdate): Promise<void>;
  assignAccessory(unitId:string, accessoryId:string): Promise<void>;
  removeAccessory(assignmentId:string): Promise<void>;
}

export class ApiCatalogRepository implements CatalogRepository {
  async getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot> {
    const response = await fetch("/api/catalog", { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Katalog projektů se nepodařilo načíst");
    const snapshot=await response.json() as CatalogSnapshot;
    if(typeof window!=="undefined") applyPreviewEdits(snapshot);
    return snapshot;
  }
  async updateProject(input:ProjectUpdate){
    const preview=await requestJson(`/api/catalog/projects/${input.id}`,"PATCH",input);
    if(preview) storeEdit("projects",input.id,{
      ...input,
      manager:previewCatalogMeta.memberships.find((item)=>item.id===input.managerMembershipId)?.name??"—",
      plannedCompletionFrom:input.plannedHandoverFrom??null,
      plannedCompletionTo:input.plannedHandoverTo??null,
      plannedHandover:completionPeriodLabel(input.plannedHandoverFrom),
    });
  }
  async recordProjectConstructionStatus(input:{projectId:string;statusCode:string;effectiveAt:string;note:string}){
    const preview=await requestJson(`/api/catalog/projects/${input.projectId}/construction-status`,"POST",input);
    if(preview) storeEdit("projects",input.projectId,{stage:constructionLabel(input.statusCode)});
  }
  async updateUnit(input:UnitUpdate){
    const preview=await requestJson(`/api/catalog/units/${input.id}`,"PATCH",input);
    if(preview){storeEdit("units",input.id,{...input,area:input.areaM2,floor:input.floorLabel,orientation:input.orientation,usableArea:input.usableAreaM2,balcony:input.balconyM2,terrace:input.terraceM2,garden:input.gardenM2});recordPreviewActivity({unitKey:input.id,title:"Upraveny základní údaje jednotky",detail:"Iva Novotná · změna uložena",action:"unit.updated"});}
  }
  async assignAccessory(unitId:string,accessoryId:string){
    const preview=await requestJson(`/api/catalog/units/${unitId}/accessories`,"POST",{accessoryId});
    if(preview){previewAccessoryMutation(unitId,accessoryId,"assign");recordPreviewActivity({unitKey:unitId,title:"Přiřazeno příslušenství",detail:"Iva Novotná · aktivní přiřazení",action:"accessory.assigned"});}
  }
  async removeAccessory(assignmentId:string){
    const preview=await requestJson(`/api/catalog/accessory-assignments/${assignmentId}`,"DELETE");
    if(preview) previewAccessoryMutation("",assignmentId,"remove");
  }
}

function applyPreviewEdits(snapshot:CatalogSnapshot){
  const edits=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");
  snapshot.projects=snapshot.projects.map(p=>({...p,...(edits.projects?.[p.backendId??p.code]||{}),...(edits.projects?.[p.code]||{})}));
  snapshot.units=snapshot.units.map(u=>({...u,...(edits.units?.[u.backendId??u.id]||{}),...(edits.units?.[u.id]||{})}));
  const mutations=JSON.parse(localStorage.getItem("develocrm.accessory.assignments")||"[]") as Array<{unitId:string;accessoryId:string;action:string}>;
  for(const row of mutations){const accessory=snapshot.accessories.find(item=>item.id===row.accessoryId||item.assignmentId===row.accessoryId);if(!accessory)continue;if(row.action==="assign"){accessory.available=false;const unit=snapshot.units.find(item=>(item.backendId??item.id)===row.unitId||item.id===row.unitId);if(unit&&!unit.accessories?.some(item=>item.id===accessory.id))(unit.accessories??=[]).push({...accessory,assignmentId:`preview-${accessory.id}`} as AccessoryAssignmentRecord);}else{accessory.available=true;for(const unit of snapshot.units)unit.accessories=unit.accessories?.filter(item=>item.assignmentId!==row.accessoryId);}}
  for(const unit of snapshot.units)unit.accessory=unit.accessories?.map(item=>`${item.type} ${item.code}${item.areaM2?` · ${item.areaM2} m²`:""}`).join(" · ")||unit.accessory;
}
function storeEdit(kind:"projects"|"units",id:string,value:unknown){if(typeof window==="undefined")return;const edits=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");edits[kind]??={};edits[kind][id]={...(edits[kind][id]||{}),...(value as object)};localStorage.setItem("develocrm.catalog.edits",JSON.stringify(edits));}
function previewAccessoryMutation(unitId:string,accessoryId:string,action:"assign"|"remove"){if(typeof window==="undefined")return;const rows=JSON.parse(localStorage.getItem("develocrm.accessory.assignments")||"[]");rows.push({unitId,accessoryId,action});localStorage.setItem("develocrm.accessory.assignments",JSON.stringify(rows));}
async function requestJson(url:string,method:string,body?:unknown):Promise<boolean>{const response=await fetch(url,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});if(response.ok)return false;if(response.status===503)return true;const payload=await response.json().catch(()=>({})) as {error?:string};throw new Error(payload.error||"Změnu se nepodařilo uložit");}
function constructionLabel(status:string){return ({preparation:"Příprava",permitting:"Povolování",construction:"Ve výstavbě",rough_construction:"Hrubá stavba",installations:"Instalace",fit_out:"Dokončovací práce",completed:"Dokončeno"} as Record<string,string>)[status]??status;}
function completionPeriodLabel(value?:string|null){if(!value)return "Neplánováno";const date=new Date(`${value}T00:00:00`);if(Number.isNaN(date.getTime()))return value;return `Q${Math.floor(date.getMonth()/3)+1} ${date.getFullYear()}`;}

export const catalogRepository: CatalogRepository = new ApiCatalogRepository();

export const previewCatalogMeta={
  memberships:[{id:"d3000000-0000-4000-8000-000000000001",name:"Iva Novotná"},{id:"d3000000-0000-4000-8000-000000000002",name:"Martin Jelínek"},{id:"d3000000-0000-4000-8000-000000000003",name:"Pavel Sedlák"},{id:"d3000000-0000-4000-8000-000000000004",name:"Klára Bendová"}],
  structures:previewProjects.flatMap(project=>project.buildings.map((name,index)=>({id:`preview-${project.code}-${index}`,projectId:project.code,project:project.name,name,kind:"building"}))),
  accessories:previewUnits.flatMap(unit=>unit.accessory.split(" · ").filter(Boolean).map((part,index)=>{const code=part.match(/\b([A-Z]\d+)\b/)?.[1]??`${unit.id}-${index}`;const lower=part.toLowerCase();const category=lower.includes("parking")?"parking":lower.includes("wallbox")?"wallbox":lower.includes("garáž")?"garage":lower.includes("sklep")?"cellar":"other";return {id:`preview-${unit.project}-${code}`,assignmentId:`preview-assignment-${unit.id}-${code}`,code,type:category==="parking"?"Parkovací stání":category==="cellar"?"Sklep":category==="wallbox"?"Wallbox":category==="garage"?"Garáž":"Příslušenství",category,areaM2:null,project:unit.project,available:false} as CatalogAccessoryRecord;}))
};
