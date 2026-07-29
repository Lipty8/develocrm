import type { AccessoryAssignmentRecord, CatalogAccessoryRecord, MembershipOption, ProjectRecord, ProjectStructureOption, UnitRecord } from "../crm-data";
import { projects as previewProjects, units as previewUnits } from "../crm-data";
import { recordPreviewActivity } from "./activity-repository";
import { responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";

export type CatalogSnapshot = { projects: ProjectRecord[]; units: UnitRecord[]; accessories:CatalogAccessoryRecord[]; memberships:MembershipOption[]; structures:ProjectStructureOption[]; source: "backend-api" | "preview-seed" };
export type ProjectUpdate={id:string;name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null};
export type ProjectCreate={name:string;code:string;slug:string;location?:string|null;address?:string|null;description?:string|null;constructionStatus:string;plannedHandoverFrom?:string|null;managerMembershipId?:string|null;projectCompany?:string|null;defaultCurrency:string;plannedUnitCount?:number|null;note?:string|null};
export type UnitUpdate={id:string;structureId?:string|null;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null};

export interface CatalogRepository {
  getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot>;
  createProject(input:ProjectCreate):Promise<{id:string}>;
  updateProject(input:ProjectUpdate): Promise<void>;
  recordProjectConstructionStatus(input:{projectId:string;statusCode:string;effectiveAt:string;note:string}):Promise<void>;
  updateUnit(input:UnitUpdate): Promise<void>;
  assignAccessory(unitId:string, accessoryId:string): Promise<void>;
  removeAccessory(assignmentId:string): Promise<void>;
}

export class ApiCatalogRepository implements CatalogRepository {
  async getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot> {
    const response = await apiFetch("/api/catalog", { signal, cache: "no-store" });
    if (!response.ok){const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};throw new Error(`${payload.error||"Katalog projektů se nepodařilo načíst"}${payload.correlationId?` · ID chyby ${payload.correlationId}`:""}`);}
    const snapshot=await response.json() as CatalogSnapshot;
    if(typeof window!=="undefined") applyPreviewEdits(snapshot);
    return snapshot;
  }
  async createProject(input:ProjectCreate):Promise<{id:string}>{
    const response=await apiFetch("/api/catalog/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return response.json() as Promise<{id:string}>;
    if(response.status===503&&responseAllowsBrowserFallback(response)){
      const id=`preview-project-${crypto.randomUUID()}`;
      const manager=previewCatalogMeta.memberships.find(item=>item.id===input.managerMembershipId)?.name??"—";
      const record:ProjectRecord={backendId:id,name:input.name,sourceName:input.name,code:input.code,location:input.location??"",address:input.address,description:input.description,projectCompany:input.projectCompany,defaultCurrency:input.defaultCurrency,plannedUnitCount:input.plannedUnitCount,note:input.note,progress:0,units:0,available:0,preReserved:0,reserved:0,sold:0,handedOver:0,attention:0,color:"sage",stage:constructionLabel(input.constructionStatus),lifecycleStatus:"preparation",revenue:"—",buildings:[],manager,managerMembershipId:input.managerMembershipId,plannedHandover:completionPeriodLabel(input.plannedHandoverFrom),plannedCompletionFrom:input.plannedHandoverFrom,plannedCompletionTo:null};
      const rows=JSON.parse(localStorage.getItem("develocrm.new.projects")||"[]") as ProjectRecord[];
      rows.push(record);
      localStorage.setItem("develocrm.new.projects",JSON.stringify(rows));
      return{id};
    }
    const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};
    throw new Error(`${payload.error||"Projekt se nepodařilo založit"}${payload.correlationId?` · ID chyby ${payload.correlationId}`:""}`);
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
  const projectNames=new Map<string,string>();
  for(const project of snapshot.projects){
    const projectEdit={...(edits.projects?.[project.backendId??project.code]||{}),...(edits.projects?.[project.code]||{})};
    if(typeof projectEdit.name==="string"&&projectEdit.name!==project.name)projectNames.set(project.name,projectEdit.name);
  }
  snapshot.projects=snapshot.projects.map(p=>({...p,sourceName:p.sourceName??p.name,...(edits.projects?.[p.backendId??p.code]||{}),...(edits.projects?.[p.code]||{})}));
  const created=JSON.parse(localStorage.getItem("develocrm.new.projects")||"[]") as ProjectRecord[];
  snapshot.projects.push(...created.filter(item=>!snapshot.projects.some(project=>(project.backendId??project.code)===(item.backendId??item.code))));
  snapshot.units=snapshot.units.map(u=>({...u,project:projectNames.get(u.project)??u.project,...(edits.units?.[u.backendId??u.id]||{}),...(edits.units?.[u.id]||{})}));
  snapshot.structures=snapshot.structures.map(item=>({...item,project:projectNames.get(item.project)??item.project}));
  snapshot.accessories=snapshot.accessories.map(item=>({...item,project:projectNames.get(item.project)??item.project}));
  const mutations=JSON.parse(localStorage.getItem("develocrm.accessory.assignments")||"[]") as Array<{unitId:string;accessoryId:string;action:string}>;
  for(const row of mutations){const accessory=snapshot.accessories.find(item=>item.id===row.accessoryId||item.assignmentId===row.accessoryId);if(!accessory)continue;if(row.action==="assign"){accessory.available=false;const unit=snapshot.units.find(item=>(item.backendId??item.id)===row.unitId||item.id===row.unitId);if(unit&&!unit.accessories?.some(item=>item.id===accessory.id))(unit.accessories??=[]).push({...accessory,assignmentId:`preview-${accessory.id}`} as AccessoryAssignmentRecord);}else{accessory.available=true;for(const unit of snapshot.units)unit.accessories=unit.accessories?.filter(item=>item.assignmentId!==row.accessoryId);}}
  for(const unit of snapshot.units)unit.accessory=unit.accessories?.map(item=>`${item.type} ${item.code}${item.areaM2?` · ${item.areaM2} m²`:""}`).join(" · ")||unit.accessory;
}
function storeEdit(kind:"projects"|"units",id:string,value:unknown){if(typeof window==="undefined")return;const edits=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");edits[kind]??={};edits[kind][id]={...(edits[kind][id]||{}),...(value as object)};localStorage.setItem("develocrm.catalog.edits",JSON.stringify(edits));}
function previewAccessoryMutation(unitId:string,accessoryId:string,action:"assign"|"remove"){if(typeof window==="undefined")return;const rows=JSON.parse(localStorage.getItem("develocrm.accessory.assignments")||"[]");rows.push({unitId,accessoryId,action});localStorage.setItem("develocrm.accessory.assignments",JSON.stringify(rows));}
async function requestJson(url:string,method:string,body?:unknown):Promise<boolean>{const response=await apiFetch(url,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});if(response.ok)return false;if(response.status===503&&responseAllowsBrowserFallback(response))return true;const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};throw new Error(`${payload.error||"Změnu se nepodařilo uložit"}${payload.correlationId?` · ID chyby ${payload.correlationId}`:""}`);}
function constructionLabel(status:string){return ({preparation:"Příprava",permitting:"Povolování",construction:"Ve výstavbě",rough_construction:"Hrubá stavba",installations:"Instalace",fit_out:"Dokončovací práce",completed:"Dokončeno"} as Record<string,string>)[status]??status;}
function completionPeriodLabel(value?:string|null){if(!value)return "Neplánováno";const date=new Date(`${value}T00:00:00`);if(Number.isNaN(date.getTime()))return value;return `Q${Math.floor(date.getMonth()/3)+1} ${date.getFullYear()}`;}

