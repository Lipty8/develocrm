import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import type { EntraIdentity } from "../auth/entra.js";
import type { Session, UserIdentity, WorkspaceMembership } from "./types.js";
import type { PoolClient } from "pg";

type UserRow = { id: string; email: string; display_name: string; job_title?:string|null;work_phone?:string|null;profile_initials?:string|null;avatar_url?:string|null;preferred_language?:string;profile_timezone?:string;notification_settings?:{email:boolean;inApp:boolean};profile_name_overridden?:boolean };

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

    const id = randomUUID();
    const created = await this.database.withContext({ ...identityContext, userId: id }, async (client) => {
      const result = await client.query<UserRow>(
        `INSERT INTO users (id, entra_issuer, entra_subject, email, display_name, last_login_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, email, display_name`,
        [id, identity.issuer, identity.subject, identity.email, identity.displayName],
      );
      return result.rows[0];
    });
    return this.mapUser(created);
  }

  private mapUser(row:UserRow,override?:{email:string;displayName:string}):UserIdentity{return{id:row.id,email:override?.email??row.email,displayName:override?.displayName??row.display_name,jobTitle:row.job_title??"",phone:row.work_phone??"",initials:row.profile_initials??undefined,avatarUrl:row.avatar_url??undefined,language:(row.preferred_language==="en"?"en":"cs"),timezone:row.profile_timezone??"Europe/Prague",notifications:row.notification_settings??{email:true,inApp:true}};}

  async updateOwnProfile(input:{tenantId:string;userId:string;membershipId:string;displayName:string;jobTitle:string;phone:string;initials:string;language:"cs"|"en";timezone:string;notifications:{email:boolean;inApp:boolean}}){
    if(input.displayName.trim().length<2||input.displayName.trim().length>160)throw new Error("Jméno musí mít 2–160 znaků");
    if(!/^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/.test(input.timezone))throw new Error("Neplatné časové pásmo");
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const before=(await client.query<{data:unknown}>("SELECT to_jsonb(user_account) data FROM users user_account JOIN tenant_memberships membership ON membership.user_id=user_account.id WHERE membership.tenant_id=$1 AND membership.id=$2 AND user_account.id=$3",[input.tenantId,input.membershipId,input.userId])).rows[0];
      if(!before)throw new Error("Aktivní profil nebyl nalezen");
      const result=await client.query<UserRow>(`UPDATE users SET display_name=$1,job_title=$2,work_phone=$3,profile_initials=NULLIF($4,''),preferred_language=$5,profile_timezone=$6,notification_settings=$7::jsonb,profile_name_overridden=true
        WHERE id=$8 RETURNING id,email,display_name,job_title,work_phone,profile_initials,avatar_url,preferred_language,profile_timezone,notification_settings`,[input.displayName.trim(),input.jobTitle.trim()||null,input.phone.trim()||null,input.initials.trim().slice(0,4).toUpperCase(),input.language,input.timezone,JSON.stringify(input.notifications),input.userId]);
      await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'profile.updated','user',$2,$3::jsonb,to_jsonb($4::json))",[input.tenantId,input.userId,JSON.stringify(before.data),JSON.stringify({displayName:input.displayName,jobTitle:input.jobTitle,phone:input.phone,language:input.language,timezone:input.timezone,notifications:input.notifications})]);
      await client.query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'user',$2,'profile.updated.v1',jsonb_build_object('userId',$2))",[input.tenantId,input.userId]);
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
         LEFT JOIN role_permissions rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'active' AND t.status = 'active'
         GROUP BY m.id, t.name, t.slug`,
        [tenantId, user.id],
      );
      const row = result.rows[0];
      if (!row) return null;
      const scopes = await client.query<{ project_id:string;project_name:string;roles:string[] }>(
        `SELECT assignment.project_id, project.name project_name, array_agg(DISTINCT role.code ORDER BY role.code) roles
         FROM project_role_assignments assignment
         JOIN projects project ON project.tenant_id=assignment.tenant_id AND project.id=assignment.project_id
         JOIN roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id
         WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2
         GROUP BY assignment.project_id,project.name ORDER BY project.name`,[tenantId,row.membership_id],
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
          projectScopes: scopes.rows.map(scope=>({projectId:scope.project_id,projectName:scope.project_name,roles:scope.roles})),
        },
      };
    });
  }

  async adminSnapshot(input:{tenantId:string;userId:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const users=await client.query<{
        membership_id:string;user_id:string;name:string;email:string;job_title:string|null;work_phone:string|null;status:"invited"|"active"|"suspended"|"archived";last_login_at:string|null;role_ids:string[];project_ids:string[];
      }>(`SELECT membership.id membership_id,user_account.id user_id,user_account.display_name name,user_account.email,
          user_account.job_title,user_account.work_phone,membership.status,user_account.last_login_at,
          COALESCE((SELECT array_agg(DISTINCT role_id::text ORDER BY role_id::text) FROM (
            SELECT assignment.role_id FROM role_assignments assignment WHERE assignment.tenant_id=membership.tenant_id AND assignment.membership_id=membership.id
            UNION ALL
            SELECT assignment.role_id FROM project_role_assignments assignment WHERE assignment.tenant_id=membership.tenant_id AND assignment.membership_id=membership.id
          ) assigned_roles),ARRAY[]::text[]) role_ids,
          COALESCE((SELECT array_agg(DISTINCT project_id::text ORDER BY project_id::text) FROM project_role_assignments assignment WHERE assignment.tenant_id=membership.tenant_id AND assignment.membership_id=membership.id),ARRAY[]::text[]) project_ids
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
      return {
        users:users.rows.map(row=>({membershipId:row.membership_id,userId:row.user_id,name:row.name,email:row.email,jobTitle:row.job_title??"",workPhone:row.work_phone??"",status:row.status,lastLoginAt:row.last_login_at,roleIds:row.role_ids,projectIds:row.project_ids})),
        roles:roles.rows.map(row=>({id:row.id,code:row.code,name:row.name,description:row.description??"",isSystem:row.is_system,permissionCodes:row.permission_codes,permissionGrants:row.permission_grants,assignedUserCount:row.assigned_user_count,restrictions:roleRestrictions(row.code)})),
        projects:projects.rows,
        permissions:permissions.rows,
      };
    });
  }

  async inviteMember(input:{tenantId:string;userId:string;membershipId:string;name:string;email:string;jobTitle?:string;workPhone?:string;roleIds:string[];projectIds:string[]}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        const permitted=await client.query("SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code='users.manage'",[input.tenantId,input.membershipId]);
        if(!permitted.rowCount)throw new Error("users.manage permission required");
        const duplicate=await client.query<{id:string}>("SELECT id FROM users WHERE lower(email)=lower($1) AND status<>'archived' LIMIT 1",[input.email]);
        const invitedUserId=duplicate.rows[0]?.id??randomUUID();
        if(!duplicate.rowCount)await client.query(`INSERT INTO users(id,entra_issuer,entra_subject,email,display_name,status,job_title,work_phone)
          VALUES($1,$2,$3,$4,$5,'active',$6,$7)`,[invitedUserId,`pending:${input.tenantId}`,`invited:${input.email.toLowerCase()}`,input.email,input.name,input.jobTitle??null,input.workPhone??null]);
        const membershipId=randomUUID();
        await client.query("INSERT INTO tenant_memberships(id,tenant_id,user_id,status,invited_at) VALUES($1,$2,$3,'invited',now())",[membershipId,input.tenantId,invitedUserId]);
        await this.replaceAssignments(client,{...input,targetMembershipId:membershipId});
        await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'membership.invited','tenant_membership',$3,$4::jsonb)`,[input.tenantId,input.userId,membershipId,JSON.stringify({email:input.email,roleIds:input.roleIds,projectIds:input.projectIds})]);
        await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'tenant_membership',$2,'membership.invited.v1',$3::jsonb)`,[input.tenantId,membershipId,JSON.stringify({membershipId,email:input.email})]);
        return{membershipId};
    });
  }

  async updateMember(input:{tenantId:string;userId:string;membershipId:string;targetMembershipId:string;name:string;email:string;jobTitle?:string;workPhone?:string;status:string;roleIds:string[];projectIds:string[]}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        const permitted=await client.query("SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code='users.manage'",[input.tenantId,input.membershipId]);
        if(!permitted.rowCount)throw new Error("users.manage permission required");
        const before=(await client.query<{user_id:string;data:unknown}>("SELECT membership.user_id,to_jsonb(membership) data FROM tenant_memberships membership WHERE membership.tenant_id=$1 AND membership.id=$2 FOR UPDATE",[input.tenantId,input.targetMembershipId])).rows[0];
        if(!before)throw new Error("membership not found");
        if(input.targetMembershipId===input.membershipId&&input.status!=="active")throw new Error("Vlastní administrátorský přístup nelze deaktivovat");
        const adminRole=(await client.query<{id:string}>("SELECT id FROM roles WHERE tenant_id=$1 AND code='admin' AND status='active'",[input.tenantId])).rows[0];
        const targetIsAdmin=adminRole?Boolean((await client.query("SELECT 1 FROM role_assignments WHERE tenant_id=$1 AND membership_id=$2 AND role_id=$3",[input.tenantId,input.targetMembershipId,adminRole.id])).rowCount):false;
        const keepsTenantAdmin=Boolean(adminRole&&input.status==="active"&&input.projectIds.length===0&&input.roleIds.includes(adminRole.id));
        if(targetIsAdmin&&!keepsTenantAdmin&&adminRole){
          const otherAdmins=await client.query(`SELECT 1 FROM role_assignments assignment
            JOIN tenant_memberships membership ON membership.tenant_id=assignment.tenant_id AND membership.id=assignment.membership_id
            WHERE assignment.tenant_id=$1 AND assignment.role_id=$2 AND assignment.membership_id<>$3 AND membership.status='active' LIMIT 1`,[input.tenantId,adminRole.id,input.targetMembershipId]);
          if(!otherAdmins.rowCount)throw new Error("Workspace musí mít alespoň jednoho aktivního administrátora");
        }
        await client.query("UPDATE users SET display_name=$1,email=$2,job_title=$3,work_phone=$4 WHERE id=$5",[input.name,input.email,input.jobTitle??null,input.workPhone??null,before.user_id]);
        await client.query("UPDATE tenant_memberships SET status=$1,accepted_at=CASE WHEN $1='active' THEN COALESCE(accepted_at,now()) ELSE accepted_at END,archived_at=CASE WHEN $1='archived' THEN now() ELSE NULL END WHERE tenant_id=$2 AND id=$3",[input.status,input.tenantId,input.targetMembershipId]);
        await this.replaceAssignments(client,{...input,targetMembershipId:input.targetMembershipId});
        await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'membership.updated','tenant_membership',$3,$4::jsonb,$5::jsonb)`,[input.tenantId,input.userId,input.targetMembershipId,JSON.stringify(before.data),JSON.stringify({status:input.status,roleIds:input.roleIds,projectIds:input.projectIds,name:input.name})]);
        await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'tenant_membership',$2,'membership.updated.v1',$3::jsonb)`,[input.tenantId,input.targetMembershipId,JSON.stringify({membershipId:input.targetMembershipId,status:input.status})]);
        return{membershipId:input.targetMembershipId};
    });
  }

  async setRolePermissions(input:{tenantId:string;userId:string;membershipId:string;roleId:string;permissionCodes:string[]}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
        const permitted=await client.query("SELECT 1 FROM role_assignments assignment JOIN role_permissions role_permission ON role_permission.tenant_id=assignment.tenant_id AND role_permission.role_id=assignment.role_id JOIN permissions permission ON permission.id=role_permission.permission_id WHERE assignment.tenant_id=$1 AND assignment.membership_id=$2 AND permission.code IN ('roles.manage','role.manage')",[input.tenantId,input.membershipId]);
        if(!permitted.rowCount)throw new Error("role.manage permission required");
        const role=(await client.query<{code:string}>("SELECT code FROM roles WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[input.tenantId,input.roleId])).rows[0];
        if(!role)throw new Error("Role nebyla nalezena");
        if(role.code==="admin"&&input.permissionCodes.some(code=>["prices.approve","discounts.approve","commercial_exceptions.approve"].includes(code)))throw new Error("Administrátor nesmí schvalovat ceny ani obchodní výjimky");
        if(["admin","project_manager","back_office","finance","handover_complaints","sales","read_only"].includes(role.code)&&input.permissionCodes.includes("prices.approve"))throw new Error("Schvalování cen je oddělená pravomoc jednatele");
        await client.query("DELETE FROM role_permissions WHERE tenant_id=$1 AND role_id=$2",[input.tenantId,input.roleId]);
        await client.query("INSERT INTO role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code=ANY($3::text[])",[input.tenantId,input.roleId,input.permissionCodes]);
        await client.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'role.permissions_changed','role',$3,$4::jsonb)",[input.tenantId,input.userId,input.roleId,JSON.stringify({permissionCodes:input.permissionCodes})]);
        await client.query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'role',$2,'role.permissions_changed.v1',$3::jsonb)",[input.tenantId,input.roleId,JSON.stringify({roleId:input.roleId,permissionCodes:input.permissionCodes})]);
        return{roleId:input.roleId};
    });
  }

  private async replaceAssignments(client:PoolClient,input:{tenantId:string;userId:string;targetMembershipId:string;roleIds:string[];projectIds:string[]}) {
    const roleIds=[...new Set(input.roleIds)],projectIds=[...new Set(input.projectIds)];
    if(roleIds.length){
      const validRoles=await client.query("SELECT id FROM roles WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='active'",[input.tenantId,roleIds]);
      if(validRoles.rowCount!==roleIds.length)throw new Error("Některá zvolená role nepatří do aktuálního workspace");
    }
    if(projectIds.length){
      const validProjects=await client.query("SELECT id FROM projects WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND lifecycle_status<>'archived'",[input.tenantId,projectIds]);
      if(validProjects.rowCount!==projectIds.length)throw new Error("Některý zvolený projekt nepatří do aktuálního workspace");
    }
    await client.query("DELETE FROM role_assignments WHERE tenant_id=$1 AND membership_id=$2",[input.tenantId,input.targetMembershipId]);
    if(projectIds.length===0&&roleIds.length)await client.query(`INSERT INTO role_assignments(tenant_id,membership_id,role_id,assigned_by_user_id)
      SELECT $1,$2,role.id,$3 FROM roles role WHERE role.tenant_id=$1 AND role.id=ANY($4::uuid[])`,[input.tenantId,input.targetMembershipId,input.userId,roleIds]);
    await client.query("DELETE FROM project_role_assignments WHERE tenant_id=$1 AND membership_id=$2",[input.tenantId,input.targetMembershipId]);
    if(projectIds.length&&roleIds.length)await client.query(`INSERT INTO project_role_assignments(tenant_id,project_id,membership_id,role_id,assigned_by_user_id)
      SELECT $1,project.id,$2,role.id,$3 FROM projects project CROSS JOIN roles role
      WHERE project.tenant_id=$1 AND project.id=ANY($4::uuid[]) AND role.tenant_id=$1 AND role.id=ANY($5::uuid[])`,[input.tenantId,input.targetMembershipId,input.userId,projectIds,roleIds]);
  }
}

function roleRestrictions(code:string):string[]{
  if(code==="executive")return["Bez správy uživatelů, rolí, systému a integrací"];
  if(code==="admin")return["Bez schvalování cen, slev a obchodních výjimek"];
  if(code==="sales")return["Pouze vlastní klienti a předrezervace; bez exportu a potvrzení rezervace"];
  if(code==="read_only")return["Bez mutací a exportu"];
  return [];
}
