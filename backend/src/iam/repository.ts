import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import type { EntraIdentity } from "../auth/entra.js";
import type { Session, UserIdentity, WorkspaceMembership } from "./types.js";

type UserRow = { id: string; email: string; display_name: string };

export class IamRepository {
  constructor(private readonly database: Database) {}

  async resolveUser(identity: EntraIdentity): Promise<UserIdentity> {
    const identityContext = { identityIssuer: identity.issuer, identitySubject: identity.subject };
    const found = await this.database.withContext(identityContext, async (client) => {
      const result = await client.query<UserRow>(
        "SELECT id, email, display_name FROM users WHERE entra_issuer = $1 AND entra_subject = $2",
        [identity.issuer, identity.subject],
      );
      return result.rows[0];
    });
    if (found) {
      await this.database.withContext({ ...identityContext, userId: found.id }, (client) => client.query(
        "UPDATE users SET email = $1, display_name = $2, last_login_at = now() WHERE id = $3",
        [identity.email, identity.displayName, found.id],
      ));
      return { id: found.id, email: identity.email, displayName: identity.displayName };
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
    return { id: created.id, email: created.email, displayName: created.display_name };
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
}
