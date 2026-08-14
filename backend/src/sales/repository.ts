import type { Database, SqlClient } from "../database.js";

export type ClientDirectoryItem = {
  id: string; name: string; type: string; kind: "FO" | "PO"; email: string; phone: string;
  contact: string; units: string[]; projects: string; projectNames: string[]; state: string;
  contractStatus: string; initials: string;
  interestHistory: Array<{ date: string; project: string; unit: string; type: string; result: string }>;
  firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;vatNumber?:string;contactPerson?:string;
  address?:{line1:string;line2?:string;city:string;postalCode?:string;countryCode:string;addressType:string}|null;
  updatedAt?:string;
  lifecycleStatus?:"active"|"inactive"|"merged"|"archived";
  unitRelations:Array<{unitId:string;code:string;projectId:string;project:string;contractType?:"RS"|"SBK"|"KS";contractStatus?:string}>;
};

export type PartyDuplicateMatch={id:string;name:string;kind:"FO"|"PO";strength:"strong"|"possible";reasons:string[];email:string;phone:string;projects:string[];units:string[]};

export type UnitCommercialContext = {
  salesCaseId: string | null;
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
  async findDuplicates(input:{tenantId:string;userId:string;membershipId:string;projectId:string;kind:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string}):Promise<PartyDuplicateMatch[]>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},client=>this.findDuplicatesWithClient(client,input));
  }
  async createParty(input:{tenantId:string;userId:string;projectId:string;kind:string;salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string;membershipId:string;duplicateOverride?:boolean}){
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const lockKey=[input.email,input.phone,input.registrationNumber,input.firstName,input.lastName,input.legalName].map(value=>normalizeText(value)).filter(Boolean).join("|");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`party:${input.tenantId}:${lockKey||"new"}`]);
      const matches=await this.findDuplicatesWithClient(client,input);
      if(matches.length&&!input.duplicateOverride)throw new PartyDuplicateError(matches);
      await client.query("SELECT set_config('app.party_duplicate_override',$1,true)",[input.duplicateOverride?"on":"off"]);
      return (await client.query<{id:string}>("SELECT app.create_party_for_project($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id",[input.tenantId,input.projectId,input.kind,input.salutation??null,input.firstName??null,input.lastName??null,input.legalName??null,input.registrationNumber??null,input.email??null,input.phone??null,input.membershipId])).rows[0];
    });
  }
  async linkPartyToProject(input:{tenantId:string;userId:string;partyId:string;projectId:string;membershipId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{id:string}>("SELECT app.link_party_to_project($1,$2,$3,$4) id",[input.tenantId,input.partyId,input.projectId,input.membershipId])).rows[0]);}
  async archiveImpact(input:{tenantId:string;userId:string;partyId:string;membershipId:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{impact:Record<string,number|string>}>("SELECT app.party_archive_impact($1,$2,$3) impact",[input.tenantId,input.partyId,input.membershipId])).rows[0]?.impact??{});}
  async archiveParty(input:{tenantId:string;userId:string;partyId:string;membershipId:string;reason:string}){return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>(await client.query<{outcome:{mode:"delete"|"archive";impact:Record<string,number>}}>("SELECT app.remove_or_archive_party($1,$2,$3,$4) outcome",[input.tenantId,input.partyId,input.membershipId,input.reason])).rows[0]?.outcome);}

  private async findDuplicatesWithClient(client:SqlClient,input:{tenantId:string;membershipId:string;projectId:string;kind:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string}):Promise<PartyDuplicateMatch[]>{
    const permission=await client.query<{allowed:boolean}>("SELECT app.has_project_permission($1,$2,$3,'clients.create') allowed",[input.tenantId,input.membershipId,input.projectId]);
    if(!permission.rows[0]?.allowed)throw new Error("clients.create permission required");
    const email=normalizeEmail(input.email),phone=normalizePhone(input.phone),registration=normalizeRegistration(input.registrationNumber);
    const name=normalizeText(input.kind==="organization"?input.legalName:[input.firstName,input.lastName].filter(Boolean).join(" "));
    const rows=await client.query<{id:string;display_name:string;party_type:string;email:string|null;phone:string|null;registration_number:string|null;projects:string[];units:string[]}>(
      `SELECT party.id,party.display_name,party.party_type,email.value email,phone.value phone,organization.registration_number,
        COALESCE(projects.items,ARRAY[]::text[]) projects,COALESCE(units.items,ARRAY[]::text[]) units
       FROM parties party
       LEFT JOIN party_organization_details organization ON organization.tenant_id=party.tenant_id AND organization.party_id=party.id
       LEFT JOIN LATERAL(SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id AND contact_type='email' AND archived_at IS NULL AND app.can_access_party(party.tenant_id,$2,party.id,true) ORDER BY is_primary DESC,created_at LIMIT 1) email ON true
       LEFT JOIN LATERAL(SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id AND contact_type='phone' AND archived_at IS NULL AND app.can_access_party(party.tenant_id,$2,party.id,true) ORDER BY is_primary DESC,created_at LIMIT 1) phone ON true
       LEFT JOIN LATERAL(SELECT array_agg(DISTINCT project.name ORDER BY project.name) items FROM party_project_links link JOIN projects project ON project.tenant_id=link.tenant_id AND project.id=link.project_id WHERE link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.valid_to IS NULL AND app.has_project_permission(link.tenant_id,$2,link.project_id,'clients.read')) projects ON true
       LEFT JOIN LATERAL(SELECT array_agg(DISTINCT unit.code ORDER BY unit.code) items FROM unit_interests interest JOIN units unit ON unit.tenant_id=interest.tenant_id AND unit.id=interest.unit_id WHERE interest.tenant_id=party.tenant_id AND interest.party_id=party.id AND app.has_project_permission(unit.tenant_id,$2,unit.project_id,'clients.read')) units ON true
       WHERE party.tenant_id=$1 AND party.archived_at IS NULL AND party.lifecycle_status='active'
         AND app.can_access_party(party.tenant_id,$2,party.id,false)
         AND (($3<>'' AND EXISTS(SELECT 1 FROM party_contacts contact WHERE contact.tenant_id=party.tenant_id AND contact.party_id=party.id AND contact.contact_type='email' AND contact.archived_at IS NULL AND lower(btrim(contact.value))=$3))
           OR ($4<>'' AND EXISTS(SELECT 1 FROM party_contacts contact WHERE contact.tenant_id=party.tenant_id AND contact.party_id=party.id AND contact.contact_type='phone' AND contact.archived_at IS NULL AND (CASE WHEN length(regexp_replace(contact.value,'[^0-9]','','g'))=9 THEN '420'||regexp_replace(contact.value,'[^0-9]','','g') ELSE regexp_replace(contact.value,'[^0-9]','','g') END)=$4))
           OR ($5<>'' AND regexp_replace(COALESCE(organization.registration_number,''),'[^0-9A-Za-z]','','g')=$5)
           OR ($6<>'' AND lower(regexp_replace(btrim(party.display_name),'\\s+',' ','g'))=$6))
       ORDER BY party.display_name`,[input.tenantId,input.membershipId,email,phone,registration,name]);
    return rows.rows.map(row=>{const reasons:string[]=[];if(email&&normalizeEmail(row.email)===email)reasons.push("Stejný e-mail");if(phone&&normalizePhone(row.phone)===phone)reasons.push("Stejný telefon");if(registration&&normalizeRegistration(row.registration_number)===registration)reasons.push("Stejné IČO");if(name&&normalizeText(row.display_name)===name)reasons.push("Stejné jméno nebo název");const strong=reasons.some(reason=>reason!=="Stejné jméno nebo název");return{id:row.id,name:row.display_name,kind:row.party_type==="individual"?"FO":"PO",strength:strong?"strong":"possible",reasons,email:row.email??"",phone:row.phone??"",projects:row.projects,units:row.units};});
  }

  async getDirectory(input: Context&{includeArchived?:boolean}): Promise<{ clients: ClientDirectoryItem[]; unitContexts: Record<string, UnitCommercialContext> }> {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const hasPartyScope=Boolean((await client.query("SELECT 1 FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='app' AND procedure.proname='can_access_party'")).rowCount);
      const archivedAccess="($3::boolean AND party.lifecycle_status='archived' AND EXISTS(SELECT 1 FROM party_project_links archive_link WHERE archive_link.tenant_id=party.tenant_id AND archive_link.party_id=party.id AND app.has_project_permission(party.tenant_id,$2,archive_link.project_id,'clients.archive')))";
      const partyAccess=hasPartyScope?`(app.can_access_party(party.tenant_id,$2,party.id,false) OR ${archivedAccess})`:"true";
      const partyContactAccess=hasPartyScope?`(app.can_access_party(party.tenant_id,$2,party.id,true) OR ${archivedAccess})`:"true";
      const partyRows = await client.query<{
        id: string; display_name: string; party_type: string; lifecycle_status:ClientDirectoryItem["lifecycleStatus"]; email: string | null; phone: string | null;first_name:string|null;last_name:string|null;legal_name:string|null;registration_number:string|null;vat_number:string|null;contact_person:string|null;address:ClientDirectoryItem["address"];updated_at:string;
        projects: Array<{ id: string; name: string }>; units: string[]; state: string; stage: string | null;
        interest_history: ClientDirectoryItem["interestHistory"];
      }>(
        `SELECT party.id,party.display_name,party.party_type,party.lifecycle_status,email.value AS email,phone.value AS phone,individual.first_name,individual.last_name,organization.legal_name,organization.registration_number,organization.vat_number,organization.contact_person,address.item address,party.updated_at,
          COALESCE(projects.items,'[]'::jsonb) projects,COALESCE(unit_rows.items,'[]'::jsonb) units,
          CASE WHEN stage.current_stage='handover' THEN 'Předáno'
               WHEN stage.current_stage IS NOT NULL AND stage.current_stage<>'interest' THEN 'Aktivní klient'
               ELSE 'Zájemce' END state,
          stage.current_stage,
          COALESCE(history.items,'[]'::jsonb) interest_history
         FROM parties party
         LEFT JOIN party_individual_details individual ON individual.tenant_id=party.tenant_id AND individual.party_id=party.id
         LEFT JOIN party_organization_details organization ON organization.tenant_id=party.tenant_id AND organization.party_id=party.id
         LEFT JOIN LATERAL (SELECT jsonb_build_object('line1',line1,'line2',line2,'city',city,'postalCode',postal_code,'countryCode',country_code,'addressType',address_type) item FROM party_addresses WHERE tenant_id=party.tenant_id AND party_id=party.id AND is_primary AND valid_to IS NULL
           AND ${partyContactAccess} ORDER BY created_at DESC LIMIT 1) address ON true
         LEFT JOIN LATERAL (SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id
           AND contact_type='email' AND archived_at IS NULL AND ${partyContactAccess} ORDER BY is_primary DESC,created_at LIMIT 1) email ON true
         LEFT JOIN LATERAL (SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id
           AND contact_type='phone' AND archived_at IS NULL AND ${partyContactAccess} ORDER BY is_primary DESC,created_at LIMIT 1) phone ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(DISTINCT jsonb_build_object('id',project.id,'name',project.name)) items
           FROM party_project_links link JOIN projects project ON project.tenant_id=link.tenant_id AND project.id=link.project_id
           WHERE link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.valid_to IS NULL AND project.archived_at IS NULL
             AND app.has_project_permission(link.tenant_id,$2,link.project_id,'clients.read')
         ) projects ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(DISTINCT unit.code ORDER BY unit.code) items
           FROM unit_interests interest JOIN units unit ON unit.tenant_id=interest.tenant_id AND unit.id=interest.unit_id
           WHERE interest.tenant_id=party.tenant_id AND interest.party_id=party.id AND unit.archived_at IS NULL
             AND EXISTS(SELECT 1 FROM projects active_project WHERE active_project.tenant_id=interest.tenant_id AND active_project.id=interest.project_id AND active_project.archived_at IS NULL)
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
           WHERE interest.tenant_id=party.tenant_id AND interest.party_id=party.id AND project.archived_at IS NULL AND unit.archived_at IS NULL
             AND app.has_project_permission(interest.tenant_id,$2,interest.project_id,'clients.read')
         ) history ON true
         WHERE party.tenant_id=$1 AND party.lifecycle_status<>'merged'
           AND ((party.archived_at IS NULL AND party.lifecycle_status<>'archived') OR $3::boolean)
           AND ${partyAccess}
           AND (projects.items IS NOT NULL OR history.items IS NOT NULL)
         ORDER BY party.display_name`,
        [input.tenantId,input.membershipId,Boolean(input.includeArchived)],
      );

      const hasContracts=Boolean((await client.query<{present:boolean}>("SELECT to_regclass('public.contracts') IS NOT NULL present")).rows[0]?.present);
      const contractColumns=hasContracts?"relevant_contract.contract_type,relevant_contract.current_status contract_status":"NULL::text contract_type,NULL::text contract_status";
      const contractJoin=hasContracts?`LEFT JOIN LATERAL (
           SELECT contract.contract_type,contract.current_status
           FROM contracts contract
           WHERE contract.tenant_id=$1 AND contract.unit_id=unit.id
             AND contract.current_status NOT IN ('cancelled','terminated')
             AND (EXISTS(SELECT 1 FROM contract_parties contract_party WHERE contract_party.tenant_id=contract.tenant_id AND contract_party.contract_id=contract.id AND contract_party.party_id=relation.party_id)
               OR EXISTS(SELECT 1 FROM sales_case_parties case_party WHERE case_party.tenant_id=contract.tenant_id AND case_party.sales_case_id=contract.sales_case_id AND case_party.party_id=relation.party_id AND case_party.left_at IS NULL))
           ORDER BY CASE contract.contract_type WHEN 'ks' THEN 3 WHEN 'sbk' THEN 2 WHEN 'rs' THEN 1 ELSE 0 END DESC,
             CASE contract.current_status WHEN 'signed' THEN 7 WHEN 'signing' THEN 6 WHEN 'approved' THEN 5 WHEN 'negotiation' THEN 4 WHEN 'sent' THEN 3 WHEN 'draft' THEN 2 ELSE 1 END DESC,
             contract.updated_at DESC LIMIT 1
         ) relevant_contract ON true`:"";
      const relationRows=await client.query<{party_id:string;unit_id:string;unit_code:string;project_id:string;project_name:string;contract_type:"rs"|"sbk"|"ks"|null;contract_status:string|null}>(
        `WITH party_units AS (
           SELECT DISTINCT interest.party_id,interest.unit_id,interest.project_id
           FROM unit_interests interest
           WHERE interest.tenant_id=$1
           UNION
           SELECT DISTINCT participant.party_id,sales_case.unit_id,sales_case.project_id
           FROM sales_case_parties participant
           JOIN sales_cases sales_case ON sales_case.tenant_id=participant.tenant_id AND sales_case.id=participant.sales_case_id
           WHERE participant.tenant_id=$1 AND participant.left_at IS NULL
         )
         SELECT relation.party_id,unit.id unit_id,unit.code unit_code,project.id project_id,project.name project_name,
           ${contractColumns}
         FROM party_units relation
         JOIN units unit ON unit.tenant_id=$1 AND unit.id=relation.unit_id AND unit.archived_at IS NULL
         JOIN projects project ON project.tenant_id=$1 AND project.id=relation.project_id AND project.archived_at IS NULL
         ${contractJoin}
         WHERE app.has_project_permission($1,$2,project.id,'clients.read')
         ORDER BY relation.party_id,project.name,unit.code`,[input.tenantId,input.membershipId]);
      const relationsByParty=new Map<string,ClientDirectoryItem["unitRelations"]>();
      for(const relation of relationRows.rows){const list=relationsByParty.get(relation.party_id)??[];list.push({unitId:relation.unit_id,code:relation.unit_code,projectId:relation.project_id,project:relation.project_name,contractType:relation.contract_type?.toUpperCase() as "RS"|"SBK"|"KS"|undefined,contractStatus:relation.contract_status??undefined});relationsByParty.set(relation.party_id,list);}

      const contextRows = await client.query<{
        unit_code: string;sales_case_id:string|null; buyers: UnitCommercialContext["buyers"]; interests: UnitCommercialContext["interests"];
        stage: string | null; hold: UnitCommercialContext["hold"];
      }>(
        `SELECT unit.code unit_code,active_case.id sales_case_id,active_case.current_stage stage,
          COALESCE(buyers.items,'[]'::jsonb) buyers,COALESCE(interests.items,'[]'::jsonb) interests,hold.item hold
         FROM units unit
         LEFT JOIN LATERAL (SELECT id,current_stage FROM sales_cases WHERE tenant_id=unit.tenant_id AND unit_id=unit.id AND status='active' LIMIT 1) active_case ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('partyId',party.id,'name',party.display_name,'email',COALESCE(email.value,''),
             'role',participant.participant_role,'share',participant.ownership_share) ORDER BY participant.is_primary DESC,party.display_name) items
           FROM sales_case_parties participant JOIN parties party ON party.tenant_id=participant.tenant_id AND party.id=participant.party_id
           LEFT JOIN LATERAL (SELECT value FROM party_contacts WHERE tenant_id=party.tenant_id AND party_id=party.id AND contact_type='email' AND archived_at IS NULL
             AND ${partyContactAccess} ORDER BY is_primary DESC LIMIT 1) email ON true
           WHERE participant.tenant_id=unit.tenant_id AND participant.sales_case_id=active_case.id AND participant.left_at IS NULL
             AND ${partyAccess}
         ) buyers ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('date',COALESCE(to_char(interest.first_interest_at,'DD. MM. YYYY'),'Datum neuvedeno'),'partyId',party.id,'name',party.display_name,
             'type',COALESCE(highest.label,CASE interest.status WHEN 'converted' THEN 'Obchodní proces' WHEN 'active' THEN 'Aktivní zájem' ELSE 'Ukončený zájem' END),
             'result',COALESCE(latest.outcome,CASE interest.status WHEN 'converted' THEN 'Pokračuje v obchodním procesu' WHEN 'active' THEN 'Aktivní' ELSE 'Bez realizace' END)) ORDER BY interest.first_interest_at DESC) items
           FROM unit_interests interest JOIN parties party ON party.tenant_id=interest.tenant_id AND party.id=interest.party_id
           LEFT JOIN LATERAL (SELECT outcome FROM interest_events event WHERE event.tenant_id=interest.tenant_id AND event.unit_interest_id=interest.id ORDER BY occurred_at DESC LIMIT 1) latest ON true
           LEFT JOIN LATERAL (SELECT CASE max(CASE event_type WHEN 'converted_to_sales_case' THEN 7 WHEN 'reservation_requested' THEN 6 WHEN 'pre_reservation_requested' THEN 5 WHEN 'offer' THEN 4 WHEN 'viewing' THEN 3 WHEN 'inquiry' THEN 2 ELSE 1 END) WHEN 7 THEN 'Převedeno do obchodního procesu' WHEN 6 THEN 'Rezervace' WHEN 5 THEN 'Předrezervace' WHEN 4 THEN 'Nabídka' WHEN 3 THEN 'Prohlídka' ELSE 'Zájem' END label FROM interest_events event WHERE event.tenant_id=interest.tenant_id AND event.unit_interest_id=interest.id) highest ON true
           WHERE interest.tenant_id=unit.tenant_id AND interest.unit_id=unit.id
             AND ${partyAccess}
         ) interests ON true
         LEFT JOIN LATERAL (SELECT jsonb_build_object('id',id,'type',hold_type,'expiresAt',expires_at) item FROM unit_holds
           WHERE tenant_id=unit.tenant_id AND unit_id=unit.id AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1) hold ON true
         WHERE unit.tenant_id=$1 AND unit.archived_at IS NULL
           AND EXISTS(SELECT 1 FROM projects active_project WHERE active_project.tenant_id=unit.tenant_id AND active_project.id=unit.project_id AND active_project.archived_at IS NULL)
           AND app.has_project_permission(unit.tenant_id,$2,unit.project_id,'sales_case.read')`,
        hasPartyScope?[input.tenantId,input.membershipId,Boolean(input.includeArchived)]:[input.tenantId,input.membershipId],
      );

      return {
        clients: partyRows.rows.map((row) => {
          const projectNames = row.projects.map((project) => project.name).sort();
          const email = row.email ?? ""; const phone = row.phone ?? "";
          const unitRelations=relationsByParty.get(row.id)??[];
          const bestContract=[...unitRelations].filter(item=>item.contractType).sort((left,right)=>contractTypeRank(right.contractType)-contractTypeRank(left.contractType)||contractStatusRank(right.contractStatus)-contractStatusRank(left.contractStatus))[0];
          return { id: row.id,name: row.display_name,type: row.party_type === "individual" ? "Fyzická osoba" : "Právnická osoba",
            kind: row.party_type === "individual" ? "FO" : "PO",email,phone,contact: [email,phone].filter(Boolean).join(" · "),
            units: unitRelations.map(item=>item.code),unitRelations,projects: projectNames.join(", "),projectNames,state: row.state,
            contractStatus: bestContract?.contractType ? `${bestContract.contractType}${bestContract.contractStatus?` · ${contractStatusLabel(bestContract.contractStatus)}`:""}` : "Bez smlouvy",initials: initials(row.display_name),interestHistory: row.interest_history,firstName:row.first_name??undefined,lastName:row.last_name??undefined,legalName:row.legal_name??undefined,registrationNumber:row.registration_number??undefined,vatNumber:row.vat_number??undefined,contactPerson:row.contact_person??undefined,address:row.address,updatedAt:row.updated_at,lifecycleStatus:row.lifecycle_status };
        }),
        unitContexts: Object.fromEntries(contextRows.rows.map((row) => [row.unit_code,{ salesCaseId:row.sales_case_id,buyers: row.buyers,interests: row.interests,stage: row.stage,hold: row.hold }])),
      };
    });
  }

  async getPage(input:Context&{page:number;pageSize:number;query?:string;quickProject?:string;types?:string[];projects?:string[];unit?:string;relations?:string[];contracts?:string[];phone?:string;email?:string;sort?:string;direction?:"asc"|"desc";includeArchived?:boolean}){
    const directory=await this.getDirectory(input);const includes=(value:string,query?:string)=>!query||value.toLocaleLowerCase("cs-CZ").includes(query.toLocaleLowerCase("cs-CZ"));
    const filtered=directory.clients.filter(item=>includes(item.name,input.query)&&(!input.quickProject||input.quickProject==="Všichni"||item.projectNames.includes(input.quickProject))&&(!input.types?.length||input.types.includes(item.kind))&&(!input.projects?.length||input.projects.some(project=>item.projectNames.includes(project)))&&includes(item.units.join(" "),input.unit)&&(!input.relations?.length||input.relations.includes(item.lifecycleStatus==="archived"?"Archivovaný":item.state))&&(!input.contracts?.length||input.contracts.some(status=>item.contractStatus.startsWith(status)))&&includes(item.phone,input.phone)&&includes(item.email,input.email));
    const value=(item:ClientDirectoryItem)=>input.sort==="updated"?item.updatedAt??"":input.sort==="relation"?item.state:input.sort==="contract"?item.contractStatus:input.sort==="project"?item.projectNames.join(" "):input.sort==="unit"?item.units.join(" "):item.name;
    filtered.sort((left,right)=>{const compared=String(value(left)).localeCompare(String(value(right)),"cs",{numeric:true,sensitivity:"base"});return (input.direction==="desc"?-compared:compared)||left.id.localeCompare(right.id);});
    const total=filtered.length;const page=Math.max(1,Math.min(input.page,Math.max(1,Math.ceil(total/input.pageSize))));return{clients:filtered.slice((page-1)*input.pageSize,page*input.pageSize),total,page,pageSize:input.pageSize};
  }

  async exportContacts(input: Context & { partyIds?: string[] }): Promise<ClientDirectoryItem[]> {
    const directory = await this.getDirectory(input);
    return this.database.withContext({ tenantId: input.tenantId,userId: input.userId }, async (client) => {
      const hasPartyScope=Boolean((await client.query("SELECT 1 FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='app' AND procedure.proname='can_access_party'")).rowCount);
      const allowed = await client.query<{ id: string }>(
        `SELECT DISTINCT party.id FROM parties party JOIN party_project_links link ON link.tenant_id=party.tenant_id AND link.party_id=party.id AND link.valid_to IS NULL
         JOIN projects project ON project.tenant_id=link.tenant_id AND project.id=link.project_id
         WHERE party.tenant_id=$1 AND party.archived_at IS NULL AND project.archived_at IS NULL
           AND app.has_project_permission(link.tenant_id,$2,link.project_id,'${hasPartyScope?"exports.run":"clients.export"}')
           AND ${hasPartyScope?"app.can_access_party(party.tenant_id,$2,party.id,true)":"true"}
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
function contractTypeRank(type?:"RS"|"SBK"|"KS"){return type==="KS"?3:type==="SBK"?2:type==="RS"?1:0;}
function contractStatusRank(status?:string){return ({signed:7,signing:6,approved:5,negotiation:4,sent:3,draft:2} as Record<string,number>)[status??""]??0;}
function contractStatusLabel(status:string){return ({signed:"Podepsána",signing:"K podpisu",approved:"Schválena",negotiation:"Ve vyjednávání",sent:"Odeslána",draft:"V přípravě"} as Record<string,string>)[status]??"";}
function normalizeText(value?:string|null){return (value??"").trim().replace(/\s+/g," ").toLocaleLowerCase("cs-CZ");}
function normalizeEmail(value?:string|null){return (value??"").trim().toLowerCase();}
function normalizePhone(value?:string|null){const digits=(value??"").replace(/\D/g,"");return digits.startsWith("00")?digits.slice(2):digits.startsWith("420")?digits:digits.length===9?`420${digits}`:digits;}
function normalizeRegistration(value?:string|null){return (value??"").replace(/[^0-9A-Za-z]/g,"").toUpperCase();}
export class PartyDuplicateError extends Error{constructor(public readonly matches:PartyDuplicateMatch[]){super("party duplicate confirmation required");this.name="PartyDuplicateError";}}
