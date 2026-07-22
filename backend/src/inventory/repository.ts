import type { Database } from "../database.js";

export type CatalogProject = {
  id: string; code: string; name: string; location: string | null; lifecycleStatus: string;
  manager: string | null; plannedHandoverFrom: string | null; plannedHandoverTo: string | null;
  constructionStatus: string | null;
  counts: Record<string, number>;
};

export type CatalogUnit = {
  id: string; code: string; projectId: string; projectName: string; structureName: string | null;
  layout: string | null; areaM2: number; usableAreaM2: number | null; floorLabel: string | null; orientation: string | null;
  balconyM2: number | null; terraceM2: number | null; gardenM2: number | null;
  commercialStatus: string; constructionStatus: string | null;
  accessories: Array<{ id: string; code: string; type: string; category: string; areaM2: number | null }>;
};

export class InventoryRepository {
  constructor(private readonly database: Database) {}

  async getCatalog(input: { tenantId: string; userId: string; membershipId: string }) {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const projects = await client.query<{
        id: string; code: string; name: string; location: string | null; lifecycle_status: string;
        manager: string | null; planned_handover_from: string | null; planned_handover_to: string | null;
        construction_status: string | null; counts: Record<string, number>;
      }>(
        `SELECT project.id, project.code, project.name, project.location, project.lifecycle_status,
                manager_user.display_name AS manager,
                project.planned_handover_from::text, project.planned_handover_to::text,
                construction.status_code AS construction_status,
                COALESCE(status_counts.counts, '{}'::jsonb) AS counts
         FROM projects project
         LEFT JOIN tenant_memberships manager_membership
           ON manager_membership.tenant_id = project.tenant_id AND manager_membership.id = project.manager_membership_id
         LEFT JOIN users manager_user ON manager_user.id = manager_membership.user_id
         LEFT JOIN LATERAL (
           SELECT event.status_code FROM construction_status_events event
           WHERE event.tenant_id = project.tenant_id AND event.project_id = project.id
             AND event.structure_id IS NULL AND event.effective_at <= now()
           ORDER BY event.effective_at DESC, event.recorded_at DESC, event.id DESC LIMIT 1
         ) construction ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_object_agg(grouped.commercial_status, grouped.amount) AS counts
           FROM (SELECT unit.commercial_status, count(*)::int amount FROM units unit
                 WHERE unit.tenant_id = project.tenant_id AND unit.project_id = project.id AND unit.archived_at IS NULL
                 GROUP BY unit.commercial_status) grouped
         ) status_counts ON true
         WHERE project.tenant_id = $1 AND project.archived_at IS NULL
           AND app.has_project_permission(project.tenant_id, $2, project.id, 'project.read')
         ORDER BY project.name`,
        [input.tenantId, input.membershipId],
      );
      const units = await client.query<{
        id: string; code: string; project_id: string; project_name: string; structure_name: string | null;
        layout: string | null; area_m2: string; usable_area_m2: string | null; floor_label: string | null; orientation: string | null;
        balcony_m2: string | null; terrace_m2: string | null; garden_m2: string | null;
        commercial_status: string; construction_status: string | null; accessories: CatalogUnit["accessories"];
      }>(
        `SELECT unit.id, unit.code, unit.project_id, project.name AS project_name,
                structure.name AS structure_name, unit.layout, unit.area_m2::text, unit.usable_area_m2::text,
                unit.floor_label, unit.orientation, unit.balcony_m2::text, unit.terrace_m2::text, unit.garden_m2::text,
                unit.commercial_status,
                app.effective_unit_construction_status(unit.tenant_id, unit.id) AS construction_status,
                COALESCE(accessory_rows.items, '[]'::jsonb) AS accessories
         FROM units unit
         JOIN projects project ON project.tenant_id=unit.tenant_id AND project.id=unit.project_id
         LEFT JOIN project_structures structure
           ON structure.tenant_id=unit.tenant_id AND structure.project_id=unit.project_id AND structure.id=unit.structure_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('id', accessory.id, 'code', accessory.code,
             'type', type.name, 'category', type.category, 'areaM2', accessory.area_m2) ORDER BY accessory.code) AS items
           FROM unit_accessory_assignments assignment
           JOIN accessories accessory ON accessory.tenant_id=assignment.tenant_id AND accessory.project_id=assignment.project_id AND accessory.id=assignment.accessory_id
           JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id
           WHERE assignment.tenant_id=unit.tenant_id AND assignment.unit_id=unit.id
             AND assignment.valid_from <= now() AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
         ) accessory_rows ON true
         WHERE unit.tenant_id=$1 AND unit.archived_at IS NULL
           AND app.has_project_permission(unit.tenant_id, $2, unit.project_id, 'unit.read')
         ORDER BY project.name, unit.code`,
        [input.tenantId, input.membershipId],
      );
      return {
        projects: projects.rows.map((row): CatalogProject => ({
          id: row.id, code: row.code, name: row.name, location: row.location,
          lifecycleStatus: row.lifecycle_status, manager: row.manager,
          plannedHandoverFrom: row.planned_handover_from, plannedHandoverTo: row.planned_handover_to,
          constructionStatus: row.construction_status, counts: row.counts,
        })),
        units: units.rows.map((row): CatalogUnit => ({
          id: row.id, code: row.code, projectId: row.project_id, projectName: row.project_name,
          structureName: row.structure_name, layout: row.layout, areaM2: Number(row.area_m2),
          usableAreaM2: row.usable_area_m2 === null ? null : Number(row.usable_area_m2),
          balconyM2: row.balcony_m2 === null ? null : Number(row.balcony_m2),
          terraceM2: row.terrace_m2 === null ? null : Number(row.terrace_m2),
          gardenM2: row.garden_m2 === null ? null : Number(row.garden_m2),
          floorLabel: row.floor_label, orientation: row.orientation, commercialStatus: row.commercial_status,
          constructionStatus: row.construction_status, accessories: row.accessories,
        })),
      };
    });
  }

  async hasUnitPermission(input: { tenantId: string; userId: string; membershipId: string; unitId: string; permission: string }): Promise<boolean> {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        `SELECT app.has_project_permission(unit.tenant_id, $2, unit.project_id, $3) AS allowed
         FROM units unit WHERE unit.tenant_id=$1 AND unit.id=$4`,
        [input.tenantId, input.membershipId, input.permission, input.unitId],
      );
      return result.rows[0]?.allowed ?? false;
    });
  }

  async updateProject(input: {tenantId:string;userId:string;membershipId:string;projectId:string;name:string;location?:string|null;lifecycleStatus:string;managerMembershipId?:string|null;plannedHandoverFrom?:string|null;plannedHandoverTo?:string|null}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.update_project_details($1,$2,$3,$4,$5,$6,$7,$8,$9) id", [input.tenantId,input.projectId,input.name,input.location??null,input.lifecycleStatus,input.managerMembershipId??null,input.plannedHandoverFrom??null,input.plannedHandoverTo??null,input.membershipId])).rows[0]);
  }
  async updateUnit(input: {tenantId:string;userId:string;membershipId:string;unitId:string;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.update_unit_details($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) id", [input.tenantId,input.unitId,input.layout??null,input.floorLabel??null,input.floorNumber??null,input.areaM2,input.usableAreaM2??null,input.orientation??null,input.balconyM2??null,input.terraceM2??null,input.gardenM2??null,input.membershipId])).rows[0]);
  }
  async assignAccessory(input: {tenantId:string;userId:string;membershipId:string;unitId:string;accessoryId:string;validFrom?:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.assign_accessory_to_unit($1,$2,$3,$4,$5) id", [input.tenantId,input.unitId,input.accessoryId,input.validFrom??null,input.membershipId])).rows[0]);
  }
  async removeAccessory(input: {tenantId:string;userId:string;membershipId:string;assignmentId:string;validTo?:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.remove_accessory_from_unit($1,$2,$3,$4) id", [input.tenantId,input.assignmentId,input.validTo??null,input.membershipId])).rows[0]);
  }
}
