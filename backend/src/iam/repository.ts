import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import type { EntraIdentity } from "../auth/entra.js";
import type { Session, UserIdentity, WorkspaceMembership } from "./types.js";
import type { PoolClient } from "pg";
import { roleDisplayName } from "../shared/role-catalog.js";

type UserRow = { id: string; email: string; display_name: string; job_title?:string|null;work_phone?:string|null;profile_initials?:string|null;avatar_url?:string|null;preferred_language?:string;profile_timezone?:string;notification_settings?:{email:boolean;inApp:boolean};profile_name_overridden?:boolean };
export type ProjectAccessArea="project"|"units"|"clients"|"contracts"|"payments"|"documents"|"client_changes"|"handovers"|"complaints"|"tasks";
export type ProjectAccessInput={projectId:string;areaAccess:Partial<Record<ProjectAccessArea,"read"|"edit">>;advancedPermissions:string[]};
type MemberAccessInput={workspaceRoleIds:string[];projectAccess:ProjectAccessInput[]};

const projectAreas:ProjectAccessArea[]=["project","units","clients","contracts","payments","documents","client_changes","handovers","complaints","tasks"];
const allowedAdvancedPermissions=new Set([
  "projects.change_manager","projects.change_status","exports.run","audit.read",
  "holds.confirm","prices.approve","discounts.approve","commercial_exceptions.approve",
  "clients.archive","clients.read_own","contracts.mark_ready","contracts.record_signature",
  "documents.review","documents.archive","payments.reverse","payments.import","payments.export",
]);
const implicitEditOverrides:Partial<Record<ProjectAccessArea,string[]>>={
  payments:["payments.manage"],
  documents:["documents.manage"],
};
const implicitEditPermissionSet=new Set(Object.values(implicitEditOverrides).flat());

export class ExistingMembershipError extends Error {
  constructor(readonly membershipId:string) {
    super("Tento uživatel už má přístup do DeveloCRM");
    this.name="ExistingMembershipError";
  }
}

export class IamRepository {
  constructor(private readonly database: Database) {}

  async resolveUser(identity: EntraIdentity): Promise<UserIdentity> {
    const identityContext = { identityIssuer: identity.issuer, identitySubject: identity.subject };
    const found = await this.database.withContext(identityContext, async (client) => {
      const result = await client.query<UserRow>(
        "SELECT id,email,display_name,job_title,work_phone,profile_initials,avatar_url,preferred_language,profile_timezone,notification_settings,profile_name_overridden FROM users WHERE entra_issuer = $1 AND entra_subject = $2",
        [identity.issuer, identity.subject],
      );
      return result.rows[0];
    });
    if (found) {
      await this.database.withContext({ ...identityContext, userId: found.id }, (client) => client.query(
        "UPDATE users SET email=$1,display_name=CASE WHEN profile_name_overridden THEN display_name ELSE $2 END,last_login_at=now() WHERE id=$3",
        [identity.email, identity.displayName, found.id],
      ));
      return this.mapUser(found,{email:identity.email,displayName:found.profile_name_overridden?found.display_name:identity.displayName});
    }

    throw new Error("Uživatel nemá přístup do DeveloCRM");
  }

  private mapUser(row:UserRow,override?:{email:string;displayName:string}):UserIdentity{return{id:row.id,email:override?.email??row.email,displayName:override?.displayName??row.display_name,jobTitle:row.job_title??"",phone:row.work_phone??"",initials:row.profile_initials??undefined,avatarUrl:row.avatar_url??undefined,language:(row.preferred_language==="en"?"en":"cs"),timezone:row.profile_timezone??"Europe/Prague",notifications:row.notification_settings??{email:true,inApp:true}};}

