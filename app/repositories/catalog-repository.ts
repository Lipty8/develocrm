import type { AccessoryAssignmentRecord, CatalogAccessoryRecord, MembershipOption, ProjectRecord, ProjectStructureOption, UnitRecord } from "../crm-data";
import { projects as previewProjects, units as previewUnits } from "../crm-data";
import { recordPreviewActivity } from "./activity-repository";
import { clientUsesBrowserAdapter, responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";
import { projectConstructionLabel } from "../lib/project-construction";
import { projectCompletionLabel } from "../lib/project-completion";

export type CatalogSnapshot = { projects: ProjectRecord[]; units: UnitRecord[]; accessories:CatalogAccessoryRecord[]; memberships:MembershipOption[]; structures:ProjectStructureOption[]; source: "backend-api" | "preview-seed" };
export type ProjectUpdate={id:string;name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null};
export type ProjectCreate={name:string;code:string;slug:string;location?:string|null;address?:string|null;description?:string|null;constructionStatus:string;plannedHandoverFrom?:string|null;managerMembershipId?:string|null;projectCompany?:string|null;defaultCurrency:string;plannedUnitCount?:number|null;note?:string|null};
export type UnitUpdate={id:string;structureId?:string|null;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null};

export interface CatalogRepository {
  getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot>;
  createProject(input:ProjectCreate):Promise<{id:string}>;
  updateProject(input:ProjectUpdate): Promise<void>;
  recordProjectConstructionStatus(input:{projectId:string;statusCode:string;note:string}):Promise<void>;
  updateUnit(input:UnitUpdate): Promise<void>;
  assignAccessory(unitId:string, accessoryId:string): Promise<void>;
  removeAccessory(assignmentId:string): Promise<void>;
  createAccessory(input:{projectId:string;category:"parking"|"cellar"|"wallbox";code:string;areaM2?:number|null;amount:number;amountNet?:number|null;relatedAccessoryId?:string|null}):Promise<void>;
  updateAccessory(input:{accessoryId:string;code:string;areaM2?:number|null;amount:number;amountNet?:number|null;reason?:string}):Promise<void>;
  removeOrArchiveAccessory(accessory:CatalogAccessoryRecord,reason:string):Promise<{mode:"delete"|"archive"}>;
}

export class ApiCatalogRepository implements CatalogRepository {
  async getCatalog(signal?: AbortSignal): Promise<CatalogSnapshot> {
    const response = await apiFetch("/api/catalog", { signal, cache: "no-store" });
    if (!response.ok){const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};throw new Error(`${payload.error||"Katalog projektů se nepodařilo načíst"}${payload.correlationId?` · ID chyby ${payload.correlationId}`:""}`);}
    const snapshot=await response.json() as CatalogSnapshot;
    if(typeof window!=="undefined"&&clientUsesBrowserAdapter()) applyPreviewEdits(snapshot);
    return snapshot;
  }
  async createProject(input:ProjectCreate):Promise<{id:string}>{
    const response=await apiFetch("/api/catalog/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return response.json() as Promise<{id:string}>;
    if(response.status===503&&responseAllowsBrowserFallback(response)){
      const id=`preview-project-${crypto.randomUUID()}`;
      const manager=previewCatalogMeta.memberships.find(item=>item.id===input.managerMembershipId)?.name??"—";
      const record:ProjectRecord={backendId:id,name:input.name,sourceName:input.name,code:input.code,location:input.location??"",address:input.address,description:input.description,projectCompany:input.projectCompany,defaultCurrency:input.defaultCurrency,plannedUnitCount:input.plannedUnitCount,note:input.note,progress:0,units:0,available:0,preReserved:0,reserved:0,sold:0,handedOver:0,attention:0,color:"sage",stage:projectConstructionLabel(input.constructionStatus),stageCode:input.constructionStatus,lifecycleStatus:"preparation",revenue:"—",buildings:[],manager,managerMembershipId:input.managerMembershipId,plannedHandover:projectCompletionLabel(input.plannedHandoverFrom),plannedCompletionFrom:input.plannedHandoverFrom,plannedCompletionTo:null};
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
      plannedHandover:projectCompletionLabel(input.plannedHandoverFrom),
    });
  }
  async recordProjectConstructionStatus(input:{projectId:string;statusCode:string;note:string}){
    const preview=await requestJson(`/api/catalog/projects/${input.projectId}/construction-status`,"POST",input);
    if(preview) storeEdit("projects",input.projectId,{stage:projectConstructionLabel(input.statusCode),stageCode:input.statusCode});
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
  async createAccessory(input:{projectId:string;category:"parking"|"cellar"|"wallbox";code:string;areaM2?:number|null;amount:number;amountNet?:number|null;relatedAccessoryId?:string|null}){
    const preview=await requestJson(`/api/catalog/projects/${input.projectId}/accessories`,"POST",input);
    if(preview&&typeof window!=="undefined"){
      const project=previewProjects.find(item=>(item.backendId??item.code)===input.projectId||item.code===input.projectId);
      const rows=JSON.parse(localStorage.getItem("develocrm.new.accessories")||"[]") as CatalogAccessoryRecord[];
      const relation=rows.find(item=>item.id===input.relatedAccessoryId)?.code??previewCatalogMeta.accessories.find(item=>item.id===input.relatedAccessoryId)?.code;
      rows.push({id:`preview-accessory-${crypto.randomUUID()}`,code:input.code,type:input.category==="parking"?"Parkovací stání":input.category==="cellar"?"Sklep":"Wallbox",category:input.category,areaM2:input.areaM2??null,amount:input.amount,amountNet:input.amountNet??null,currency:"CZK",project:project?.name??"Preview projekt",projectBackendId:input.projectId,available:true,relation});
      localStorage.setItem("develocrm.new.accessories",JSON.stringify(rows));
    }
  }
  async updateAccessory(input:{accessoryId:string;code:string;areaM2?:number|null;amount:number;amountNet?:number|null;reason?:string}){
    const preview=await requestJson(`/api/catalog/accessories/${encodeURIComponent(input.accessoryId)}`,"PATCH",input);
    if(preview&&typeof window!=="undefined"){
      const edits=JSON.parse(localStorage.getItem("develocrm.accessory.edits")||"{}");
      edits[input.accessoryId]={...(edits[input.accessoryId]||{}),code:input.code,areaM2:input.areaM2??null,amount:input.amount,amountNet:input.amountNet??null};
      localStorage.setItem("develocrm.accessory.edits",JSON.stringify(edits));
    }
  }
  async removeOrArchiveAccessory(accessory:CatalogAccessoryRecord,reason:string){
    const response=await apiFetch(`/api/catalog/accessories/${encodeURIComponent(accessory.id)}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({reason})});
    if(response.ok)return((await response.json()) as {outcome:{mode:"delete"|"archive"}}).outcome;
    if(response.status===503&&responseAllowsBrowserFallback(response)&&typeof window!=="undefined"){
      const created=JSON.parse(localStorage.getItem("develocrm.new.accessories")||"[]") as CatalogAccessoryRecord[];
      const createdIndex=created.findIndex(item=>item.id===accessory.id);
      if(createdIndex>=0&&!(accessory.assignmentHistory?.length)){
        created.splice(createdIndex,1);localStorage.setItem("develocrm.new.accessories",JSON.stringify(created));return{mode:"delete"};
      }
      const archived=JSON.parse(localStorage.getItem("develocrm.archived.accessories")||"[]") as string[];
      if(!archived.includes(accessory.id))archived.push(accessory.id);
      localStorage.setItem("develocrm.archived.accessories",JSON.stringify(archived));return{mode:"archive"};
    }
    const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};
    throw new Error(`${payload.error||"Příslušenství se nepodařilo odstranit"}${payload.correlationId?` · ID chyby ${payload.correlationId}`:""}`);
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
  const accessoryEdits=JSON.parse(localStorage.getItem("develocrm.accessory.edits")||"{}");
  const archivedAccessories=new Set(JSON.parse(localStorage.getItem("develocrm.archived.accessories")||"[]") as string[]);
  const createdAccessories=JSON.parse(localStorage.getItem("develocrm.new.accessories")||"[]") as CatalogAccessoryRecord[];
  snapshot.accessories.push(...createdAccessories.filter(item=>!snapshot.accessories.some(existing=>existing.id===item.id)));
  snapshot.accessories=snapshot.accessories.map(item=>({...item,...(accessoryEdits[item.id]||{}),archived:item.archived||archivedAccessories.has(item.id),available:item.archived||archivedAccessories.has(item.id)?false:item.available}));
  const mutations=JSON.parse(localStorage.getItem("develocrm.accessory.assignments")||"[]") as Array<{unitId:string;accessoryId:string;action:string}>;
  for(const row of mutations){const accessory=snapshot.accessories.find(item=>item.id===row.accessoryId||item.assignmentId===row.accessoryId);if(!accessory||accessory.archived)continue;if(row.action==="assign"){accessory.available=false;const unit=snapshot.units.find(item=>(item.backendId??item.id)===row.unitId||item.id===row.unitId);if(unit){accessory.assignmentId=`preview-${accessory.id}`;accessory.assignedUnitId=unit.backendId??unit.id;accessory.assignedUnitCode=unit.id;accessory.assignedUnitStatus=unit.status;if(!unit.accessories?.some(item=>item.id===accessory.id))(unit.accessories??=[]).push({...accessory,assignmentId:accessory.assignmentId} as AccessoryAssignmentRecord);}}else{accessory.available=true;accessory.assignmentId=undefined;accessory.assignedUnitId=null;accessory.assignedUnitCode=null;accessory.assignedUnitStatus=null;accessory.assignedClient=null;for(const unit of snapshot.units)unit.accessories=unit.accessories?.filter(item=>item.assignmentId!==row.accessoryId);}}
  for(const unit of snapshot.units)unit.accessory=unit.accessories?.map(item=>`${item.type} ${item.code}${item.areaM2?` · ${item.areaM2} m²`:""}`).join(" · ")||unit.accessory;
}
function storeEdit(kind:"projects"|"units",id:string,value:unknown){if(typeof window==="undefined")return;const edits=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");edits[kind]??={};edits[kind][id]={...(edits[kind][id]||{}),...(value as object)};localStorage.setItem("develocrm.catalog.edits",JSON.stringify(edits));}
function previewAccessoryMutation(unitId:string,accessoryId:string,action:"assign"|"remove"){if(typeof window==="undefined")return;const rows=JSON.parse(localStorage.getItem("develocrm.accessory.assignments")||"[]");rows.push({unitId,accessoryId,action});localStorage.setItem("develocrm.accessory.assignments",JSON.stringify(rows));}
async function requestJson(url:string,method:string,body?:unknown):Promise<boolean>{const response=await apiFetch(url,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});if(response.ok)return false;if(response.status===503&&responseAllowsBrowserFallback(response))return true;const payload=await response.json().catch(()=>({})) as {error?:string;correlationId?:string};throw new Error(`${payload.error||"Změnu se nepodařilo uložit"}${payload.correlationId?` · ID chyby ${payload.correlationId}`:""}`);}
export const catalogRepository: CatalogRepository = new ApiCatalogRepository();

export const previewCatalogMeta={
  memberships:[{id:"d3000000-0000-4000-8000-000000000001",name:"Iva Novotná"},{id:"d3000000-0000-4000-8000-000000000002",name:"Martin Jelínek"},{id:"d3000000-0000-4000-8000-000000000003",name:"Pavel Sedlák"},{id:"d3000000-0000-4000-8000-000000000004",name:"Klára Bendová"}],
  structures:previewProjects.flatMap(project=>project.buildings.map((name,index)=>({id:`preview-${project.code}-${index}`,projectId:project.code,project:project.name,name,kind:"building"}))),
  accessories:previewUnits.flatMap(unit=>unit.accessory.split(" · ").filter(Boolean).map((part,index)=>{const code=part.match(/\b([A-Z]\d+)\b/)?.[1]??`${unit.id}-${index}`;const lower=part.toLowerCase();const category=lower.includes("parking")?"parking":lower.includes("wallbox")?"wallbox":lower.includes("garáž")?"garage":lower.includes("sklep")?"cellar":"other";const assignmentId=`preview-assignment-${unit.id}-${code}`;return {id:`preview-${unit.project}-${code}`,assignmentId,code,type:category==="parking"?"Parkovací stání":category==="cellar"?"Sklep":category==="wallbox"?"Wallbox":category==="garage"?"Garáž":"Příslušenství",category,areaM2:null,project:unit.project,available:false,assignedUnitId:unit.backendId??unit.id,assignedUnitCode:unit.id,assignedUnitStatus:unit.status,assignedClient:unit.client??null,assignmentHistory:[{assignmentId,unitId:unit.backendId??unit.id,unitCode:unit.id,validFrom:"2026-01-01T00:00:00.000Z",validTo:null,assignedBy:"Preview import"}]} as CatalogAccessoryRecord;}))
};
