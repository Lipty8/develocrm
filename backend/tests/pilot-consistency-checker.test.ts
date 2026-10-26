import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ConsistencyChecker,classifyFact,consistencyFactsSql,physicalEvidenceSql,type Fact} from '../src/diagnostics/consistency-checker.js';
import type {Database} from '../src/database.js';
import type {MicrosoftGraphAdapter} from '../src/documents/graph-adapter.js';
import {snapshotHash} from '../src/shared/snapshot-integrity.js';

const ctx={tenantId:'tenant-a',userId:'admin-a',membershipId:'member-a'};
const fact:Fact={project_id:'project-a',entity_type:'contract_version',entity_id:'version-a',label:'RS-TECH',code:'SIGNED_EVIDENCE_MISSING',details:{contractId:'contract-a',signedAt:'2026-01-01T10:00:00.000Z'}};
const baseline=[{tenantId:'tenant-a',projectId:'project-a',versionId:'version-a',contractId:'contract-a',signedAt:'2026-01-01T10:00:00Z'}];
test('missing evidence is critical unless an exact reviewed legacy fingerprint matches',()=>{
 assert.equal(classifyFact(fact,ctx.tenantId,'run',[]).severity,'critical');
 assert.equal(classifyFact(fact,ctx.tenantId,'run',baseline).severity,'legacy');
 assert.equal(classifyFact({...fact,entity_id:'new-version'},ctx.tenantId,'run',baseline).severity,'critical');
 assert.equal(classifyFact({...fact,details:{...fact.details,signedAt:'2026-02-01T10:00:00Z'}},ctx.tenantId,'run',baseline).severity,'critical');
 assert.equal(classifyFact({...fact,details:{...fact.details,contractId:'different'}},ctx.tenantId,'run',baseline).severity,'critical');
 assert.equal(classifyFact(fact,'tenant-b','run',baseline).severity,'critical');
 assert.equal(classifyFact({...fact,project_id:'project-b'},ctx.tenantId,'run',baseline).severity,'critical');
});
function fixture(options:{authorized?:boolean;projects?:Array<{id:string;allowed:boolean}>;files?:object[];facts?:Fact[];generations?:object[]}={}){
 const queries:string[]=[];let readOnly=false;
 const database={withContext:async(context:typeof ctx,work:(c:unknown)=>Promise<unknown>,opts:{readOnly?:boolean})=>{
  assert.equal(context.tenantId,ctx.tenantId);assert.equal(context.userId,ctx.userId);assert.equal(context.membershipId,ctx.membershipId);readOnly=opts?.readOnly===true;
  return work({query:async(sql:string,parameters:unknown[])=>{
   queries.push(sql);
   assert(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(sql));
   if(sql.startsWith('SET LOCAL'))return{rows:[],rowCount:0};
   assert.equal(parameters[0],ctx.tenantId);
   if(sql.includes('FROM tenant_memberships'))return{rows:options.authorized===false?[]:[{authorized:true}],rowCount:options.authorized===false?0:1};
   if(sql===consistencyFactsSql)return{rows:options.facts??[],rowCount:0};
   if(sql.includes('FROM projects WHERE'))return{rows:options.projects??[{id:'project-a',allowed:true}],rowCount:1};
   if(sql===physicalEvidenceSql)return{rows:options.files??[],rowCount:0};
   if(sql.includes('FROM document_generation_operations'))return{rows:options.generations??[],rowCount:0};
   throw new Error('Unexpected query');
  }});
 }} as unknown as Database;
 return{database,queries,isReadOnly:()=>readOnly};
}
test('checker is repeatable, read-only and does not write audit/outbox/business rows',async()=>{
 const f=fixture({facts:[fact]});const checker=new ConsistencyChecker(f.database);
 const first=await checker.run(ctx),second=await checker.run(ctx);
 assert(f.isReadOnly());assert.equal(first.summary.critical,1);assert.equal(second.summary.critical,1);
 assert.notEqual(first.runId,second.runId);assert.equal(first.physicalEvidence,'not_checked');
});
test('without active system permission nothing is enumerated',async()=>{
 const f=fixture({authorized:false});await assert.rejects(new ConsistencyChecker(f.database).run(ctx),/permission/);
 assert.equal(f.queries.length,2);
});
test('partial project permissions cannot produce a complete release gate',async()=>{
 const f=fixture({projects:[{id:'a',allowed:true},{id:'b',allowed:false}]});
 const result=await new ConsistencyChecker(f.database).run(ctx);assert.equal(result.complete,false);assert.equal(result.projectsChecked,1);
});
test('tenant/project scope is parameterized in every fact query',()=>{
 assert.match(consistencyFactsSql,/tenant_id=\$1/);assert.match(consistencyFactsSql,/\$3::uuid/);
 for(const permission of ['unit.read','contract.read','documents.read','price.read'])assert(consistencyFactsSql.includes(permission));
 for(const invariant of ['SIGNED_EVIDENCE_MISSING','RS_RESERVATION_INCONSISTENT','AVAILABLE_WITH_HOLD','MULTIPLE_ACTIVE_HOLDS','INITIAL_PRICE_DUPLICATED','GENERATION_SNAPSHOT_MISMATCH'])assert(consistencyFactsSql.includes(invariant));
});
test('canonical generation checksums detect changes; old serializer limits remain explicit warnings',async()=>{
 const snapshot={'project.name':'TECH','unit.code':'1'};
 const g={id:'g',project_id:'project-a',generation_snapshot:snapshot,snapshot_hash:snapshotHash(snapshot),snapshot_hash_scheme:'canonical-json-v1',legacy_pre_enforcement:true};
 for(const [generation,critical,warning] of [[g,0,0],[{...g,generation_snapshot:{...snapshot,'unit.code':'2'}},1,0],[{...g,snapshot_hash_scheme:'legacy-json'},0,1],[{...g,snapshot_hash_scheme:'legacy-json',legacy_pre_enforcement:false},1,0]] as const){
  const f=fixture({generations:[generation]});const report=await new ConsistencyChecker(f.database).run(ctx);
  assert.equal(report.summary.critical,critical);assert.equal(report.summary.warning,warning);
  assert(!JSON.stringify(report).includes('project.name'));
 }
});
test('physical checks use pinned native version and never expose storage keys',async()=>{
 const bytes=Buffer.from('technical proof');const hash=`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
 const f=fixture({files:[{project_id:'a',entity_id:'version-a',entity_type:'contract_version',label:'RS',hash,drive_id:'private-drive',item_id:'private-item',version_id:'1.0',site_id:'private-site',configured:true}]});
 const graph={downloadFile:async(connection:unknown,item:string,version:string)=>{assert.equal(item,'private-item');assert.equal(version,'1.0');return bytes;}} as unknown as MicrosoftGraphAdapter;
 const report=await new ConsistencyChecker(f.database,graph,'mi').run({...ctx,physical:true});
 assert.equal(report.physicalEvidence,'verified');assert.equal(report.summary.critical,0);assert(!JSON.stringify(report).includes('private-item'));
});
test('Graph failure and hash mismatch fail closed, without raw errors',async()=>{
 const files=[{project_id:'a',entity_id:'v',entity_type:'contract_version',label:'RS',hash:'wrong',drive_id:'secret',item_id:'secret',version_id:'1.0',site_id:'secret',configured:true}];
 for(const fail of [false,true]){
  const f=fixture({files});const graph={downloadFile:async()=>{if(fail)throw new Error('403 secret details');return Buffer.from('data');}} as unknown as MicrosoftGraphAdapter;
  const report=await new ConsistencyChecker(f.database,graph,'mi').run({...ctx,physical:true});
  assert.equal(report.summary.critical,1);assert(!JSON.stringify(report).includes('secret'));
  assert.equal(report.findings[0].code,fail?'PHYSICAL_DOCUMENT_UNVERIFIED':'PHYSICAL_DOCUMENT_HASH_MISMATCH');
  assert.equal(report.physicalEvidence,'incomplete');
 }
});

test('older upload hash discrepancy stays visible but never excuses a physical template mismatch',async()=>{
 const metadata:Fact={...fact,entity_type:'template_version',code:'TEMPLATE_UPLOAD_HASH_DIFFERENT',details:{}};
 assert.equal(classifyFact(metadata,ctx.tenantId,'run').severity,'warning');
 assert.equal(classifyFact({...metadata,code:'APPROVED_TEMPLATE_HASH_MISMATCH'},ctx.tenantId,'run').severity,'critical');
 const files=[{project_id:'a',entity_id:'template-v',entity_type:'template_version',label:'Technical',hash:`sha256:${'a'.repeat(64)}`,
   drive_id:'private-drive',item_id:'private-item',version_id:'1.0',site_id:'private-site',configured:true}];
 const f=fixture({facts:[metadata],files});
 const graph={downloadFile:async()=>Buffer.from('unexpected source bytes')} as unknown as MicrosoftGraphAdapter;
 const result=await new ConsistencyChecker(f.database,graph,'mi').run({...ctx,physical:true});
 assert.equal(result.summary.warning,1);assert.equal(result.summary.critical,1);
 assert.equal(result.physicalEvidence,'incomplete');
 assert(result.findings.some(item=>item.code==='PHYSICAL_DOCUMENT_HASH_MISMATCH'));
 assert(!JSON.stringify(result).includes('private-'));
});

test('physical appendix evidence is pinned, deduplicated, and safe on missing or unauthorized metadata',async()=>{
 const bytes=Buffer.from('pinned appendix'),hash=`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
 const file={project_id:'a',entity_id:'appendix-a',entity_type:'contract_appendix',label:'RS · Příloha 1',hash,drive_id:'private-drive',item_id:'private-item',version_id:'1.0',site_id:'private-site',configured:true};
 const f=fixture({files:[file,{...file,entity_id:'generation-a',entity_type:'generation_appendix'}]});let downloads=0;
 const graph={downloadFile:async(_connection:unknown,_item:string,version:string)=>{downloads++;assert.equal(version,'1.0');return bytes;}} as unknown as MicrosoftGraphAdapter;
 const report=await new ConsistencyChecker(f.database,graph,'mi').run({...ctx,physical:true});
 assert.equal(downloads,1);assert.equal(report.physicalEvidence,'verified');
 for(const missing of [{configured:false},{version_id:null},{item_id:null},{drive_id:null}]){
  const inaccessible=fixture({files:[{...file,...missing}]});
  const result=await new ConsistencyChecker(inaccessible.database,graph,'mi').run({...ctx,physical:true});
  assert.equal(result.physicalEvidence,'incomplete');assert.equal(result.summary.critical,1);
  assert.equal(result.findings[0].entityType,'contract_appendix');assert(!JSON.stringify(result).includes('private-'));
 }
 assert.equal(downloads,1,'unauthorized metadata must never trigger a physical read');
});

test('SQL includes partial signatures, frozen bundles, missing versions and sensitive-document authorization',()=>{
 assert.match(consistencyFactsSql,/p.signature_status='signed'/);
 assert.match(consistencyFactsSql,/GENERATION_APPENDIX_SNAPSHOT_MISMATCH/);
 assert.match(physicalEvidenceSql,/contract_preparation_version_id/);
 assert.match(physicalEvidenceSql,/jsonb_array_elements\(g.appendix_snapshot\)/);
 assert.match(physicalEvidenceSql,/LEFT JOIN document_versions/);
 assert.match(physicalEvidenceSql,/documents.view_sensitive/);
 assert.match(physicalEvidenceSql,/f.expected_version=v.external_version_id/);
 assert.match(physicalEvidenceSql,/cv.project_id=ANY\(\$2::uuid\[\]\)/);
});
