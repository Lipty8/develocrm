import {createHash} from "node:crypto";
import type {PoolClient} from "pg";

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceHash="4230af6fb82b8de020240f96cadf0e3f1956f93c11b1ecde983d180e3902d2e9";

export type DejviceImportCounts={
  projects:number;units:number;accessories:number;parties:number;
  interests:number;salesCases:number;contracts:number;unitPrices:number;
};
export type DejviceImportReport={
  dryRun:boolean;tenantId:string;membershipId:string;sourceHash:string;
  before:DejviceImportCounts;after:DejviceImportCounts;created:DejviceImportCounts;
  warnings:string[];
};

export function renderDejviceImport(source:string,input:{tenantId:string;membershipId:string}):string{
  if(!uuidPattern.test(input.tenantId)||!uuidPattern.test(input.membershipId))throw new Error("Import vyžaduje platný tenant UUID a membership UUID");
  if(!source.includes(`SHA-256 ${sourceHash}`))throw new Error("Neočekávaná verze zdrojového importu Rezidence Dejvice");
  let sql=source.replace(/\{\{TENANT_ID\}\}/g,input.tenantId).replace(/\{\{IMPORTER_MEMBERSHIP_ID\}\}/g,input.membershipId);
  sql=sql.replace(/(^|\n)\s*BEGIN;\s*/i,"$1").replace(/\s*COMMIT;\s*$/i,"");
  const mappings=new Map<string,string>();
  sql=sql.replace(/\bde[0-9a-f]{6}-0000-4000-8000-[0-9]{12}\b/gi,value=>{
    let mapped=mappings.get(value);
    if(!mapped){mapped=deterministicUuid(`${input.tenantId}:${value.toLowerCase()}`);mappings.set(value,mapped);}
    return mapped;
  });
  sql=sql.replace(/'(de[0-9a-f]{6}-0000-4000-8000-)'(\|\|lpad)/gi,(_match,prefix:string,suffix:string)=>{
    const mapped=deterministicUuid(`${input.tenantId}:${prefix}`).slice(0,24);
    return`'${mapped}'${suffix}`;
  });
  if(sql.includes("{{"))throw new Error("Importní šablona obsahuje nevyplněný parametr");
  return sql;
}

export async function importDejvice(client:PoolClient,source:string,input:{tenantId:string;membershipId:string;dryRun:boolean}):Promise<DejviceImportReport>{
  if(!uuidPattern.test(input.tenantId)||!uuidPattern.test(input.membershipId))throw new Error("Neplatné importní identifikátory");
    await client.query("BEGIN");
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`develocrm:dejvice-import:${input.tenantId}`]);
    await client.query("SELECT set_config('app.tenant_id',$1,true)",[input.tenantId]);
    const membership=await client.query(`SELECT membership.user_id FROM tenant_memberships membership
      WHERE membership.tenant_id=$1 AND membership.id=$2 AND membership.status='active' AND membership.archived_at IS NULL`,
      [input.tenantId,input.membershipId]);
    if(!membership.rows.length)throw new Error("Importer není aktivním členem cílového workspace");
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id','',true)",[input.tenantId]);
    const before=await importCounts(client,input.tenantId);
    await client.query(renderDejviceImport(source,input));
    const after=await importCounts(client,input.tenantId);
    if(after.projects!==1||after.units!==19||after.accessories!==48||after.unitPrices!==19)
      throw new Error(`Validace importu selhala: očekáváno 1/19/48/19, získáno ${after.projects}/${after.units}/${after.accessories}/${after.unitPrices}`);
    await client.query("SELECT set_config('app.user_id',$1,true)",[membership.rows[0].user_id]);
    const audit=await client.query("SELECT 1 FROM audit_log WHERE tenant_id=$1 AND action='pilot.dejvice_imported' AND entity_id=(SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ' AND archived_at IS NULL)",[input.tenantId]);
    if(!audit.rows.length){
      await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
        SELECT $1,$2,'pilot.dejvice_imported','project',project.id,jsonb_build_object('sourceHash',$3::text,'units',19)
        FROM projects project WHERE project.tenant_id=$1 AND project.code='DEJ' AND project.archived_at IS NULL`,
        [input.tenantId,membership.rows[0].user_id,sourceHash]);
      await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
        SELECT $1,'project',project.id,'pilot.dejvice_imported.v1',jsonb_build_object('sourceHash',$2::text)
        FROM projects project WHERE project.tenant_id=$1 AND project.code='DEJ' AND project.archived_at IS NULL`,
        [input.tenantId,sourceHash]);
    }
    const report={dryRun:input.dryRun,tenantId:input.tenantId,membershipId:input.membershipId,sourceHash,before,after,created:subtract(after,before),
      warnings:["Import zachovává neověřené historické případy bez aktivního holdu.","Fyzické dokumenty nejsou součástí tabulkového importu."]};
    await client.query(input.dryRun?"ROLLBACK":"COMMIT");
    return report;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
}

async function importCounts(client:PoolClient,tenantId:string):Promise<DejviceImportCounts>{
  const result=await client.query<Record<keyof DejviceImportCounts,number>>(`WITH project AS(
      SELECT id FROM projects WHERE tenant_id=$1 AND code='DEJ' AND archived_at IS NULL
    ) SELECT
      (SELECT count(*)::int FROM project) projects,
      (SELECT count(*)::int FROM units WHERE tenant_id=$1 AND project_id IN(SELECT id FROM project) AND archived_at IS NULL) units,
      (SELECT count(*)::int FROM accessories WHERE tenant_id=$1 AND project_id IN(SELECT id FROM project) AND archived_at IS NULL) accessories,
      (SELECT count(*)::int FROM party_external_identifiers WHERE tenant_id=$1 AND source_system='rezidence_dejvice_excel') parties,
      (SELECT count(*)::int FROM unit_interests WHERE tenant_id=$1 AND project_id IN(SELECT id FROM project)) interests,
      (SELECT count(*)::int FROM sales_cases WHERE tenant_id=$1 AND project_id IN(SELECT id FROM project)) "salesCases",
      (SELECT count(*)::int FROM contracts WHERE tenant_id=$1 AND project_id IN(SELECT id FROM project)) contracts,
      (SELECT count(*)::int FROM unit_price_history WHERE tenant_id=$1 AND project_id IN(SELECT id FROM project)) "unitPrices"`,[tenantId]);
  return result.rows[0];
}
function subtract(after:DejviceImportCounts,before:DejviceImportCounts):DejviceImportCounts{
  return Object.fromEntries(Object.keys(after).map(key=>[key,after[key as keyof DejviceImportCounts]-before[key as keyof DejviceImportCounts]])) as DejviceImportCounts;
}
function deterministicUuid(value:string):string{
  const bytes=createHash("sha256").update(value).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString("hex");return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
