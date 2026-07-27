import type { Database } from "../database.js";

export type ClientDirectoryItem = {
  id: string; name: string; type: string; kind: "FO" | "PO"; email: string; phone: string;
  contact: string; units: string[]; projects: string; projectNames: string[]; state: string;
  contractStatus: string; initials: string;
  interestHistory: Array<{ date: string; project: string; unit: string; type: string; result: string }>;
  firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;vatNumber?:string;contactPerson?:string;
  address?:{line1:string;line2?:string;city:string;postalCode?:string;countryCode:string;addressType:string}|null;
  updatedAt?:string;
};

export type UnitCommercialContext = {
  buyers: Array<{ partyId: string; name: string; email: string; role: string; share: number | null }>;
  interests: Array<{ date: string; partyId: string; name: string; type: string; result: string }>;
  stage: string | null;
  hold: { id: string; type: string; expiresAt: string } | null;
};

type Context = { tenantId: string; userId: string; membershipId: string };

export class SalesRepository {
  constructor(private readonly database: Database) {}

  async updateParty(input:{tenantId:string;userId:string;partyId:string;displayName:string;membershipId:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.update_party_details($1,$2,$3,$4) id",[input.tenantId,input.partyId,input.displayName,input.membershipId])).rows[0]);
  }
  async upsertContact(input:{tenantId:string;userId:string;partyId:string;contactType:string;value:string;label?:string|null;isPrimary?:boolean;membershipId:string}) {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId}, async client => (await client.query<{id:string}>("SELECT app.upsert_party_contact($1,$2,$3,$4,$5,$6,$7) id",[input.tenantId,input.partyId,input.contactType,input.value,input.label??null,input.isPrimary??false,input.membershipId])).rows[0]);
  }
  async updateProfile(input:{tenantId:string;userId:string;partyId:string;membershipId:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;vatNumber?:string;contactPerson?:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.update_party_profile($1,$2,$3,$4,$5,$6,$7,$8,$9) id",[input.tenantId,input.partyId,input.firstName??null,input.lastName??null,input.legalName??null,input.registrationNumber??null,input.vatNumber??null,input.contactPerson??null,input.membershipId])).rows[0]);}
  async upsertAddress(input:{tenantId:string;userId:string;partyId:string;membershipId:string;addressType:string;line1:string;line2?:string;city:string;postalCode?:string;countryCode:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.upsert_party_primary_address($1,$2,$3,$4,$5,$6,$7,$8,$9) id",[input.tenantId,input.partyId,input.addressType,input.line1,input.line2??null,input.city,input.postalCode??null,input.countryCode,input.membershipId])).rows[0]);}
  async addInterest(input:{tenantId:string;userId:string;unitId:string;partyId:string;eventType:string;note:string;membershipId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.add_unit_interest($1,$2,$3,$4,$5,$6) id",[input.tenantId,input.unitId,input.partyId,input.eventType,input.note,input.membershipId])).rows[0]);}
  async createParty(input:{tenantId:string;userId:string;projectId:string;kind:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;membershipId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.create_party_for_project($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id",[input.tenantId,input.projectId,input.kind,input.firstName??null,input.lastName??null,input.legalName??null,input.registrationNumber??null,input.email??null,input.phone??null,input.membershipId])).rows[0]);}

  async getDirectory(input: Context): Promise<{ clients: ClientDirectoryItem[]; unitContexts: Record<string, UnitCommercialContext> }> {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const partyRows = await client.query<{
        id: string; display_name: string; party_type: string; email: string | null; phone: string | null;first_name:string|null;last_name:string|null;legal_name:string|null;registration_number:string|null;vat_number:string|null;contact_person:string|null;address:ClientDirectoryItem["address"];updated_at:string;
        projects: Array<{ id: string; name: string }>; units: string[]; state: string; stage: string | null;
        interest_history: ClientDirectoryItem["interestHistory"];
      }>(
        `SELECT party.id,party.display_name,party.party_type,email.value AS email,phone.value AS phone,individual.first_name,individual.last_name,organization.legal_name,organization.registration_number,organization.vat_number,organization.contact_person,address.item address,party.updated_at,
          COALESCE(projects.items,'[]'::jsonb) projects,COALESCE(unit_rows.items,'[]'::jsonb) units,
          CASE WHEN stage.current_stage='handover' THEN 'Předáno'
               WHEN stage.current_stage IS NOT NULL AND stage.current_stage<>'interest' THEN 'Aktivní klient'
               ELSE 'Zájemce' END state,
          stage.current_stage,
          COALESCE(history.items,'[]'::jsonb) interest_history
         FROM parties party
         LEFT JOIN party_individual_details individual ON individual.tenant_id=party.tenant_id AND individual.party_id=party.id
         LEFT JOIN party_organization_details organization ON organization.tenant_id=party.tenant_id AND organization.party_id=party.id
         LEFT JOIN LATERAL (SELECT jsonb_build_object('line1',line1,'line2',line2,'city',city,'postalCode',postal_code,'countryCode',country_code,'addressType',address_type) item FROM party_addresses WHERE tenant_id=party.tenant_id AND party_id=party.id AND is_primary AND valid_to IS NULL ORDER BY created_at DESC LIMIT 1) address ON true
         LEFT JOIN LATERAL (SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id
           AND contact_type='email' AND archived_at IS NULL ORDER BY is_primary DESC,created_at LIMIT 1) email ON true
         LEFT JOIN LATERAL (SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id
           AND contact_type='phone' AND archived_at IS NULL ORDER BY is_primary DESC,created_at LIMIT 1) phone ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(DISTINCT jsonb_build_object('id',project.id,'name',project.name)) items
           FROM party_project_links link JOIN projects project ON project.tenant_id=link.tenant_id AND project.id=link.project_id
           WHERE link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.valid_to IS NULL
             AND app.has_project_permission(link.tenant_id,$2,link.project_id,'clients.read')
         ) projects ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(DISTINCT unit.code ORDER BY unit.code) items
           FROM unit_interests interest JOIN units unit ON unit.tenant_id=interest.tenant_id AND unit.id=interest.unit_id
           WHERE interest.tenant_id=party.tenant_id AND interest.party_id=party.id
             AND app.has_project_permission(interest.tenant_id,$2,interest.project_id,'clients.read')
         ) unit_rows ON true
         LEFT JOIN LATERAL (
           SELECT sales_case.current_stage FROM sales_case_parties participant
           JOIN sales_cases sales_case ON sales_case.tenant_id=participant.tenant_id AND sales_case.id=participant.sales_case_id
           WHERE participant.tenant_id=party.tenant_id AND participant.party_id=party.id AND participant.left_at IS NULL
             AND sales_case.status='active' AND app.has_project_permission(sales_case.tenant_id,$2,sales_case.project_id,'clients.read')
           ORDER BY sales_case.opened_at DESC LIMIT 1
         ) stage ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('date',COALESCE(to_char(interest.first_interest_at,'DD. MM. YYYY'),'Datum neuvedeno'),
             'project',project.name,'unit',unit.code,'type',CASE interest.status WHEN 'converted' THEN 'Obchodní proces' WHEN 'active' THEN 'Aktivní zájem' ELSE 'Ukončený zájem' END,
             'result',COALESCE(latest.outcome,CASE interest.status WHEN 'converted' THEN 'Pokračuje' WHEN 'active' THEN 'Aktivní' ELSE 'Bez realizace' END))
             ORDER BY interest.first_interest_at DESC) items
           FROM unit_interests interest JOIN units unit ON unit.tenant_id=interest.tenant_id AND unit.id=interest.unit_id
           JOIN projects project ON project.tenant_id=interest.tenant_id AND project.id=interest.project_id
           LEFT JOIN LATERAL (SELECT outcome FROM interest_events event WHERE event.tenant_id=interest.tenant_id AND event.unit_interest_id=interest.id ORDER BY occurred_at DESC LIMIT 1) latest ON true
           WHERE interest.tenant_id=party.tenant_id AND interest.party_id=party.id
             AND app.has_project_permission(interest.tenant_id,$2,interest.project_id,'clients.read')
         ) history ON true
         WHERE party.tenant_id=$1 AND party.archived_at IS NULL AND party.lifecycle_status<>'merged'
           AND (projects.items IS NOT NULL OR history.items IS NOT NULL)
         ORDER BY party.display_name`,
        [input.tenantId,input.membershipId],
      );

      const contextRows = await client.query<{
        unit_code: string; buyers: UnitCommercialContext["buyers"]; interests: UnitCommercialContext["interests"];
        stage: string | null; hold: UnitCommercialContext["hold"];
      }>(
        `SELECT unit.code unit_code,active_case.current_stage stage,
          COALESCE(buyers.items,'[]'::jsonb) buyers,COALESCE(interests.items,'[]'::jsonb) interests,hold.item hold
         FROM units unit
         LEFT JOIN LATERAL (SELECT id,current_stage FROM sales_cases WHERE tenant_id=unit.tenant_id AND unit_id=unit.id AND status='active' LIMIT 1) active_case ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('partyId',party.id,'name',party.display_name,'email',COALESCE(email.value,''),
             'role',participant.participant_role,'share',participant.ownership_share) ORDER BY participant.is_primary DESC,party.display_name) items
           FROM sales_case_parties participant JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
           LEFT JOIN LATERAL (SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id AND contact_type='email' AND archived_at IS NULL ORDER BY is_primary DESC LIMIT 1) email ON true
           WHERE participant.tenant_id=unit.tenant_id AND participant.sales_case_id=active_case.id AND participant.left_at IS NULL
         ) buyers ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('date',COALESCE(to_char(interest.first_interest_at,'DD. MM. YYYY'),'Datum neuvedeno'),'partyId',party.id,'name',party.display_name,
             'type',COALESCE(highest.label,CASE interest.status WHEN 'converted' THEN 'Obchodní proces' WHEN 'active' THEN 'Aktivní zájem' ELSE 'Ukončený zájem' END),
             'result',COALESCE(latest.outcome,CASE interest.status WHEN 'converted' THEN 'Pokračuje v obchodním procesu' WHEN 'active' THEN 'Aktivní' ELSE 'Bez realizace' END)) ORDER BY interest.first_interest_at DESC) items
           FROM unit_interests interest JOIN parties party ON party.tenant_id=interest.tenant_id AND party.id=interest.party_id
           LEFT JOIN LATERAL (SELECT outcome FROM interest_events event WHERE event.tenant_id=interest.tenant_id AND event.unit_interest_id=interest.id ORDER BY occurred_at DESC LIMIT 1) latest ON true
           LEFT JOIN LATERAL (SELECT CASE max(CASE event_type WHEN 'converted_to_sales_case' THEN 7 WHEN 'reservation_requested' THEN 6 WHEN 'pre_reservation_requested' THEN 5 WHEN 'offer' THEN 4 WHEN 'viewing' THEN 3 WHEN 'inquiry' THEN 2 ELSE 1 END) WHEN 7 THEN 'Převedeno do obchodního procesu' WHEN 6 THEN 'Rezervace' WHEN 5 THEN 'Předrezervace' WHEN 4 THEN 'Nabídka' WHEN 3 THEN 'Prohlídka' ELSE 'Zájem' END label FROM interest_events event WHERE event.tenant_id=interest.tenant_id AND event.unit_interest_id=interest.id) highest ON true
           WHERE interest.tenant_id=unit.tenant_id AND interest.unit_id=unit.id
         ) interests ON true
         LEFT JOIN LATERAL (SELECT jsonb_build_object('id',id,'type',hold_type,'expiresAt',expires_at) item FROM unit_holds
           WHERE tenant_id=unit.tenant_id AND unit_id=unit.id AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1) hold ON true
         WHERE unit.tenant_id=$1 AND app.has_project_permission(unit.tenant_id,$2,unit.project_id,'sales_case.read')`,
        [input.tenantId,input.membershipId],
      );

      return {
        clients: partyRows.rows.map((row) => {
          const projectNames = row.projects.map((project) => project.name).sort();
          const email = row.email ?? ""; const phone = row.phone ?? "";
          return { id: row.id,name: row.display_name,type: row.party_type === "individual" ? "Fyzická osoba" : "Právnická osoba",
            kind: row.party_type === "individual" ? "FO" : "PO",email,phone,contact: [email,phone].filter(Boolean).join(" · "),
            units: row.units,projects: projectNames.join(", "),projectNames,state: row.state,
            contractStatus: stageLabel(row.stage),initials: initials(row.display_name),interestHistory: row.interest_history,firstName:row.first_name??undefined,lastName:row.last_name??undefined,legalName:row.legal_name??undefined,registrationNumber:row.registration_number??undefined,vatNumber:row.vat_number??undefined,contactPerson:row.contact_person??undefined,address:row.address,updatedAt:row.updated_at };
        }),
        unitContexts: Object.fromEntries(contextRows.rows.map((row) => [row.unit_code,{ buyers: row.buyers,interests: row.interests,stage: row.stage,hold: row.hold }])),
      };
    });
  }

  async exportContacts(input: Context & { partyIds?: string[] }): Promise<ClientDirectoryItem[]> {
    const directory = await this.getDirectory(input);
    return this.database.withContext({ tenantId: input.tenantId,userId: input.userId }, async (client) => {
      const allowed = await client.query<{ id: string }>(
        `SELECT DISTINCT party.id FROM parties party JOIN party_project_links link ON link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.valid_to IS NULL
         WHERE party.tenant_id=$1 AND app.has_project_permission(link.tenant_id,$2,link.project_id,'clients.export')
           AND ($3::uuid[] IS NULL OR party.id=ANY($3::uuid[]))`,
        [input.tenantId,input.membershipId,input.partyIds?.length ? input.partyIds : null],
      );
      const ids = new Set(allowed.rows.map((row) => row.id));
      return directory.clients.filter((item) => ids.has(item.id));
    });
  }

  async hasHoldPermission(input: Context & { holdId: string; permission: string }): Promise<boolean> {
    return this.database.withContext({ tenantId:input.tenantId,userId:input.userId }, async (client) => {
      const result = await client.query<{ allowed:boolean }>(
        `SELECT app.has_project_permission(hold.tenant_id,$2,hold.project_id,$3) allowed
         FROM unit_holds hold WHERE hold.tenant_id=$1 AND hold.id=$4`,
        [input.tenantId,input.membershipId,input.permission,input.holdId],
      );
      return result.rows[0]?.allowed ?? false;
    });
  }
}

function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join(""); }
function stageLabel(stage: string | null): string {
  return ({ interest:"Bez smlouvy",pre_reservation:"Předrezervace",reservation:"Rezervace",rs:"RS",sbk:"SBK",ks:"KS",handover:"Předáno" } as Record<string,string>)[stage ?? ""] ?? "Bez smlouvy";
}
