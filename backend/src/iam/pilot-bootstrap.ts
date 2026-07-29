import { createHash } from "node:crypto";
import type { Database, SqlClient } from "../database.js";
import { defaultPermissionCodes, defaultRoles } from "./provisioning.js";

export type PilotBootstrapInput={
  entraTenantId:string;
  adminOid:string;
  adminEmail:string;
  adminName:string;
  workspaceName:string;
  workspaceSlug?:string;
  workspaceId?:string;
};

export type PilotBootstrapResult={
  tenantId:string;
  userId:string;
  membershipId:string;
  adminRoleId:string;
  created:boolean;
};

export class PilotBootstrapService{
  constructor(private readonly database:Database){}
  async bootstrap(input:PilotBootstrapInput):Promise<PilotBootstrapResult>{
    const normalized=normalizeBootstrapInput(input);
    const ids=bootstrapIds(normalized);
    return this.database.withContext({
      tenantId:ids.tenantId,userId:ids.userId,
      identityIssuer:normalized.issuer,identitySubject:normalized.adminOid,
    },client=>bootstrapPilotWorkspace(client,{...normalized,...ids}));
  }
}

type NormalizedInput=PilotBootstrapInput&{workspaceSlug:string;issuer:string};
type BootstrapWithIds=NormalizedInput&{tenantId:string;userId:string;membershipId:string;roleAssignmentId:string};

export async function bootstrapPilotWorkspace(client:SqlClient,input:BootstrapWithIds):Promise<PilotBootstrapResult>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`develocrm:pilot-bootstrap:${input.tenantId}`]);
  const existed=(await client.query("SELECT 1 FROM tenants WHERE id=$1",[input.tenantId])).rows.length>0;
  await client.query(`INSERT INTO users(id,entra_issuer,entra_subject,email,display_name,status,last_login_at)
    VALUES($1,$2,$3,$4,$5,'active',NULL)
    ON CONFLICT(id) DO UPDATE SET entra_issuer=EXCLUDED.entra_issuer,entra_subject=EXCLUDED.entra_subject,
      email=EXCLUDED.email,display_name=CASE WHEN users.profile_name_overridden THEN users.display_name ELSE EXCLUDED.display_name END,
      status='active',archived_at=NULL`,[input.userId,input.issuer,input.adminOid,input.adminEmail,input.adminName]);
  await client.query(`INSERT INTO tenants(id,name,slug,status)
    VALUES($1,$2,$3,'active')
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug,status='active',archived_at=NULL`,
    [input.tenantId,input.workspaceName,input.workspaceSlug]);
  await client.query(`INSERT INTO tenant_identity_providers(tenant_id,provider,entra_tenant_id,issuer,status,is_primary)
    VALUES($1,'entra',$2,$3,'active',true)
    ON CONFLICT(tenant_id,provider,entra_tenant_id) DO UPDATE SET issuer=EXCLUDED.issuer,status='active',is_primary=true`,
    [input.tenantId,input.entraTenantId,input.issuer]);
  await client.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status,invited_at,accepted_at)
    VALUES($1,$2,$3,'active',now(),now())
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET status='active',accepted_at=COALESCE(tenant_memberships.accepted_at,now()),archived_at=NULL`,
    [input.membershipId,input.tenantId,input.userId]);
  let adminRoleId="";
  for(const role of defaultRoles){
    const current=await client.query<{id:string}>(`INSERT INTO roles(id,tenant_id,code,name,is_system,status)
      VALUES($1,$2,$3,$4,true,'active')
      ON CONFLICT(tenant_id,(lower(code))) DO UPDATE SET name=EXCLUDED.name,status='active',archived_at=NULL
      RETURNING id`,[deterministicUuid(`role:${input.tenantId}:${role.code}`),input.tenantId,role.code,role.name]);
    const roleId=current.rows[0].id;
    if(role.code==="admin")adminRoleId=roleId;
    await client.query(`INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
      SELECT $1,$2,permission.id,'workspace' FROM permissions permission WHERE permission.code=ANY($3::text[])
      ON CONFLICT(tenant_id,role_id,permission_id) DO UPDATE SET scope='workspace'`,
      [input.tenantId,roleId,defaultPermissionCodes[role.code]]);
  }
  if(!adminRoleId)throw new Error("Administrátorská role nebyla vytvořena");
  await client.query(`INSERT INTO role_assignments(id,tenant_id,membership_id,role_id,assigned_by_user_id)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(tenant_id,membership_id,role_id) DO NOTHING`,
    [input.roleAssignmentId,input.tenantId,input.membershipId,adminRoleId,input.userId]);
  const audited=await client.query("SELECT 1 FROM audit_log WHERE tenant_id=$1 AND action='tenant.pilot_bootstrapped' AND entity_id=$1",[input.tenantId]);
  if(!audited.rows.length){
    await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
      VALUES($1,$2,'tenant.pilot_bootstrapped','tenant',$1,jsonb_build_object('workspaceName',$3::text,'entraTenantId',$4::text,'adminOid',$5::text))`,
      [input.tenantId,input.userId,input.workspaceName,input.entraTenantId,input.adminOid]);
    await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES($1,'tenant',$1,'tenant.pilot_bootstrapped.v1',jsonb_build_object('tenantId',to_jsonb($1::uuid),'adminUserId',to_jsonb($2::uuid)))`,
      [input.tenantId,input.userId]);
  }
  return{tenantId:input.tenantId,userId:input.userId,membershipId:input.membershipId,adminRoleId,created:!existed};
}

export function normalizeBootstrapInput(input:PilotBootstrapInput):NormalizedInput{
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!uuid.test(input.entraTenantId))throw new Error("Neplatný Entra tenant ID");
  if(!uuid.test(input.adminOid))throw new Error("Neplatný oid prvního administrátora");
  if(input.workspaceId&&!uuid.test(input.workspaceId))throw new Error("Neplatný workspace UUID");
  if(!input.adminEmail.includes("@"))throw new Error("Neplatný pracovní e-mail");
  if(input.adminName.trim().length<2)throw new Error("Jméno administrátora je povinné");
  if(input.workspaceName.trim().length<2)throw new Error("Název workspace je povinný");
  const workspaceSlug=input.workspaceSlug?.trim().toLowerCase()||slugify(input.workspaceName);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspaceSlug))throw new Error("Neplatný slug workspace");
  const entraTenantId=input.entraTenantId.toLowerCase();
  return{...input,entraTenantId,adminOid:input.adminOid.toLowerCase(),adminEmail:input.adminEmail.trim().toLowerCase(),
    adminName:input.adminName.trim(),workspaceName:input.workspaceName.trim(),workspaceSlug,
    issuer:`https://login.microsoftonline.com/${entraTenantId}/v2.0`};
}

export function bootstrapIds(input:NormalizedInput){
  const tenantId=input.workspaceId?.toLowerCase()??deterministicUuid(`tenant:${input.entraTenantId}:${input.workspaceSlug}`);
  const userId=deterministicUuid(`user:${input.entraTenantId}:${input.adminOid}`);
  const membershipId=deterministicUuid(`membership:${tenantId}:${userId}`);
  return{tenantId,userId,membershipId,roleAssignmentId:deterministicUuid(`assignment:${tenantId}:${membershipId}:admin`)};
}

function deterministicUuid(value:string):string{
  const bytes=createHash("sha256").update(value).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString("hex");
  return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function slugify(value:string):string{return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||`workspace-${createHash("sha256").update(value).digest("hex").slice(0,8)}`;}
