import { responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";

export type AdminUser = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  jobTitle: string;
  workPhone: string;
  status: "invited" | "active" | "suspended" | "archived";
  lastLoginAt: string | null;
  roleIds: string[];
  projectIds: string[];
};
export type AdminRole = { id: string; code: string; name: string; description: string; isSystem: boolean; permissionCodes: string[];permissionGrants?:Array<{code:string;scope:"workspace"|"project"|"own"|"partner"}>;assignedUserCount?:number;restrictions?:string[];history?:Array<{occurredAt:string;actor:string}> };
export type AdminProject = { id: string; name: string };
export type AdminSnapshot = { users: AdminUser[]; roles: AdminRole[]; projects: AdminProject[]; permissions: Array<{ code: string; description: string }> };

const KEY = "develocrm.admin.v32";
const operational=["projects.read","projects.update","units.read","units.update","units.update_sales_status","accessories.read","accessories.update","clients.read_all","clients.read_contact_details","clients.create","clients.update","interests.manage","sales_cases.read","sales_cases.manage","holds.create","holds.cancel","holds.confirm","contracts.read","contracts.create","contracts.update","contracts.mark_ready","contracts.record_signature","documents.read","documents.create","documents.update","documents.review","documents.archive","prices.read","prices.propose","payments.read","payments.manage","handovers.read","handovers.manage","complaints.read","complaints.manage","tasks.read","tasks.manage"];
const previewRoles: AdminRole[] = [
  {id:"role-executive",code:"executive",name:"Jednatel",description:"Obchodní dohled a schvalování",isSystem:true,permissionCodes:["projects.read","units.read","clients.read_all","contracts.read","documents.read","prices.read","prices.propose","prices.approve","discounts.approve","commercial_exceptions.approve","payments.read","exports.run"],assignedUserCount:1,restrictions:["Bez správy systému, uživatelů a rolí"]},
  {id:"role-admin",code:"admin",name:"Administrátor",description:"Provozní a systémová správa workspace",isSystem:true,permissionCodes:[...operational,"users.manage","roles.manage","system.manage","integrations.manage","exports.run","audit.read"],assignedUserCount:1,restrictions:["Bez schvalování cen, slev a obchodních výjimek"]},
  {id:"role-pm",code:"project_manager",name:"Projektový manažer",description:"Řízení přidělených projektů",isSystem:true,permissionCodes:operational.filter(code=>!code.includes("approve")&&!code.startsWith("payments.manage")),assignedUserCount:1,restrictions:["Projektový rozsah; bez schvalování cen a správy systému"]},
  {id:"role-sales",code:"sales",name:"Obchodník",description:"Vlastní klienti, zájmy a předrezervace",isSystem:true,permissionCodes:["projects.read","units.read","accessories.read","clients.read_own","clients.read_contact_details","clients.create","clients.update","interests.manage","sales_cases.read","sales_cases.manage","holds.create","holds.cancel"],assignedUserCount:2,restrictions:["Bez cizích kontaktů, exportu, rezervace a cen"]},
  {id:"role-bo",code:"back_office",name:"Back Office",description:"Formální připravenost smluv a dokumentů",isSystem:true,permissionCodes:["projects.read","units.read","clients.read_all","clients.read_contact_details","clients.create","clients.update","contracts.read","contracts.create","contracts.update","contracts.mark_ready","contracts.record_signature","documents.read","documents.create","documents.update","documents.review","tasks.read","tasks.manage"],assignedUserCount:2,restrictions:["Bez obchodního schvalování cen a výjimek"]},
  {id:"role-finance",code:"finance",name:"Finance",description:"Platby a finanční agenda",isSystem:true,permissionCodes:["projects.read","units.read","clients.read_all","contracts.read","documents.read","prices.read","payments.read","payments.manage","exports.run"],assignedUserCount:1},
  {id:"role-handover",code:"handover_complaints",name:"Předání a reklamace",description:"Předání, vady a reklamace",isSystem:true,permissionCodes:["projects.read","units.read","clients.read_all","clients.read_contact_details","handovers.read","handovers.manage","complaints.read","complaints.manage","tasks.read","tasks.manage"],assignedUserCount:1},
  {id:"role-read",code:"read_only",name:"Pouze pro čtení",description:"Projektové čtení bez mutací",isSystem:true,permissionCodes:["projects.read","units.read","accessories.read","clients.read_all","sales_cases.read","contracts.read","documents.read","prices.read","payments.read","handovers.read","tasks.read"],assignedUserCount:0,restrictions:["Bez mutací a exportu"]},
];
const previewProjects=[{id:"DEJ",name:"Rezidence Dejvice"}];
const defaultPreview:AdminSnapshot={users:[
  {membershipId:"prototype-iva-membership",userId:"prototype-iva",name:"Iva Novotná",email:"iva@develo.example",jobTitle:"Back Office",workPhone:"+420 222 000 101",status:"active",lastLoginAt:new Date().toISOString(),roleIds:["role-admin"],projectIds:[]},
  {membershipId:"prototype-martin-membership",userId:"prototype-martin",name:"Martin Jelínek",email:"martin@develo.example",jobTitle:"Vedoucí projektu",workPhone:"+420 222 000 102",status:"active",lastLoginAt:null,roleIds:["role-pm"],projectIds:["DEJ"]},
],roles:previewRoles,projects:previewProjects,permissions:Array.from(new Set(previewRoles.flatMap(role=>role.permissionCodes))).sort().map(code=>({code,description:getPermissionDefinition(code).description}))};