  async updateOwnProfile(input:{tenantId:string;userId:string;membershipId:string;identityEmail:string;displayName:string;jobTitle:string;phone:string;initials:string;language:"cs"|"en";timezone:string;notifications:{email:boolean;inApp:boolean}}){
    if(input.displayName.trim().length<2||input.displayName.trim().length>160)throw new Error("Jméno musí mít 2–160 znaků");
    if(!/^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/.test(input.timezone))throw new Error("Neplatné časové pásmo");
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const before=(await client.query<{data:unknown}>("SELECT to_jsonb(user_account) data FROM users user_account JOIN tenant_memberships membership ON membership.user_id=user_account.id WHERE membership.tenant_id=$1::uuid AND membership.id=$2::uuid AND user_account.id=$3::uuid",[input.tenantId,input.membershipId,input.userId])).rows[0];
      if(!before)throw new Error("Aktivní profil nebyl nalezen");
      const result=await client.query<UserRow>(`UPDATE users SET email=$1::text,display_name=$2::text,job_title=$3::text,work_phone=$4::text,profile_initials=NULLIF($5::text,''),preferred_language=$6::text,profile_timezone=$7::text,notification_settings=$8::jsonb,profile_name_overridden=true
        WHERE id=$9::uuid RETURNING id,email,display_name,job_title,work_phone,profile_initials,avatar_url,preferred_language,profile_timezone,notification_settings`,[input.identityEmail.trim().toLowerCase(),input.displayName.trim(),input.jobTitle.trim()||null,input.phone.trim()||null,input.initials.trim().slice(0,4).toUpperCase(),input.language,input.timezone,JSON.stringify(input.notifications),input.userId]);
      await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1::uuid,$2::uuid,'profile.updated','user',$2::uuid,$3::jsonb,$4::jsonb)",[input.tenantId,input.userId,JSON.stringify(before.data),JSON.stringify({displayName:input.displayName,jobTitle:input.jobTitle,phone:input.phone,language:input.language,timezone:input.timezone,notifications:input.notifications})]);
      await client.query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1::uuid,'user',$2::uuid,'profile.updated.v1',jsonb_build_object('userId',$2::uuid))",[input.tenantId,input.userId]);
      return this.mapUser(result.rows[0]);
    });
  }

  async listWorkspaces(user: UserIdentity): Promise<WorkspaceMembership[]> {
    return this.database.withContext({ userId: user.id }, async (client) => {
      const result = await client.query<{ tenant_id: string; tenant_name: string; tenant_slug: string; membership_id: string }>(
        `SELECT t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.id AS membership_id
         FROM tenant_memberships m
         JOIN tenants t ON t.id = m.tenant_id
         WHERE m.user_id = $1 AND m.status = 'active' AND t.status = 'active'
         ORDER BY t.name`,
        [user.id],
      );
      return result.rows.map((row) => ({
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        tenantSlug: row.tenant_slug,
        membershipId: row.membership_id,
        roles: [],
        permissions: [],
      }));
    });
  }

  async getSession(user: UserIdentity, identity: EntraIdentity, tenantId: string): Promise<Session | null> {
    return this.database.withContext({ tenantId, userId: user.id }, async (client) => {
      const provider = await client.query(
        `SELECT 1 FROM tenant_identity_providers
         WHERE tenant_id = $1 AND entra_tenant_id = $2 AND issuer = $3 AND status = 'active'`,
        [tenantId, identity.entraTenantId, identity.issuer],
      );
      if (!provider.rowCount) return null;
      const result = await client.query<{
        membership_id: string; tenant_name: string; tenant_slug: string; roles: string[] | null; permissions: string[] | null;
      }>(
        `SELECT m.id AS membership_id, t.name AS tenant_name, t.slug AS tenant_slug,
                array_remove(array_agg(DISTINCT r.code), NULL) AS roles,
                array_remove(array_agg(DISTINCT p.code), NULL) AS permissions
         FROM tenant_memberships m
         JOIN tenants t ON t.id = m.tenant_id
         LEFT JOIN role_assignments ra ON ra.tenant_id = m.tenant_id AND ra.membership_id = m.id
         LEFT JOIN roles r ON r.tenant_id = ra.tenant_id AND r.id = ra.role_id AND r.status = 'active'
         LEFT JOIN role_permissions rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.scope='workspace'
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'active' AND t.status = 'active'
         GROUP BY m.id, t.name, t.slug`,
        [tenantId, user.id],
      );
      const row = result.rows[0];
      if (!row) return null;
      const scopes = await client.query<{ project_id:string;project_name:string;permissions:string[] }>(
        `SELECT project.id project_id,project.name project_name,
           COALESCE((SELECT array_agg(permission.code ORDER BY permission.code) FROM permissions permission WHERE app.has_project_permission(project.tenant_id,$2,project.id,permission.code)),ARRAY[]::text[]) permissions
         FROM projects project
         WHERE project.tenant_id=$1 AND project.archived_at IS NULL AND (
           EXISTS(SELECT 1 FROM project_custom_access access WHERE access.tenant_id=project.tenant_id AND access.project_id=project.id AND access.membership_id=$2)
         ) ORDER BY project.name`,[tenantId,row.membership_id],
      );
      return {
        user,
        workspace: {
          tenantId,
          tenantName: row.tenant_name,
          tenantSlug: row.tenant_slug,
          membershipId: row.membership_id,
          roles: row.roles ?? [],
          permissions: row.permissions ?? [],
          projectScopes: scopes.rows.map(scope=>({projectId:scope.project_id,projectName:scope.project_name,permissions:scope.permissions})),
        },
      };
    });
  }

  async adminSnapshot(input:{tenantId:string;userId:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const users=await client.query<{
        membership_id:string;user_id:string;name:string;email:string;job_title:string|null;work_phone:string|null;status:"invited"|"active"|"suspended"|"archived";last_login_at:string|null;role_ids:string[];project_ids:string[];entra_object_id:string|null;
      }>(`SELECT membership.id membership_id,user_account.id user_id,user_account.display_name name,user_account.email,
          user_account.job_title,user_account.work_phone,membership.status,user_account.last_login_at,
          CASE WHEN user_account.entra_issuer LIKE 'pending:%' THEN NULL ELSE user_account.entra_subject END entra_object_id,
          COALESCE((SELECT array_agg(DISTINCT assignment.role_id::text ORDER BY assignment.role_id::text)
            FROM role_assignments assignment WHERE assignment.tenant_id=membership.tenant_id AND assignment.membership_id=membership.id),ARRAY[]::text[]) role_ids,
          COALESCE((SELECT array_agg(DISTINCT access.project_id::text ORDER BY access.project_id::text)
            FROM project_custom_access access WHERE access.tenant_id=membership.tenant_id AND access.membership_id=membership.id),ARRAY[]::text[]) project_ids
         FROM tenant_memberships membership JOIN users user_account ON user_account.id=membership.user_id
         WHERE membership.tenant_id=$1 ORDER BY user_account.display_name,membership.id`,[input.tenantId]);
      const hasPermissionScope=Boolean((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='role_permissions' AND column_name='scope'")).rowCount);
      const roles=await client.query<{id:string;code:string;name:string;description:string|null;is_system:boolean;permission_codes:string[];permission_grants:Array<{code:string;scope:string}>;assigned_user_count:number}>(
        `SELECT role.id,role.code,role.name,role.description,role.is_system,
          COALESCE(array_agg(permission.code ORDER BY permission.code) FILTER(WHERE permission.code IS NOT NULL),ARRAY[]::text[]) permission_codes,
          COALESCE(jsonb_agg(jsonb_build_object('code',permission.code,'scope',${hasPermissionScope?"role_permission.scope":"'workspace'"}) ORDER BY permission.code) FILTER(WHERE permission.code IS NOT NULL),'[]'::jsonb) permission_grants,
          (SELECT count(DISTINCT assignment.membership_id)::int FROM (SELECT membership_id,role_id FROM role_assignments WHERE tenant_id=$1 UNION ALL SELECT membership_id,role_id FROM project_role_assignments WHERE tenant_id=$1) assignment WHERE assignment.role_id=role.id) assigned_user_count
         FROM roles role LEFT JOIN role_permissions role_permission ON role_permission.tenant_id=role.tenant_id AND role_permission.role_id=role.id
         LEFT JOIN permissions permission ON permission.id=role_permission.permission_id
         WHERE role.tenant_id=$1 AND role.status='active' GROUP BY role.id ORDER BY role.name`,[input.tenantId]);
      const projects=await client.query<{id:string;name:string}>("SELECT id,name FROM projects WHERE tenant_id=$1 AND lifecycle_status<>'archived' ORDER BY name",[input.tenantId]);
      const permissions=await client.query<{code:string;description:string}>("SELECT code,description FROM permissions ORDER BY code");
      const workspaceAssignments=await client.query<{membership_id:string;role_id:string}>(
        "SELECT membership_id,role_id FROM role_assignments WHERE tenant_id=$1 ORDER BY membership_id,role_id",[input.tenantId]);
      const customAssignments=await client.query<{membership_id:string;project_id:string;area:ProjectAccessArea;access_level:"none"|"read"|"edit";permission_overrides:string[]}>(
        "SELECT membership_id,project_id,area,access_level,permission_overrides FROM project_custom_access WHERE tenant_id=$1 ORDER BY membership_id,project_id,area",[input.tenantId]);
      const roleHistory=await client.query<{entity_id:string;occurred_at:string;actor:string|null}>(
        `SELECT audit.entity_id,audit.occurred_at,user_account.display_name actor
         FROM audit_log audit LEFT JOIN users user_account ON user_account.id=audit.actor_user_id
         WHERE audit.tenant_id=$1 AND audit.entity_type='role' AND audit.action='role.permissions_changed'
         ORDER BY audit.occurred_at DESC LIMIT 100`,[input.tenantId]);
      return {
        users:users.rows.map(row=>{
          const projectIds=[...new Set(customAssignments.rows.filter(item=>item.membership_id===row.membership_id).map(item=>item.project_id))];
          const projectAccess=projectIds.map(projectId=>{
            const custom=customAssignments.rows.filter(item=>item.membership_id===row.membership_id&&item.project_id===projectId);
            return {projectId,areaAccess:Object.fromEntries(custom.filter(item=>item.access_level!=="none").map(item=>[item.area,item.access_level])),advancedPermissions:[...new Set(custom.flatMap(item=>item.permission_overrides).filter(permission=>!implicitEditPermissionSet.has(permission)))].sort()};
          });
          return{membershipId:row.membership_id,userId:row.user_id,name:row.name,email:row.email,jobTitle:row.job_title??"",workPhone:row.work_phone??"",status:row.status,lastLoginAt:row.last_login_at,
            workspaceRoleIds:workspaceAssignments.rows.filter(item=>item.membership_id===row.membership_id).map(item=>item.role_id),projectAccess,entraObjectId:row.entra_object_id??undefined};
        }),
        roles:roles.rows.map(row=>({id:row.id,code:row.code,name:roleDisplayName(row.code,row.name),description:row.description??"",isSystem:row.is_system,permissionCodes:row.permission_codes,permissionGrants:row.permission_grants,assignedUserCount:row.assigned_user_count,restrictions:roleRestrictions(row.code),history:roleHistory.rows.filter(item=>item.entity_id===row.id).slice(0,5).map(item=>({occurredAt:item.occurred_at,actor:item.actor??"Systém"}))})),
        projects:projects.rows,
        permissions:permissions.rows,
      };
    });
  }

  async addMember(input:{tenantId:string;userId:string;membershipId:string;entraObjectId:string;name:string;email:string;jobTitle?:string;workPhone?:string}&MemberAccessInput) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        const permitted=await client.query("SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id AND role_permission.scope='workspace' JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code='users.manage'",[input.tenantId,input.membershipId]);
        if(!permitted.rowCount)throw new Error("users.manage permission required");
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.entraObjectId))throw new Error("Vybraný Microsoft účet nemá platnou identitu");
        if(!input.email.includes("@")||input.name.trim().length<1)throw new Error("Vybraný Microsoft účet nemá platné jméno nebo e-mail");
        if(!input.workspaceRoleIds.length&&!input.projectAccess.length)throw new Error("Nastavte alespoň jeden přístup");
        const provider=(await client.query<{issuer:string}>("SELECT issuer FROM tenant_identity_providers WHERE tenant_id=$1 AND status='active' AND is_primary=true LIMIT 1",[input.tenantId])).rows[0];
        if(!provider)throw new Error("Microsoft přihlášení pracovního prostoru není nakonfigurováno");
        const existing=await client.query<{id:string|null}>("SELECT app.find_entra_identity_for_onboarding($1,$2) id",[input.tenantId,input.entraObjectId]);
        const existingUserId=existing.rows[0]?.id??null;
        const invitedUserId=existingUserId??randomUUID();
        const duplicateMembership=await client.query<{id:string}>("SELECT id FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",[input.tenantId,invitedUserId]);
        if(duplicateMembership.rowCount)throw new ExistingMembershipError(duplicateMembership.rows[0].id);
        if(!existingUserId)await client.query(`INSERT INTO users(id,entra_issuer,entra_subject,email,display_name,status,job_title,work_phone)
          VALUES($1,$2,$3,$4,$5,'active',$6,$7)`,[invitedUserId,provider.issuer,input.entraObjectId,input.email.trim().toLowerCase(),input.name.trim(),input.jobTitle?.trim()||null,input.workPhone?.trim()||null]);
        const membershipId=randomUUID();
        await client.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,invited_at,accepted_at) VALUES($1,$2,$3,'active',now(),now())",[membershipId,input.tenantId,invitedUserId]);
        if(existingUserId)await client.query("UPDATE users SET email=$1,display_name=$2,status='active',archived_at=NULL,job_title=$3,work_phone=$4 WHERE id=$5",[input.email.trim().toLowerCase(),input.name.trim(),input.jobTitle?.trim()||null,input.workPhone?.trim()||null,invitedUserId]);
        await this.replaceAssignments(client,{...input,targetMembershipId:membershipId});
        await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'membership.created','tenant_membership',$3,$4::jsonb)`,[input.tenantId,input.userId,membershipId,JSON.stringify({workspaceRoleIds:input.workspaceRoleIds,projectAccess:input.projectAccess})]);
        await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'tenant_membership',$2,'membership.created.v1',$3::jsonb)`,[input.tenantId,membershipId,JSON.stringify({membershipId})]);
        return{membershipId};
    });
  }

  async updateMember(input:{tenantId:string;userId:string;membershipId:string;targetMembershipId:string;name:string;email:string;jobTitle?:string;workPhone?:string;status:string}&MemberAccessInput) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        const permitted=await client.query("SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id AND role_permission.scope='workspace' JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code='users.manage'",[input.tenantId,input.membershipId]);
        if(!permitted.rowCount)throw new Error("users.manage permission required");
        const before=(await client.query<{user_id:string;data:unknown;entra_issuer:string;email:string}>("SELECT membership.user_id,to_jsonb(membership) data,user_account.entra_issuer,user_account.email FROM tenant_memberships membership JOIN users user_account ON user_account.id=membership.user_id WHERE membership.tenant_id=$1 AND membership.id=$2 FOR UPDATE",[input.tenantId,input.targetMembershipId])).rows[0];
        if(!before)throw new Error("membership not found");
        if(input.targetMembershipId===input.membershipId&&input.status!=="active")throw new Error("Vlastní administrátorský přístup nelze deaktivovat");
        const adminRole=(await client.query<{id:string}>("SELECT id FROM roles WHERE tenant_id=$1 AND code='admin' AND status='active'",[input.tenantId])).rows[0];
        const targetIsAdmin=adminRole?Boolean((await client.query("SELECT 1 FROM role_assignments WHERE tenant_id=$1 AND membership_id=$2 AND role_id=$3",[input.tenantId,input.targetMembershipId,adminRole.id])).rowCount):false;
        const keepsTenantAdmin=Boolean(adminRole&&input.status==="active"&&input.workspaceRoleIds.includes(adminRole.id));
        if(targetIsAdmin&&!keepsTenantAdmin&&adminRole){
          const otherAdmins=await client.query(`SELECT 1 FROM role_assignments assignment
            JOIN tenant_memberships membership ON membership.tenant_id=assignment.tenant_id AND membership.id=assignment.membership_id
            WHERE assignment.tenant_id=$1 AND assignment.role_id=$2 AND assignment.membership_id<>$3 AND membership.status='active' LIMIT 1`,[input.tenantId,adminRole.id,input.targetMembershipId]);
          if(!otherAdmins.rowCount)throw new Error("Workspace musí mít alespoň jednoho aktivního administrátora");
        }
        const managedByEntra=!before.entra_issuer.startsWith("pending:");
        await client.query("UPDATE users SET display_name=$1,email=$2,job_title=$3,work_phone=$4 WHERE id=$5",[input.name,managedByEntra?before.email:input.email,input.jobTitle??null,input.workPhone??null,before.user_id]);
        await client.query("UPDATE tenant_memberships SET status=$1,accepted_at=CASE WHEN $1='active' THEN COALESCE(accepted_at,now()) ELSE accepted_at END,archived_at=CASE WHEN $1='archived' THEN now() ELSE NULL END WHERE tenant_id=$2 AND id=$3",[input.status,input.tenantId,input.targetMembershipId]);
        await this.replaceAssignments(client,{...input,targetMembershipId:input.targetMembershipId});
        await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'membership.updated','tenant_membership',$3,$4::jsonb,$5::jsonb)`,[input.tenantId,input.userId,input.targetMembershipId,JSON.stringify(before.data),JSON.stringify({status:input.status,workspaceRoleIds:input.workspaceRoleIds,projectAccess:input.projectAccess,name:input.name})]);
        await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'tenant_membership',$2,'membership.updated.v1',$3::jsonb)`,[input.tenantId,input.targetMembershipId,JSON.stringify({membershipId:input.targetMembershipId,status:input.status})]);
        return{membershipId:input.targetMembershipId};
    });
  }

  async setRolePermissions(input:{tenantId:string;userId:string;membershipId:string;roleId:string;permissionCodes:string[]}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        const permitted=await client.query("SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id AND role_permission.scope='workspace' JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code IN ('roles.manage','role.manage')",[input.tenantId,input.membershipId]);
        if(!permitted.rowCount)throw new Error("role.manage permission required");
        const role=(await client.query<{code:string}>("SELECT code FROM roles WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[input.tenantId,input.roleId])).rows[0];
        if(!role)throw new Error("Role nebyla nalezena");
        const codes=new Set(input.permissionCodes);
        const adminPermissions=new Set(["users.manage","roles.manage","role.manage","role.read","system.manage","integrations.manage","projects.create","audit.read"]);
        if(role.code==="admin"&&input.permissionCodes.some(code=>!adminPermissions.has(code)))throw new Error("Administrátor spravuje workspace, nikoli projektová business data");
        if(role.code==="admin"&&!["users.manage","roles.manage","system.manage","integrations.manage"].every(code=>codes.has(code)))throw new Error("Systémové pravomoci administrátora nelze odebrat");
        if(role.code==="executive"&&input.permissionCodes.some(code=>["users.manage","roles.manage","system.manage","integrations.manage"].includes(code)))throw new Error("Jednatel nesmí získat správu systému, uživatelů ani rolí");
        if(["admin","project_manager","back_office","finance","handover_complaints","sales","read_only"].includes(role.code)&&input.permissionCodes.includes("prices.approve"))throw new Error("Schvalování cen je oddělená pravomoc jednatele");
        if(role.code==="sales"&&input.permissionCodes.some(code=>["holds.confirm","prices.approve","discounts.approve","commercial_exceptions.approve","exports.run","clients.read_all"].includes(code)))throw new Error("Obchodník nesmí potvrzovat rezervace, schvalovat ceny, exportovat ani číst cizí klienty");
        if(role.code==="read_only"&&input.permissionCodes.some(code=>/(create|update|manage|approve|archive|cancel|confirm|propose|record|run)$/.test(code.split(".").at(-1)??"")))throw new Error("Role pouze pro čtení nesmí obsahovat mutace ani export");
        await client.query("DELETE FROM role_permissions WHERE tenant_id=$1 AND role_id=$2",[input.tenantId,input.roleId]);
        await client.query(`INSERT INTO role_permissions(tenant_id,role_id,permission_id,scope)
          SELECT $1,$2,id,CASE
            WHEN $4='admin' THEN 'workspace'
            WHEN $4='sales' AND code IN ('clients.read_own','clients.read_contact_details','clients.update','interests.manage','sales_cases.read','sales_cases.manage','holds.create','holds.cancel') THEN 'own'
            WHEN $4='sales' AND code='clients.create' THEN 'partner'
            ELSE 'project' END
          FROM permissions WHERE code=ANY($3::text[])`,[input.tenantId,input.roleId,input.permissionCodes,role.code]);
        await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'role.permissions_changed','role',$3,$4::jsonb)",[input.tenantId,input.userId,input.roleId,JSON.stringify({permissionCodes:input.permissionCodes})]);
        await client.query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'role',$2,'role.permissions_changed.v1',$3::jsonb)",[input.tenantId,input.roleId,JSON.stringify({roleId:input.roleId,permissionCodes:input.permissionCodes})]);
        return{roleId:input.roleId};
    });
  }

  private async replaceAssignments(client:PoolClient,input:{tenantId:string;userId:string;targetMembershipId:string}&MemberAccessInput) {
    const workspaceRoleIds=[...new Set(input.workspaceRoleIds)];
    const projectAccess=[...new Map(input.projectAccess.map(access=>[access.projectId,access])).values()];
    const allRoleIds=[...new Set(workspaceRoleIds)];
    if(allRoleIds.length){
      const validRoles=await client.query<{id:string;code:string}>("SELECT id,code FROM roles WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='active'",[input.tenantId,allRoleIds]);
      if(validRoles.rowCount!==allRoleIds.length)throw new Error("Některá zvolená role nepatří do aktuálního workspace");
      const workspaceCodes=new Set(validRoles.rows.filter(role=>workspaceRoleIds.includes(role.id)).map(role=>role.code));
      if([...workspaceCodes].some(code=>code!=="admin"))throw new Error("Globálně lze přiřadit pouze administrátorskou roli");
    }
    const projectIds=projectAccess.map(access=>access.projectId);
    if(projectIds.length){
      const validProjects=await client.query("SELECT id FROM projects WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND lifecycle_status<>'archived'",[input.tenantId,projectIds]);
      if(validProjects.rowCount!==projectIds.length)throw new Error("Některý zvolený projekt nepatří do aktuálního workspace");
    }
    const existingOverrides=await client.query<{project_id:string;permission:string}>(`SELECT access.project_id::text,permission
      FROM project_custom_access access CROSS JOIN LATERAL unnest(access.permission_overrides) permission
      WHERE access.tenant_id=$1 AND access.membership_id=$2`,[input.tenantId,input.targetMembershipId]);
    const preservedOverrides=new Set(existingOverrides.rows.map(row=>`${row.project_id}:${row.permission}`));
    for(const access of projectAccess){
      if(!Object.values(access.areaAccess).some(Boolean)&&!access.advancedPermissions.length)throw new Error("U projektu nastavte přístup alespoň k jedné oblasti");
      if(Object.entries(access.areaAccess).some(([area,level])=>!projectAreas.includes(area as ProjectAccessArea)||!["read","edit"].includes(String(level))))throw new Error("Projektový přístup obsahuje neplatnou oblast nebo úroveň");
      if(access.advancedPermissions.some(permission=>!allowedAdvancedPermissions.has(permission)&&!preservedOverrides.has(`${access.projectId}:${permission}`)))throw new Error("Projektový přístup obsahuje neplatné rozšířené oprávnění");
      if(access.advancedPermissions.some(permission=>!preservedOverrides.has(`${access.projectId}:${permission}`)&&access.areaAccess[advancedPermissionArea(permission)]!=="edit"))throw new Error("Citlivou operaci lze povolit pouze společně s právem upravovat danou oblast");
    }
    await client.query("DELETE FROM role_assignments WHERE tenant_id=$1 AND membership_id=$2",[input.tenantId,input.targetMembershipId]);
    if(workspaceRoleIds.length)await client.query(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id)
      SELECT $1,$2,role.id,$3 FROM roles role WHERE role.tenant_id=$1 AND role.id=ANY($4::uuid[])`,[input.tenantId,input.targetMembershipId,input.userId,workspaceRoleIds]);
    await client.query("DELETE FROM project_role_assignments WHERE tenant_id=$1 AND membership_id=$2",[input.tenantId,input.targetMembershipId]);
    await client.query("DELETE FROM project_custom_access WHERE tenant_id=$1 AND membership_id=$2",[input.tenantId,input.targetMembershipId]);
    for(const access of projectAccess){
      const advancedByArea=new Map<ProjectAccessArea,string[]>();
      for(const permission of access.advancedPermissions){const area=advancedPermissionArea(permission);advancedByArea.set(area,[...(advancedByArea.get(area)??[]),permission]);}
      for(const area of projectAreas){
        const level=access.areaAccess[area]??"none";const overrides=[...(advancedByArea.get(area)??[]),...(level==="edit"?(implicitEditOverrides[area]??[]):[])];
        if(level==="none"&&!overrides.length)continue;
        await client.query(`INSERT INTO project_custom_access(tenant_id,project_id,membership_id,area,access_level,permission_overrides,assigned_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.tenantId,access.projectId,input.targetMembershipId,area,level,overrides,input.userId]);
      }
    }
  }
}

