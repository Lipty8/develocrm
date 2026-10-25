// Explicit operator run only. Uses the existing domain edit operation, never an
// import or a direct area UPDATE. No API/scheduler entrypoint imports this file.
import {Database} from '../dist/database.js';
export const AREA_APPROVAL='adam-2026-10-25-current-catalogue-areas';
export const AREA_SCOPE={tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50'};
export const AREA_MANIFEST=[
  ['101',101.82,93.60,102.67,93.88],['102',73.53,67.51,74.56,67.51],['103',128.27,117.80,130.83,116.66],['104',126.82,119.65,128.00,118.70],
  ['205',106.32,99.05,106.93,98.77],['206',60.64,57.06,61.13,57.14],['207',104.63,94.93,105.53,95.23],['208',116.65,108.84,118.76,109.34],
  ['209',72.10,67.08,73.55,67.58],['210',119.46,109.47,120.24,109.76],['311',130.89,119.87,131.75,119.87],['312',47.30,44.52,47.84,44.24],
  ['313',101.11,92.64,102.99,92.36],['314',54.37,51.13,54.73,51.33],['315',110.54,102.99,111.60,103.02],['316',88.12,83.65,88.44,83.94],
  ['417',123.44,114.30,125.26,114.39],['418',64.35,60.76,64.75,60.76],['519',172.58,161.72,172.95,159.71],
];
const protectedTables=['unit_price_history','accessory_price_history','unit_accessory_assignments','contracts','contract_versions','contract_documents',
  'documents','document_versions','document_generation_operations','payment_obligations','payment_transactions','payment_allocations','payment_refunds','sales_cases'];
const fail=code=>{throw new Error(code);};
export function planAreaUpdates(rows,manifest=AREA_MANIFEST){
  if(rows.length!==manifest.length||new Set(rows.map(r=>r.code)).size!==rows.length)fail('AREA_EXACT_UNIT_SET_REQUIRED');
  return manifest.map(([code,oldArea,oldUsable,area,usable])=>{
    const row=rows.find(r=>r.code===code);if(!row||row.archived_at)fail('AREA_EXACT_UNIT_SET_REQUIRED');
    const matches=(a,u)=>row.area_m2!==null&&row.usable_area_m2!==null&&Number(row.area_m2)===a&&Number(row.usable_area_m2)===u;
    const alreadyApplied=matches(area,usable);
    if(!alreadyApplied&&!matches(oldArea,oldUsable))fail('AREA_CONCURRENT_OR_UNEXPECTED_VALUE');
    return{row,area,usable,alreadyApplied};
  });
}
export function assertOnlyAreasChanged(before,after){
  const stable=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['area_m2','usable_area_m2','updated_at'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
  if(JSON.stringify(stable(before))!==JSON.stringify(stable(after)))fail('AREA_NON_AREA_FIELD_CHANGED');
}
export function assertAreaInput(input){
  if(!['verify','apply'].includes(input.mode)||input.tenantId!==AREA_SCOPE.tenantId||input.projectId!==AREA_SCOPE.projectId)fail('AREA_EXACT_SCOPE_REQUIRED');
  if(input.mode==='apply'&&input.approvalReference!==AREA_APPROVAL)fail('AREA_EXPLICIT_APPROVAL_REQUIRED');
  if(!/^[a-f0-9-]{36}$/i.test(input.membershipId??''))fail('AREA_ACTOR_REQUIRED');
  if(Object.keys(input.sourceHashes??{}).length!==AREA_MANIFEST.length||AREA_MANIFEST.some(([code])=>!/^sha256:[a-f0-9]{64}$/.test(input.sourceHashes?.[code]??'')))fail('AREA_SOURCE_MANIFEST_REQUIRED');
}
export async function reconcileAreas(input){
  assertAreaInput(input);
  const database=input.database??new Database(input.databaseUrl);
  try{
    const actor=await database.withContext({tenantId:input.tenantId},async c=>(await c.query("SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",[input.tenantId,input.membershipId])).rows[0],{readOnly:true});
    if(!actor)fail('AREA_ACTIVE_ACTOR_REQUIRED');
    const context={tenantId:input.tenantId,userId:actor.user_id};
    return await database.withContext(context,async c=>{
      const parameters=[input.tenantId,input.projectId];
      const safe=(await c.query("SELECT NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,'develocrm_app','member') safe,app.has_project_permission($1,$3,$2,'unit.manage') allowed FROM pg_roles WHERE rolname=current_user",[...parameters,input.membershipId])).rows[0];
      if(!safe?.safe||!safe.allowed)fail('AREA_RUNTIME_ROLE_AND_PERMISSION_REQUIRED');
      const scoped=(await c.query('SELECT id,code FROM units WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL ORDER BY id',parameters)).rows;
      if(scoped.length!==AREA_MANIFEST.length||scoped.some(row=>!AREA_MANIFEST.some(([code])=>row.code===code)))fail('AREA_EXACT_UNIT_SET_REQUIRED');
      if(input.mode==='apply')for(const row of scoped)await c.query('SELECT app.lock_workflow_unit($1,$2)',[input.tenantId,row.id]);
      const load=async()=>(await c.query(`SELECT to_jsonb(u) data FROM units u WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL ORDER BY id${input.mode==='apply'?' FOR UPDATE':''}`,parameters)).rows.map(r=>r.data);
      const before=await load(),plan=planAreaUpdates(before),changes=plan.filter(p=>!p.alreadyApplied);
      if(input.mode==='verify')return{mode:input.mode,readOnly:true,total:plan.length,pending:changes.length,alreadyApplied:plan.length-changes.length};
      if(!changes.length)return{mode:input.mode,total:plan.length,changed:0,replayed:true};
      const fingerprint=async()=>{
        const result={};for(const table of protectedTables)result[table]=(await c.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) hash FROM ${table} t WHERE tenant_id=$1 AND project_id=$2`,parameters)).rows[0].hash;
        return result;
      };
      const protectedBefore=await fingerprint();
      const ids=changes.map(p=>p.row.id);
      const counts=async()=>(await c.query(`SELECT
        (SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[]) AND action='unit.updated') audits,
        (SELECT count(*)::int FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=ANY($2::uuid[]) AND event_type='unit.updated.v2') events`,[input.tenantId,ids])).rows[0];
      const oldCounts=await counts();
      for(const {row,area,usable}of changes){
        const result=(await c.query('SELECT app.update_unit_details_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) id',
          [input.tenantId,row.id,row.structure_id,row.layout,row.floor_label,row.floor_number,area,usable,row.orientation,row.balcony_m2,row.terrace_m2,row.garden_m2,input.membershipId])).rows[0];
        if(result?.id!==row.id)fail('AREA_DOMAIN_RESULT_MISMATCH');
      }
      const after=await load();
      if(planAreaUpdates(after).some(p=>!p.alreadyApplied))fail('AREA_PERSISTENCE_MISMATCH');
      for(const row of before)assertOnlyAreasChanged(row,after.find(item=>item.id===row.id));
      if(JSON.stringify(protectedBefore)!==JSON.stringify(await fingerprint()))fail('AREA_PROTECTED_HISTORY_CHANGED');
      const newCounts=await counts();
      if(newCounts.audits-oldCounts.audits!==changes.length||newCounts.events-oldCounts.events!==changes.length)fail('AREA_AUDIT_OUTBOX_MISMATCH');
      const evidence={approvalReference:input.approvalReference,source:'approved current unit catalogue PDFs',sourceHashes:input.sourceHashes,
        changed:changes.map(p=>({unitId:p.row.id,code:p.row.code,before:{area:p.row.area_m2,usable:p.row.usable_area_m2},after:{area:p.area,usable:p.usable}})),protectedTablesUnchanged:protectedTables};
      await c.query("INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'unit.catalogue_areas_reconciled','project',$3,$4::jsonb)",[input.tenantId,actor.user_id,input.projectId,JSON.stringify(evidence)]);
      return{mode:input.mode,total:plan.length,changed:changes.length,unitCodes:changes.map(p=>p.row.code),unitAudits:changes.length,outboxEvents:changes.length,protectedTablesUnchanged:protectedTables.length,replayed:false};
    },input.mode==='verify'?{readOnly:true}:undefined);
  }finally{if(!input.database)await database.close();}
}