export const catalogRepository: CatalogRepository = new ApiCatalogRepository();

export const previewCatalogMeta={
  memberships:[{id:"d3000000-0000-4000-8000-000000000001",name:"Iva Novotná"},{id:"d3000000-0000-4000-8000-000000000002",name:"Martin Jelínek"},{id:"d3000000-0000-4000-8000-000000000003",name:"Pavel Sedlák"},{id:"d3000000-0000-4000-8000-000000000004",name:"Klára Bendová"}],
  structures:previewProjects.flatMap(project=>project.buildings.map((name,index)=>({id:`preview-${project.code}-${index}`,projectId:project.code,project:project.name,name,kind:"building"}))),
  accessories:previewUnits.flatMap(unit=>unit.accessory.split(" · ").filter(Boolean).map((part,index)=>{const code=part.match(/\b([A-Z]\d+)\b/)?.[1]??`${unit.id}-${index}`;const lower=part.toLowerCase();const category=lower.includes("parking")?"parking":lower.includes("wallbox")?"wallbox":lower.includes("garáž")?"garage":lower.includes("sklep")?"cellar":"other";return {id:`preview-${unit.project}-${code}`,assignmentId:`preview-assignment-${unit.id}-${code}`,code,type:category==="parking"?"Parkovací stání":category==="cellar"?"Sklep":category==="wallbox"?"Wallbox":category==="garage"?"Garáž":"Příslušenství",category,areaM2:null,project:unit.project,available:false} as CatalogAccessoryRecord;}))
};
