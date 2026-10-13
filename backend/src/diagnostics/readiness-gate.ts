import type {Database} from '../database.js';
import type {DocumentContext} from '../documents/repository.js';
import type {GraphTokenProvider,MicrosoftGraphAdapter} from '../documents/graph-adapter.js';
import {ConsistencyChecker,type ConsistencyReport} from './consistency-checker.js';

export type GateCheck={code:string;passed:boolean;detail:string};
export function decideReadiness(checks:GateCheck[],report:ConsistencyReport){
 const blockers=checks.filter(c=>!c.passed).map(c=>c.code);
 if(!report.complete)blockers.push('CONSISTENCY_COVERAGE_INCOMPLETE');
 if(report.physicalEvidence!=='verified')blockers.push('PHYSICAL_EVIDENCE_UNVERIFIED');
 if(report.summary.critical)blockers.push('CRITICAL_INCONSISTENCY');
 return{ready:blockers.length===0,blockers:[...new Set(blockers)],legacyExceptions:report.summary.legacy,warnings:report.summary.warning};
}

/** Operator-only release gate. No writes, no migrations, no Graph grants. */
export async function runReadinessGate(deps:{database:Database;graph:MicrosoftGraphAdapter;tokens:GraphTokenProvider;identityClientId:string},
 input:DocumentContext&{expectedMigrations:Array<{filename:string;checksum:string}>;apiOrigin:string;frontendCompatibilityVerified:boolean}){
 const checker=new ConsistencyChecker(deps.database,deps.graph,deps.identityClientId);
 const report=await checker.run({...input,physical:true}); // authorize before touching any deployment metadata
 const checks:GateCheck[]=[];
 const state=await deps.database.withContext(input,async client=>{
  const migrations=(await client.query<{filename:string;checksum:string}>('SELECT filename,checksum FROM schema_migrations ORDER BY filename')).rows;
  const connections=(await client.query<{site_id:string;drive_id:string;credential_reference:string;entra_tenant_id:string}>(`
   SELECT site_id,drive_id,credential_reference,entra_tenant_id FROM sharepoint_connections
   WHERE tenant_id=$1 AND archived_at IS NULL AND authentication_mode='managed_identity' AND connection_status='connected'`,[input.tenantId])).rows;
  const rsTemplates=(await client.query<{count:number}>(`SELECT count(*)::int count FROM document_template_versions tv
   JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id JOIN projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id
   WHERE tv.tenant_id=$1 AND t.contract_type='rs' AND t.status='active' AND p.archived_at IS NULL
   AND tv.approval_status='approved' AND tv.effective_from<=CURRENT_DATE
   AND app.has_project_permission($1,$2,tv.project_id,'documents.read')`,[input.tenantId,input.membershipId])).rows[0].count;
  return{migrations,connections,rsTemplates};
 },{readOnly:true});
 const same=state.migrations.length===input.expectedMigrations.length&&input.expectedMigrations.every(m=>state.migrations.some(a=>a.filename===m.filename&&a.checksum===m.checksum));
 checks.push({code:'MIGRATIONS_CURRENT',passed:same,detail:same?'Migrace a otisky odpovídají release.':'Schéma neodpovídá release manifestu.'});
 for(const path of ['/health','/ready']){
  let passed=false;try{const origin=new URL(input.apiOrigin);if(origin.protocol!=='https:'&&origin.hostname!=='localhost')throw new Error('invalid origin');
   const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(10000),redirect:'error'});passed=response.status===200;
  }catch{/* safe diagnostic only */}
  checks.push({code:path==='/health'?'BACKEND_HEALTH':'BACKEND_READY',passed,detail:passed?'Backend je dostupný.':'Backend neprošel kontrolou dostupnosti.'});
 }
 let selected=false;
 try{
  // Claims are diagnostics from the Azure MI provider, never a substitute for a Graph request.
  const token=await deps.tokens.getAccessToken();const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  selected=Array.isArray(claims.roles)&&claims.roles.includes('Sites.Selected')&&!claims.roles.some((role:string)=>/^(Sites|Files)\..*\.All$/.test(role))
   &&state.connections.every(c=>c.entra_tenant_id===claims.tid)&&(claims.appid??claims.azp)===deps.identityClientId;
 }catch{/* never log tokens or raw claims */}
 checks.push({code:'GRAPH_SITES_SELECTED',passed:selected,detail:selected?'Spravovaná identita používá omezený přístup.':'Omezený Graph přístup nebyl potvrzen.'});
 let connected=state.connections.length>0;
 for(const c of state.connections){try{
  if(c.credential_reference!==`managed-identity://${deps.identityClientId}`)throw new Error('identity mismatch');
  const site=await deps.graph.getSite(c.site_id);const drives=await deps.graph.listSiteDrives(c.site_id);
  if(!site||!drives.some(d=>d.id===c.drive_id))throw new Error('configured library unavailable');
  await deps.graph.listFiles({siteId:c.site_id,driveId:c.drive_id});
 }catch{connected=false;}}
 checks.push({code:'SHAREPOINT_READ',passed:connected,detail:connected?'Nakonfigurované knihovny jsou dostupné.':'SharePoint knihovnu nelze ověřit.'});
 checks.push({code:'APPROVED_RS_TEMPLATE',passed:state.rsTemplates>0,detail:state.rsTemplates>0?'Existuje účinná schválená RS šablona.':'Chybí účinná schválená RS šablona.'});
 checks.push({code:'RS_FRONTEND_COMPATIBILITY',passed:input.frontendCompatibilityVerified,detail:input.frontendCompatibilityVerified?'Matching UI bylo ověřeno autentizovaným smoke testem.':'Chybí doložený matching UI smoke test.'});
 return{...decideReadiness(checks,report),checks,report};
}
