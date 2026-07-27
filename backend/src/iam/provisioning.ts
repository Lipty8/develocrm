import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import type { EntraIdentity } from "../auth/entra.js";
import type { UserIdentity } from "./types.js";

const defaultRoles = [
  { code: "admin", name: "Admin" },
  { code: "project_manager", name: "Project Manager" },
  { code: "sales", name: "Sales / Obchod" },
  { code: "back_office", name: "Back Office" },
  { code: "finance", name: "Finance" },
  { code: "handover_complaints", name: "Předání a reklamace" },
  { code: "read_only", name: "Pouze pro čtení" },
] as const;
const defaultPermissionCodes:Record<(typeof defaultRoles)[number]["code"],string[]>={
  admin:[],
  project_manager:["tenant.read","membership.read","role.read","project.read","project.manage","projects.change_manager","projects.change_status","structure.manage","construction_status.manage","unit.read","unit.manage","accessory.read","accessory.manage","clients.read","clients.manage","clients.export","interests.manage","sales_case.read","sales_case.manage","holds.manage","holds.cancel","price.read","price.manage","price.approve","prices.propose","prices.change","prices.approve","contract.read","contract.manage","contract.approve","contract.sign"],
  sales:["tenant.read","membership.read","project.read","unit.read","accessory.read","clients.read","clients.manage","clients.export","interests.manage","sales_case.read","sales_case.manage","holds.manage","holds.cancel","price.read","prices.propose","contract.read","contract.manage","contract.sign"],
  back_office:["tenant.read","membership.read","project.read","unit.read","accessory.read","clients.read","clients.manage","clients.export","sales_case.read","contract.read","contract.manage","contract.approve"],
  finance:["tenant.read","project.read","unit.read","clients.read","price.read","contract.read","documents.view","finance.read","finance.manage","clients.export"],
  handover_complaints:["tenant.read","project.read","unit.read","clients.read","documents.view","tasks.read","tasks.manage","handover.read","handover.manage","complaints.read","complaints.manage"],
  read_only:["tenant.read","project.read","unit.read","accessory.read","clients.read","sales_case.read","price.read","contract.read","documents.view","tasks.read","handover.read"],
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
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions`,
        [tenantId, adminRoleId],
      );
      for(const role of defaultRoles.filter(item=>item.code!=="admin"))await client.query(
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