export interface AdminRepository {
  getSnapshot(signal?:AbortSignal):Promise<AdminSnapshot>;
  invite(input:Omit<AdminUser,"membershipId"|"userId"|"lastLoginAt">):Promise<void>;
  update(input:AdminUser):Promise<void>;
  setRolePermissions(roleId:string,permissionCodes:string[]):Promise<void>;
}

class ApiAdminRepository implements AdminRepository {
  async getSnapshot(signal?:AbortSignal){const response=await apiFetch("/api/identity/admin",{signal,cache:"no-store"});if(response.ok)return response.json() as Promise<AdminSnapshot>;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({}))).error??"Správu uživatelů nelze načíst");return readPreview();}
  async invite(input:Omit<AdminUser,"membershipId"|"userId"|"lastLoginAt">){const response=await apiFetch("/api/identity/admin/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});if(response.ok)return;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({}))).error??"Pozvánku nelze vytvořit");const snapshot=readPreview();snapshot.users.push({...input,membershipId:`preview-membership-${crypto.randomUUID()}`,userId:`preview-user-${crypto.randomUUID()}`,lastLoginAt:null});writePreview(snapshot);}
  async update(input:AdminUser){const response=await apiFetch(`/api/identity/admin/users/${input.membershipId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});if(response.ok)return;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({}))).error??"Uživatele nelze upravit");const snapshot=readPreview();snapshot.users=snapshot.users.map(user=>user.membershipId===input.membershipId?input:user);writePreview(snapshot);}
  async setRolePermissions(roleId:string,permissionCodes:string[]){const response=await apiFetch(`/api/identity/admin/roles/${roleId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({permissionCodes})});if(response.ok)return;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({}))).error??"Oprávnění role nelze upravit");const snapshot=readPreview();const role=snapshot.roles.find(item=>item.id===roleId);if(!role)throw new Error("Role nebyla nalezena");validateSystemRole(role.code,permissionCodes);snapshot.roles=snapshot.roles.map(item=>item.id===roleId?{...item,permissionCodes,history:[{occurredAt:new Date().toISOString(),actor:"Iva Novotná"},...(item.history??[]).slice(0,4)]}:item);writePreview(snapshot);}
}
function readPreview():AdminSnapshot{if(typeof window==="undefined")return structuredClone(defaultPreview);const stored=localStorage.getItem(KEY);return stored?JSON.parse(stored):structuredClone(defaultPreview);}
function writePreview(snapshot:AdminSnapshot){localStorage.setItem(KEY,JSON.stringify(snapshot));}
function validateSystemRole(role:string,codes:string[]){const selected=new Set(codes);if(role==="admin"&&!["users.manage","roles.manage","system.manage","integrations.manage"].every(code=>selected.has(code)))throw new Error("Systémové pravomoci administrátora nelze odebrat");if(role==="admin"&&codes.some(code=>["prices.approve","discounts.approve","commercial_exceptions.approve"].includes(code)))throw new Error("Administrátor nesmí schvalovat ceny ani obchodní výjimky");if(role==="executive"&&codes.some(code=>["users.manage","roles.manage","system.manage","integrations.manage"].includes(code)))throw new Error("Jednatel nesmí spravovat systém ani uživatele");if(role==="sales"&&codes.some(code=>["holds.confirm","prices.approve","exports.run","clients.read_all"].includes(code)))throw new Error("Obchodník nesmí potvrzovat rezervace, schvalovat ceny, exportovat ani číst cizí klienty");if(role==="read_only"&&codes.some(code=>/(create|update|manage|approve|archive|cancel|confirm|propose|record|run)$/.test(code.split(".").at(-1)??"")))throw new Error("Role pouze pro čtení nesmí obsahovat mutace ani export");}
export const adminRepository:AdminRepository=new ApiAdminRepository();
import { getPermissionDefinition } from "../lib/permission-catalog";
