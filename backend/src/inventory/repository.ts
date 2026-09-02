import type { Database } from "../database.js";

export type CatalogProject = {
  id: string; code: string; name: string; location: string | null; lifecycleStatus: string;
  manager: string | null; managerMembershipId:string|null; plannedHandoverFrom: string | null; plannedHandoverTo: string | null;
  constructionStatus: string | null;
  counts: Record<string, number>;
};

export type CatalogUnit = {
  id: string; code: string; projectId: string; projectName: string; structureId:string|null; structureName: string | null;
  layout: string | null; areaM2: number; usableAreaM2: number | null; floorLabel: string | null; orientation: string | null;
  balconyM2: number | null; terraceM2: number | null; gardenM2: number | null;
  commercialStatus: string; constructionStatus: string | null;
  unitPrice: number | null; accessoryPrice: number; totalPrice: number | null;
  updatedAt: string;
  accessories: Array<{ id: string; assignmentId:string; code: string; type: string; category: string; areaM2: number | null; relation:string|null; amount:number; amountNet:number|null; currency:string }>;
};

export class InventoryRepository {
  constructor(private readonly database: Database) {}

  async createProject(input: {
    tenantId:string; userId:string; membershipId:string; name:string; code:string;
    slug:string; location?:string|null; address?:string|null; description?:string|null;
    constructionStatus:string; plannedHandoverFrom?:string|null;
    managerMembershipId?:string|null; projectCompany?:string|null;
    defaultCurrency:string; plannedUnitCount?:number|null; note?:string|null;
  }): Promise<{id:string}> {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const result=await client.query<{id:string}>(
        "SELECT app.create_project($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) id",
        [input.tenantId,input.membershipId,input.name,input.code,input.slug,input.location??null,
          input.address??null,input.description??null,input.constructionStatus,
          input.plannedHandoverFrom??null,input.managerMembershipId??null,
          input.projectCompany??null,input.defaultCurrency,input.plannedUnitCount??null,input.note??null],
      );
      return result.rows[0];
    });
  }

  async getCatalog(input: { tenantId: string; userId: string; membershipId: string; projectId?:string }) {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const projects = await client.query<{
        id: string; code: string; name: string; location: string | null; lifecycle_status: string;
        manager: string | null; manager_membership_id:string|null; planned_handover_from: string | null; planned_handover_to: string | null;
        construction_status: string | null; counts: Record<string, number>;
      }>(
        `SELECT project.id, project.code, project.name, project.location, project.lifecycle_status,
                manager_user.display_name AS manager,project.manager_membership_id,
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
           AND ($3::uuid IS NULL OR project.id=$3)
           AND app.has_project_permission(project.tenant_id, $2, project.id, 'project.read')
         ORDER BY project.name`,
        [input.tenantId, input.membershipId,input.projectId??null],
      );
      const pricingProjection = await client.query<{available:boolean}>(
        `SELECT to_regclass('unit_price_history') IS NOT NULL
           AND to_regprocedure('app.current_unit_price(uuid,uuid,timestamptz)') IS NOT NULL
           AND to_regprocedure('app.current_unit_accessory_price(uuid,uuid,timestamptz)') IS NOT NULL
           AND to_regprocedure('app.current_unit_sales_price(uuid,uuid,timestamptz)') IS NOT NULL AS available`,
      );
      const priceColumns = pricingProjection.rows[0]?.available
        ? `CASE WHEN current_price.configured THEN app.current_unit_price(unit.tenant_id,unit.id,now())::float8 ELSE NULL END unit_price,
                CASE WHEN app.has_project_permission(unit.tenant_id,$2,unit.project_id,'price.read') THEN app.current_unit_accessory_price(unit.tenant_id,unit.id,now())::float8 ELSE 0 END accessory_price,
                CASE WHEN current_price.configured THEN app.current_unit_sales_price(unit.tenant_id,unit.id,now())::float8 ELSE NULL END total_price,`
        : `NULL::float8 unit_price,0::float8 accessory_price,NULL::float8 total_price,`;
      const priceJoin = pricingProjection.rows[0]?.available
        ? `LEFT JOIN LATERAL (
           SELECT app.has_project_permission(unit.tenant_id,$2,unit.project_id,'price.read')
             AND EXISTS(SELECT 1 FROM unit_price_history price WHERE price.tenant_id=unit.tenant_id AND price.unit_id=unit.id AND price.valid_from<=now()) configured
         ) current_price ON true`
        : "";
      const units = await client.query<{
        id: string; code: string; project_id: string; project_name: string; structure_id:string|null; structure_name: string | null;
        layout: string | null; area_m2: string; usable_area_m2: string | null; floor_label: string | null; orientation: string | null;
        balcony_m2: string | null; terrace_m2: string | null; garden_m2: string | null;
        commercial_status: string; construction_status: string | null; unit_price:number|null; accessory_price:number; total_price:number|null; updated_at:string; accessories: CatalogUnit["accessories"];
      }>(
        `SELECT unit.id, unit.code, unit.project_id,unit.structure_id, project.name AS project_name,
                structure.name AS structure_name, unit.layout, unit.area_m2::text, unit.usable_area_m2::text,
                unit.floor_label, unit.orientation, unit.balcony_m2::text, unit.terrace_m2::text, unit.garden_m2::text,
                unit.commercial_status,unit.updated_at,
                ${priceColumns}
                app.effective_unit_construction_status(unit.tenant_id, unit.id) AS construction_status,
                COALESCE(accessory_rows.items, '[]'::jsonb) AS accessories
         FROM units unit
         JOIN projects project ON project.tenant_id=unit.tenant_id AND project.id=unit.project_id
         LEFT JOIN project_structures structure
           ON structure.tenant_id=unit.tenant_id AND structure.project_id=unit.project_id AND structure.id=unit.structure_id
         ${priceJoin}
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('id', accessory.id,'assignmentId',assignment.id, 'code', accessory.code,
             'type', type.name, 'category', type.category, 'areaM2', accessory.area_m2,'relation',relation.target_code,
             'amount',COALESCE(price.amount,0),'amountNet',price.amount_net,'currency',COALESCE(price.currency,'CZK')) ORDER BY accessory.code) AS items
           FROM unit_accessory_assignments assignment
           JOIN accessories accessory ON accessory.tenant_id=assignment.tenant_id AND accessory.project_id=assignment.project_id AND accessory.id=assignment.accessory_id
           JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id
           LEFT JOIN LATERAL (SELECT history.amount::float8 amount,history.amount_net::float8 amount_net,history.currency FROM accessory_price_history history WHERE history.tenant_id=accessory.tenant_id AND history.accessory_id=accessory.id AND history.valid_from<=now() ORDER BY history.valid_from DESC,history.recorded_at DESC,history.id DESC LIMIT 1) price ON true
           LEFT JOIN LATERAL (SELECT target.code target_code FROM accessory_relations link JOIN accessories target ON target.tenant_id=link.tenant_id AND target.id=link.target_accessory_id WHERE link.tenant_id=accessory.tenant_id AND link.source_accessory_id=accessory.id AND link.relation_type='installed_at' LIMIT 1) relation ON true
           WHERE assignment.tenant_id=unit.tenant_id AND assignment.unit_id=unit.id
             AND assignment.valid_from <= now() AND (assignment.valid_to IS NULL OR assignment.valid_to > now())
         ) accessory_rows ON true
         WHERE unit.tenant_id=$1 AND unit.archived_at IS NULL AND project.archived_at IS NULL
           AND ($3::uuid IS NULL OR unit.project_id=$3)
           AND app.has_project_permission(unit.tenant_id, $2, unit.project_id, 'unit.read')
         ORDER BY project.name, unit.code`,
        [input.tenantId, input.membershipId,input.projectId??null],
      );
      const accessories=await client.query<{id:string;code:string;project_id:string;project_name:string;type:string;category:string;subtype:string|null;location:string|null;area_m2:string|null;available:boolean;archived:boolean;relation:string|null;amount:number;amount_net:number|null;currency:string;assignment_id:string|null;assigned_unit_id:string|null;assigned_unit_code:string|null;assigned_unit_status:string|null;assigned_client:string|null;assignment_history:Array<{assignmentId:string;unitId:string;unitCode:string;validFrom:string;validTo:string|null;assignedBy:string|null}>}>(
        `SELECT accessory.id,accessory.code,accessory.project_id,project.name project_name,COALESCE(accessory.description,type.name) type,type.category,accessory.description subtype,accessory.floor_label location,accessory.area_m2::text,
          active_assignment.id IS NULL AND accessory.archived_at IS NULL available,accessory.archived_at IS NOT NULL archived,
          active_assignment.id assignment_id,active_assignment.unit_id assigned_unit_id,
          active_assignment.unit_code assigned_unit_code,active_assignment.commercial_status assigned_unit_status,buyers.names assigned_client,
          relation.target_code relation,COALESCE(price.amount,0)::float8 amount,price.amount_net::float8 amount_net,COALESCE(price.currency,'CZK') currency,
          COALESCE(history.items,'[]'::jsonb) assignment_history
         FROM accessories accessory JOIN projects project ON project.tenant_id=accessory.tenant_id AND project.id=accessory.project_id
         JOIN accessory_types type ON type.tenant_id=accessory.tenant_id AND type.id=accessory.accessory_type_id
         LEFT JOIN LATERAL (
           SELECT assignment.id,assignment.unit_id,unit.code unit_code,unit.commercial_status
           FROM unit_accessory_assignments assignment
           JOIN units unit ON unit.tenant_id=assignment.tenant_id AND unit.id=assignment.unit_id
           WHERE assignment.tenant_id=accessory.tenant_id AND assignment.accessory_id=accessory.id
             AND assignment.valid_from<=now() AND (assignment.valid_to IS NULL OR assignment.valid_to>now())
           ORDER BY assignment.valid_from DESC,assignment.id DESC LIMIT 1
         ) active_assignment ON true
         LEFT JOIN LATERAL (SELECT history.amount,history.amount_net,history.currency FROM accessory_price_history history WHERE history.tenant_id=accessory.tenant_id AND history.accessory_id=accessory.id AND history.valid_from<=now() ORDER BY history.valid_from DESC,history.recorded_at DESC,history.id DESC LIMIT 1) price ON true
         LEFT JOIN LATERAL (
           SELECT related.code target_code FROM (
             SELECT target.code,0 priority FROM accessory_relations link
             JOIN accessories target ON target.tenant_id=link.tenant_id AND target.id=link.target_accessory_id
             WHERE link.tenant_id=accessory.tenant_id AND link.source_accessory_id=accessory.id AND link.relation_type='installed_at'
             UNION ALL
             SELECT source.code,1 priority FROM accessory_relations link
             JOIN accessories source ON source.tenant_id=link.tenant_id AND source.id=link.source_accessory_id
             WHERE link.tenant_id=accessory.tenant_id AND link.target_accessory_id=accessory.id AND link.relation_type='installed_at'
           ) related ORDER BY related.priority,related.code LIMIT 1
         ) relation ON true
         LEFT JOIN LATERAL (
           SELECT string_agg(DISTINCT party.display_name,' a ' ORDER BY party.display_name) names
           FROM sales_cases sales_case
           JOIN sales_case_parties participant ON participant.tenant_id=sales_case.tenant_id AND participant.sales_case_id=sales_case.id
             AND participant.participant_role IN ('buyer','co_buyer') AND participant.left_at IS NULL
           JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
           WHERE sales_case.tenant_id=accessory.tenant_id AND sales_case.unit_id=active_assignment.unit_id AND sales_case.status='active'
         ) buyers ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('assignmentId',assignment.id,'unitId',assignment.unit_id,'unitCode',unit.code,
             'validFrom',assignment.valid_from,'validTo',assignment.valid_to,'assignedBy',actor_user.display_name)
             ORDER BY assignment.valid_from DESC,assignment.id DESC) items
           FROM unit_accessory_assignments assignment
           JOIN units unit ON unit.tenant_id=assignment.tenant_id AND unit.id=assignment.unit_id
           LEFT JOIN tenant_memberships actor ON actor.tenant_id=assignment.tenant_id AND actor.id=assignment.assigned_by_membership_id
           LEFT JOIN users actor_user ON actor_user.id=actor.user_id
           WHERE assignment.tenant_id=accessory.tenant_id AND assignment.accessory_id=accessory.id
         ) history ON true
         WHERE accessory.tenant_id=$1 AND project.archived_at IS NULL AND app.has_project_permission(accessory.tenant_id,$2,accessory.project_id,'accessory.read')
           AND ($3::uuid IS NULL OR accessory.project_id=$3) ORDER BY project.name,type.category,accessory.code`,[input.tenantId,input.membershipId,input.projectId??null]);
      const memberships=await client.query<{id:string;name:string}>(`SELECT membership.id,user_row.display_name name FROM tenant_memberships membership JOIN users user_row ON user_row.id=membership.user_id WHERE membership.tenant_id=$1 AND membership.status='active' ORDER BY user_row.display_name`,[input.tenantId]);
      const structures=await client.query<{id:string;project_id:string;project_name:string;name:string;kind:string}>(`SELECT structure.id,structure.project_id,project.name project_name,structure.name,structure.kind FROM project_structures structure JOIN projects project ON project.tenant_id=structure.tenant_id AND project.id=structure.project_id WHERE structure.tenant_id=$1 AND structure.archived_at IS NULL AND project.archived_at IS NULL AND app.has_project_permission(structure.tenant_id,$2,structure.project_id,'project.read') AND ($3::uuid IS NULL OR structure.project_id=$3) ORDER BY project.name,structure.sort_order,structure.name`,[input.tenantId,input.membershipId,input.projectId??null]);
      return {
        projects: projects.rows.map((row): CatalogProject => ({
          id: row.id, code: row.code, name: row.name, location: row.location,
          lifecycleStatus: row.lifecycle_status, manager: row.manager,managerMembershipId:row.manager_membership_id,
          plannedHandoverFrom: row.planned_handover_from, plannedHandoverTo: row.planned_handover_to,
          constructionStatus: row.construction_status, counts: row.counts,
        })),
        units: units.rows.map((row): CatalogUnit => ({
          id: row.id, code: row.code, projectId: row.project_id, projectName: row.project_name,structureId:row.structure_id,
          structureName: row.structure_name, layout: row.layout, areaM2: Number(row.area_m2),
          usableAreaM2: row.usable_area_m2 === null ? null : Number(row.usable_area_m2),
          balconyM2: row.balcony_m2 === null ? null : Number(row.balcony_m2),
          terraceM2: row.terrace_m2 === null ? null : Number(row.terrace_m2),
          gardenM2: row.garden_m2 === null ? null : Number(row.garden_m2),
          floorLabel: row.floor_label, orientation: row.orientation, commercialStatus: row.commercial_status,
          constructionStatus: row.construction_status,unitPrice:row.unit_price,accessoryPrice:row.accessory_price,totalPrice:row.total_price,updatedAt:row.updated_at, accessories: row.accessories,
        })),accessories:accessories.rows.map(row=>({id:row.id,assignmentId:row.assignment_id??undefined,code:row.code,projectId:row.project_id,projectName:row.project_name,type:row.type,category:row.category,subtype:row.subtype,location:row.location,areaM2:row.area_m2===null?null:Number(row.area_m2),available:row.available,archived:row.archived,assignedUnitId:row.assigned_unit_id,assignedUnitCode:row.assigned_unit_code,assignedUnitStatus:row.assigned_unit_status,assignedClient:row.assigned_client,assignmentHistory:row.assignment_history,relation:row.relation,amount:row.amount,amountNet:row.amount_net,currency:row.currency})),memberships:memberships.rows,structures:structures.rows.map(row=>({id:row.id,projectId:row.project_id,projectName:row.project_name,name:row.name,kind:row.kind})),
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
  async updateUnit(input: {tenantId:string;userId:string;membershipId:string;unitId:string;structureId?:string|null;layout?:string|null;floorLabel?:string|null;floorNumber?:number|null;areaM2:number;usableAreaM2?:number|null;orientation?:string|null;balconyM2?:number|null;terraceM2?:number|null;gardenM2?:number|null}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.update_unit_details_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) id", [input.tenantId,input.unitId,input.structureId??null,input.layout??null,input.floorLabel??null,input.floorNumber??null,input.areaM2,input.usableAreaM2??null,input.orientation??null,input.balconyM2??null,input.terraceM2??null,input.gardenM2??null,input.membershipId])).rows[0]);
  }
  async recordProjectConstructionStatus(input:{tenantId:string;userId:string;membershipId:string;projectId:string;statusCode:string;effectiveAt:string;note:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.record_project_construction_status($1,$2,$3,$4,$5,$6) id",[input.tenantId,input.projectId,input.statusCode,input.effectiveAt,input.note,input.membershipId])).rows[0]);}
  async assignAccessory(input: {tenantId:string;userId:string;membershipId:string;unitId:string;accessoryId:string;validFrom?:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.assign_accessory_to_unit($1,$2,$3,$4,$5) id", [input.tenantId,input.unitId,input.accessoryId,input.validFrom??null,input.membershipId])).rows[0]);
  }
  async removeAccessory(input: {tenantId:string;userId:string;membershipId:string;assignmentId:string;validTo?:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.remove_accessory_from_unit($1,$2,$3,$4) id", [input.tenantId,input.assignmentId,input.validTo??null,input.membershipId])).rows[0]);
  }
  async createAccessory(input:{tenantId:string;userId:string;membershipId:string;projectId:string;category:"parking"|"cellar"|"wallbox";code:string;areaM2?:number|null;amount:number;amountNet?:number|null;relatedAccessoryId?:string|null}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>(
      "SELECT app.create_project_accessory($1,$2,$3,$4,$5,$6,$7,$8,$9) id",
      [input.tenantId,input.projectId,input.category,input.code,input.areaM2??null,input.amount,input.amountNet??null,input.relatedAccessoryId??null,input.membershipId],
    )).rows[0]);
  }
  async updateAccessory(input:{tenantId:string;userId:string;membershipId:string;accessoryId:string;code:string;areaM2?:number|null;amount:number;amountNet?:number|null;reason?:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>(
      "SELECT app.update_project_accessory($1,$2,$3,$4,$5,$6,$7,$8) id",
      [input.tenantId,input.accessoryId,input.code,input.areaM2??null,input.amount,input.amountNet??null,input.reason??"Úprava příslušenství",input.membershipId],
    )).rows[0]);
  }
  async removeOrArchiveAccessory(input:{tenantId:string;userId:string;membershipId:string;accessoryId:string;reason:string}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{outcome:{mode:"delete"|"archive";accessoryId:string}}>(
      "SELECT app.remove_or_archive_accessory($1,$2,$3,$4) outcome",
      [input.tenantId,input.accessoryId,input.membershipId,input.reason],
    )).rows[0]?.outcome);
  }
}
