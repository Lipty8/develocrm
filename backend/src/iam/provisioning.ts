import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import type { EntraIdentity } from "../auth/entra.js";
import type { UserIdentity } from "./types.js";

export const defaultRoles = [
  { code: "executive", name: "Jednatel" },
  { code: "admin", name: "Admin" },
  { code: "project_manager", name: "Project Manager" },
  { code: "sales", name: "Sales / Obchod" },
  { code: "back_office", name: "Back Office" },
  { code: "finance", name: "Finance" },
  { code: "handover_complaints", name: "Předání a reklamace" },
  { code: "read_only", name: "Pouze pro čtení" },
] as const;
export const defaultPermissionCodes:Record<(typeof defaultRoles)[number]["code"],string[]>={
  executive:["projects.read","projects.create","projects.update","units.read","units.update","clients.read_all","clients.read_contact_details","contracts.read","documents.read","prices.read","prices.propose","prices.approve","discounts.approve","commercial_exceptions.approve","payments.read","handovers.read","tasks.read","exports.run","audit.read"],
  admin:["projects.read","projects.create","projects.update","projects.change_manager","projects.change_status","units.read","units.update","units.update_sales_status","accessories.read","accessories.update","clients.read_all","clients.read_contact_details","clients.create","clients.update","interests.manage","sales_cases.read","sales_cases.manage","holds.create","holds.cancel","holds.confirm","contracts.read","contracts.create","contracts.update","contracts.mark_ready","contracts.record_signature","documents.read","documents.create","documents.update","documents.review","documents.archive","prices.read","prices.propose","payments.read","payments.manage","handovers.read","handovers.manage","complaints.read","complaints.manage","tasks.read","tasks.manage","users.manage","roles.manage","system.manage","integrations.manage","exports.run","audit.read"],
  project_manager:["projects.read","projects.update","projects.change_manager","projects.change_status","units.read","units.update","units.update_sales_status","accessories.read","accessories.update","clients.read_all","clients.read_contact_details","clients.create","clients.update","interests.manage","sales_cases.read","sales_cases.manage","holds.create","holds.cancel","holds.confirm","contracts.read","contracts.create","contracts.update","documents.read","documents.create","documents.update","prices.read","prices.propose","payments.read","handovers.read","handovers.manage","tasks.read","tasks.manage"],
  sales:["projects.read","units.read","accessories.read","clients.read_own","clients.read_contact_details","clients.create","clients.update","interests.manage","sales_cases.read","sales_cases.manage","holds.create","holds.cancel"],
  back_office:["projects.read","units.read","clients.read_all","clients.read_contact_details","clients.create","clients.update","sales_cases.read","contracts.read","contracts.create","contracts.update","contracts.mark_ready","contracts.record_signature","documents.read","documents.create","documents.update","documents.review","tasks.read","tasks.manage"],
  finance:["projects.read","units.read","clients.read_all","contracts.read","documents.read","prices.read","payments.read","payments.manage","exports.run"],
  handover_complaints:["projects.read","units.read","clients.read_all","clients.read_contact_details","handovers.read","handovers.manage","complaints.read","complaints.manage","tasks.read","tasks.manage"],
  read_only:["projects.read","units.read","accessories.read","clients.read_all","sales_cases.read","contracts.read","documents.read","prices.read","payments.read","handovers.read","tasks.read"],
};

export class TenantProvisioningService {
  constructor(private readonly database: Database) {}

  async provision(input: { name: string; slug: string; owner: UserIdentity; identity: EntraIdentity }): Promise<string> {
    const tenantId = randomUUID();
    await this.database.withContext({ tenantId, userId: input.owner.id }, async (client) => {
      await client.query("INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')", [tenantId, input.name, input.slug]);
      await client.query(
        `INSERT INTO tenant_identity_providers (tenant_id, entra_tenant_id, issuer, is_primary)
         VALUES ($1, $2, $3, true)`,
        [tenantId, input.identity.entraTenantId, input.identity.issuer],
      );
      const membershipId = randomUUID();
      await client.query(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id, status, invited_at, accepted_at)
         VALUES ($1, $2, $3, 'active', now(), now())`,
        [membershipId, tenantId, input.owner.id],
      );
      let adminRoleId = "";
      for (const role of defaultRoles) {
        const roleId = randomUUID();
        await client.query(
          "INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES ($1, $2, $3, $4, true)",
          [roleId, tenantId, role.code, role.name],
        );
        if (role.code === "admin") adminRoleId = roleId;
      }
      for(const role of defaultRoles)await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT $1,r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.tenant_id=$1 AND r.code=$2 AND p.code=ANY($3::text[])`,
        [tenantId,role.code,defaultPermissionCodes[role.code]],
      );
      await client.query(
        `INSERT INTO role_assignments (tenant_id, membership_id, role_id, assigned_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, membershipId, adminRoleId, input.owner.id],
      );
      await client.query(
        `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'tenant.provisioned', 'tenant', $1, jsonb_build_object('name', $3, 'slug', $4))`,
        [tenantId, input.owner.id, input.name, input.slug],
      );
      await client.query(
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'tenant', $1, 'tenant.provisioned.v1', jsonb_build_object('tenantId', $1, 'ownerUserId', $2))`,
        [tenantId, input.owner.id],
      );
    });
    return tenantId;
  }
}
