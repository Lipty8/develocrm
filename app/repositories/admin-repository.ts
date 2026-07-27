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
export type AdminRole = { id: string; code: string; name: string; description: string; isSystem: boolean; permissionCodes: string[] };
export type AdminProject = { id: string; name: string };
export type AdminSnapshot = { users: AdminUser[]; roles: AdminRole[]; projects: AdminProject[]; permissions: Array<{ code: string; description: string }> };

const KEY = "develocrm.admin.v31";
const previewRoles: AdminRole[] = [
  {id:"role-admin",code:"admin",name:"Administrátor",description:"Plný přístup k workspace",isSystem:true,permissionCodes:["view","create","edit","approve","archive","export"]},
  {id:"role-pm",code:"project_manager",name:"Projektový manažer",description:"Řízení přidělených projektů",isSystem:true,permissionCodes:["view","create","edit","approve","export"]},
  {id:"role-sales",code:"sales",name:"Obchodník",description:"Klienti, rezervace a smlouvy",isSystem:true,permissionCodes:["view","create","edit","export"]},
  {id:"role-bo",code:"back_office",name:"Back Office",description:"Administrativa smluv a dokumentů",isSystem:true,permissionCodes:["view","create","edit","approve","export"]},
  {id:"role-finance",code:"finance",name:"Finance",description:"Platby a finanční agenda",isSystem:true,permissionCodes:["view","edit","approve","export"]},
  {id:"role-handover",code:"handover_complaints",name:"Předání a reklamace",description:"Předání, vady a reklamace",isSystem:true,permissionCodes:["view","create","edit"]},
  {id:"role-read",code:"read_only",name:"Pouze pro čtení",description:"Čtení bez editace",isSystem:true,permissionCodes:["view"]},
];
const previewProjects=[{id:"DEJ",name:"Rezidence Dejvice"},{id:"RJ",name:"Rezidence Javorová"},{id:"PC",name:"Parková čtvrť"},{id:"VS",name:"Vily Stráň"}];
const defaultPreview:AdminSnapshot={users:[
  {membershipId:"prototype-iva-membership",userId:"prototype-iva",name:"Iva Novotná",email:"iva@develo.example",jobTitle:"Back Office",workPhone:"+420 222 000 101",status:"active",lastLoginAt:new Date().toISOString(),roleIds:["role-admin"],projectIds:[]},
  {membershipId:"prototype-martin-membership",userId:"prototype-martin",name:"Martin Jelínek",email:"martin@develo.example",jobTitle:"Vedoucí projektu",workPhone:"+420 222 000 102",status:"active",lastLoginAt:null,roleIds:["role-pm"],projectIds:["RJ","DEJ"]},
],roles:previewRoles,projects:previewProjects,permissions:[
  {code:"view",description:"Zobrazit"},{code:"create",description:"Vytvářet"},{code:"edit",description:"Upravovat"},{code:"approve",description:"Schvalovat"},{code:"archive",description:"Archivovat"},{code:"export",description:"Exportovat"},
]};

export interface AdminRepository {
  getSnapshot(signal?:AbortSignal):Promise<AdminSnapshot>;
  invite(input:Omit<AdminUser,"membershipId"|"userId"|"lastLoginAt">):Promise<void>;
  update(input:AdminUser):Promise<void>;
  setRolePermissions(roleId:string,permissionCodes:string[]):Promise<void>;
}

class ApiAdminRepository implements AdminRepository {
  async getSnapshot(signal?:AbortSignal){const response=await fetch("/api/identity/admin",{signal,cache:"no-store"});if(response.ok)return response.json() as Promise<AdminSnapshot>;if(response.status!==503)throw new Error((await response.json().catch(()=>({}))).error??"Správu uživatelů nelze načíst");return readPreview();}
  async invite(input:Omit<AdminUser,"membershipId"|"userId"|"lastLoginAt">){const response=await fetch("/api/identity/admin/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});if(response.ok)return;if(response.status!==503)throw new Error((await response.json().catch(()=>({}))).error??"Pozvánku nelze vytvořit");const snapshot=readPreview();snapshot.users.push({...input,membershipId:`preview-membership-${crypto.randomUUID()}`,userId:`preview-user-${crypto.randomUUID()}`,lastLoginAt:null});writePreview(snapshot);}
  async update(input:AdminUser){const response=await fetch(`/api/identity/admin/users/${input.membershipId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});if(response.ok)return;if(response.status!==503)throw new Error((await response.json().catch(()=>({}))).error??"Uživatele nelze upravit");const snapshot=readPreview();snapshot.users=snapshot.users.map(user=>user.membershipId===input.membershipId?input:user);writePreview(snapshot);}
  async setRolePermissions(roleId:string,permissionCodes:string[]){const response=await fetch(`/api/identity/admin/roles/${roleId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({permissionCodes})});if(response.ok)return;if(response.status!==503)throw new Error((await response.json().catch(()=>({}))).error??"Oprávnění role nelze upravit");const snapshot=readPreview();snapshot.roles=snapshot.roles.map(role=>role.id===roleId?{...role,permissionCodes}:role);writePreview(snapshot);}
}
function readPreview():AdminSnapshot{if(typeof window==="undefined")return structuredClone(defaultPreview);const stored=localStorage.getItem(KEY);return stored?JSON.parse(stored):structuredClone(defaultPreview);}
function writePreview(snapshot:AdminSnapshot){localStorage.setItem(KEY,JSON.stringify(snapshot));}
export const adminRepository:AdminRepository=new ApiAdminRepository();
