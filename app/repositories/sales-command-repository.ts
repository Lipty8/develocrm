import { responseAllowsBrowserFallback } from "../lib/data-mode";

export interface SalesCommandRepository{
  addInterest(input:{unitId:string;unitKey?:string;partyId:string;eventType:string;note:string}):Promise<void>;
  createHold(input:{unitId:string;unitKey?:string;type:"pre_reservation"|"reservation";partyIds:string[];expiresAt:string;reason:string}):Promise<void>;
  convertHold(input:{holdId:string;unitKey?:string;expiresAt:string;reason:string}):Promise<void>;
  cancelHold(input:{holdId:string;unitKey?:string;reason:string}):Promise<void>;
}
class ApiSalesCommandRepository implements SalesCommandRepository{
 async addInterest(input:{unitId:string;unitKey?:string;partyId:string;eventType:string;note:string}){const {unitKey,...payload}=input;const preview=await mutate(`/api/sales/units/${input.unitId}/interests`,"POST",payload);if(preview)store(unitKey??input.unitId,{kind:"interest",...input});}
 async createHold(input:{unitId:string;unitKey?:string;type:"pre_reservation"|"reservation";partyIds:string[];expiresAt:string;reason:string}){const {unitKey,...payload}=input;const preview=await mutate(`/api/sales/units/${input.unitId}/holds`,"POST",{...payload,idempotencyKey:crypto.randomUUID()});if(preview){store(unitKey??input.unitId,{kind:"hold",id:`preview-${Date.now()}`,...input});patchPreviewUnit(unitKey??input.unitId,{status:input.type==="reservation"?"Rezervace":"Předrezervace"});}}
 async convertHold(input:{holdId:string;unitKey?:string;expiresAt:string;reason:string}){const {unitKey,...payload}=input;const preview=await mutate(`/api/sales/holds/${input.holdId}/convert`,"POST",{...payload,idempotencyKey:crypto.randomUUID()});if(preview){store(unitKey??input.holdId,{kind:"convert",...input});patchPreviewUnit(unitKey??input.holdId,{status:"Rezervace"});}}
 async cancelHold(input:{holdId:string;unitKey?:string;reason:string}){const {unitKey,...payload}=input;const preview=await mutate(`/api/sales/holds/${input.holdId}/cancel`,"POST",payload);if(preview){store(unitKey??input.holdId,{kind:"cancel",...input});patchPreviewUnit(unitKey??input.holdId,{status:"Volný"});}}
}
async function mutate(url:string,method:string,body:unknown){const response=await fetch(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(response.ok)return false;if(response.status===503&&responseAllowsBrowserFallback(response))return true;const payload=await response.json().catch(()=>({})) as {error?:string};throw new Error(payload.error||"Obchodní operaci se nepodařilo dokončit");}
function store(key:string,value:unknown){if(typeof window==="undefined")return;const command=value as {kind?:string;reason?:string};const rows=JSON.parse(localStorage.getItem("develocrm.sales.commands")||"{}");rows[key]??=[];rows[key].unshift({...value as object,recordedAt:new Date().toISOString()});localStorage.setItem("develocrm.sales.commands",JSON.stringify(rows));recordPreviewActivity({unitKey:key,title:command.kind==="interest"?"Zaznamenán nový zájem":command.kind==="cancel"?"Rezervace zrušena a jednotka uvolněna":command.kind==="convert"?"Předrezervace převedena na rezervaci":"Vytvořena rezervace jednotky",detail:`Iva Novotná · ${command.reason??"obchodní operace"}`,icon:"contract",action:`sales.${command.kind??"changed"}`});}
function patchPreviewUnit(id:string,value:object){if(typeof window==="undefined")return;const edits=JSON.parse(localStorage.getItem("develocrm.catalog.edits")||"{}");edits.units??={};edits.units[id]={...(edits.units[id]||{}),...value};localStorage.setItem("develocrm.catalog.edits",JSON.stringify(edits));}
export const salesCommandRepository:SalesCommandRepository=new ApiSalesCommandRepository();
import {recordPreviewActivity} from "./activity-repository";