function advancedPermissionArea(permission:string):ProjectAccessArea{
  if(permission.startsWith("project.")||permission.startsWith("projects.")||permission.startsWith("media.")||["exports.run","audit.read"].includes(permission))return"project";
  if(permission.startsWith("unit.")||permission.startsWith("units.")||permission.startsWith("accessory.")||permission.startsWith("accessories.")||permission.startsWith("price.")||permission.startsWith("prices.")||["holds.confirm","prices.approve","discounts.approve","commercial_exceptions.approve"].includes(permission))return"units";
  if(permission.startsWith("clients.")||permission.startsWith("interests.")||permission.startsWith("sales_case.")||permission.startsWith("sales_cases.")||["holds.create","holds.cancel"].includes(permission))return"clients";
  if(permission.startsWith("contract.")||permission.startsWith("contracts."))return"contracts";
  if(permission.startsWith("payments."))return"payments";
  if(permission.startsWith("documents."))return"documents";
  if(permission.startsWith("client_changes."))return"client_changes";
  if(permission.startsWith("handover.")||permission.startsWith("handovers."))return"handovers";
  if(permission.startsWith("complaints."))return"complaints";
  if(permission.startsWith("tasks."))return"tasks";
  return"project";
}

function roleRestrictions(code:string):string[]{
  if(code==="executive")return["Bez správy uživatelů, rolí, systému a integrací"];
  if(code==="admin")return["Pouze správa pracovního prostoru; projektový přístup se přiřazuje zvlášť"];
  if(code==="sales")return["Pouze vlastní klienti a jednání; bez exportu a potvrzení rezervace"];
  if(code==="read_only")return["Bez mutací a exportu"];
  return [];
}
