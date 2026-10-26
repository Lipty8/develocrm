import {createHash, randomUUID} from 'node:crypto';
import type {Database} from '../database.js';
import type {DocumentContext} from '../documents/repository.js';
import type {MicrosoftGraphAdapter} from '../documents/graph-adapter.js';
import {snapshotHash} from '../shared/snapshot-integrity.js';

export type Severity='critical'|'warning'|'legacy';
export type Finding={severity:Severity;code:string;tenantId:string;projectId:string;entityType:string;entityId:string;label:string;description:string;runId:string};
export type ReviewedException={tenantId:string;projectId:string;versionId:string;contractId:string;signedAt:string};
export type Fact={project_id:string;entity_type:string;entity_id:string;label:string;code:string;details:Record<string,unknown>};
export type ConsistencyReport={runId:string;checkedAt:string;complete:boolean;projectsChecked:number;checks:number;findings:Finding[];summary:Record<Severity,number>;physicalEvidence:'verified'|'not_checked'|'incomplete'};

// Explicit reviewed evidence only. Missing evidence is never "compliant".
// Populated after a read-only pilot audit; no automatic exception registration.
// Read-only audit 2026-10-13, execution caj-develocrm-migrations-pilot-icdyq3s.
// All eight created/signature timestamps precede enforcement of migration 0057.
export const reviewedLegacyEvidence:ReviewedException[]=[
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50',versionId:'2561223f-9537-4008-b5be-752c0468410a',contractId:'78ad2f19-93ee-4428-a057-896fd1d6faf3',signedAt:'2025-12-29T00:00:00Z'},
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50',versionId:'6008b79d-a43b-4b7c-95e7-e71f513f0e1d',contractId:'be828e93-e8ac-4ad4-8e59-1224848f432d',signedAt:'2026-08-12T10:00:00Z'},
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50',versionId:'1855ccae-808b-43a7-b806-df0f020f57dc',contractId:'8a22d313-23e7-4e82-be4f-ffba369e6def',signedAt:'2026-08-11T10:00:00Z'},
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50',versionId:'9688be1f-7a54-4ff6-b374-ecf917bfed78',contractId:'79b95150-fe1b-40a9-91d5-763631654fd5',signedAt:'2026-08-12T10:00:00Z'},
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50',versionId:'a1331bb8-2fc1-495c-9fc8-457eec0092e1',contractId:'9450739e-fb30-4389-a73a-9ba7eb2735db',signedAt:'2026-08-15T10:00:00Z'},
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50',versionId:'36521734-751b-4765-97d5-8d595f94702f',contractId:'e2e5f187-bb1d-43dc-94ef-595c0faea990',signedAt:'2026-08-12T10:00:00Z'},
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'648b5e62-9784-4de9-929d-c89b7ffc3c50',versionId:'682a9533-de04-4562-9b8c-f46df7d5e68e',contractId:'a22acc01-cf3a-4044-afcd-e2824a78d430',signedAt:'2026-08-18T10:00:00Z'},
 {tenantId:'60bed28c-0c89-4a38-bac7-71e6cf7b9232',projectId:'b461cb42-1e5a-4b5a-ab8e-5e9426773ed6',versionId:'6d93e5c7-45e6-40bc-924e-371678ad0dd1',contractId:'e0fe88a7-9fa9-4cb7-bc1f-62fbdcd7e641',signedAt:'2026-10-12T10:00:00Z'},
];

export const consistencyFactsSql=`
WITH scope AS (
 SELECT id FROM projects WHERE tenant_id=$1
 AND ($3::uuid IS NULL OR id=$3)
 AND app.has_project_permission($1,$2,id,'unit.read')
 AND app.has_project_permission($1,$2,id,'contract.read')
 AND app.has_project_permission($1,$2,id,'documents.read')
 AND app.has_project_permission($1,$2,id,'price.read')
), signed AS (
 SELECT cv.*,c.reference,c.unit_id,c.sales_case_id,c.contract_type,c.current_status
 FROM contract_versions cv JOIN contracts c ON c.tenant_id=cv.tenant_id AND c.id=cv.contract_id
 WHERE cv.tenant_id=$1 AND cv.project_id IN(SELECT id FROM scope) AND (cv.version_status='signed'
 OR EXISTS(SELECT 1 FROM contract_parties p WHERE p.tenant_id=cv.tenant_id AND p.signed_version_id=cv.id AND p.signature_status='signed'))
), facts AS (
 SELECT project_id,'contract_version'::text entity_type,id entity_id,reference label,'SIGNED_EVIDENCE_MISSING'::text code,
 jsonb_build_object('contractId',contract_id,'signedAt',signed_at) details FROM signed WHERE document_version_id IS NULL
 UNION ALL
 SELECT s.project_id,'contract_version',s.id,s.reference,'SIGNED_EVIDENCE_CONTEXT', '{}'::jsonb
 FROM signed s LEFT JOIN document_versions v ON v.tenant_id=s.tenant_id AND v.id=s.document_version_id
 LEFT JOIN documents d ON d.tenant_id=v.tenant_id AND d.id=v.document_id
 WHERE s.document_version_id IS NOT NULL AND (
 v.id IS NULL OR v.document_id IS DISTINCT FROM s.document_id OR v.project_id IS DISTINCT FROM s.project_id
 OR d.project_id IS DISTINCT FROM s.project_id OR d.storage_provider IS DISTINCT FROM 'sharepoint'
 OR v.content_hash IS NULL OR v.content_hash !~ '^sha256:[a-f0-9]{64}$' OR nullif(v.external_version_id,'') IS NULL
 OR NOT EXISTS(SELECT 1 FROM contract_documents l WHERE l.tenant_id=s.tenant_id AND l.project_id=s.project_id AND l.contract_id=s.contract_id AND l.document_id=s.document_id)
 OR NOT EXISTS(SELECT 1 FROM document_upload_operations o WHERE o.tenant_id=s.tenant_id AND o.project_id=s.project_id AND o.document_version_id=s.document_version_id AND o.state='completed'
 AND o.metadata->>'contractId'=s.contract_id::text AND o.metadata->>'unitId'=s.unit_id::text AND o.metadata->>'salesCaseId'=s.sales_case_id::text))
 UNION ALL
 SELECT c.project_id,'contract',c.id,c.reference,'SIGNED_CONTRACT_VERSION_MISSING','{}'::jsonb FROM contracts c
 WHERE c.tenant_id=$1 AND c.project_id IN(SELECT id FROM scope) AND c.current_status='signed'
 AND NOT EXISTS(SELECT 1 FROM signed s WHERE s.contract_id=c.id AND s.version_status='signed')
 UNION ALL
 SELECT c.project_id,'contract',c.id,c.reference,'RS_RESERVATION_INCONSISTENT',jsonb_build_object('unitId',c.unit_id)
 FROM contracts c JOIN units u ON u.tenant_id=c.tenant_id AND u.id=c.unit_id
 JOIN sales_cases sc ON sc.tenant_id=c.tenant_id AND sc.id=c.sales_case_id
 WHERE c.tenant_id=$1 AND c.project_id IN(SELECT id FROM scope) AND c.contract_type='rs' AND c.current_status='signed'
 AND NOT EXISTS(SELECT 1 FROM contracts later WHERE later.tenant_id=c.tenant_id AND later.sales_case_id=c.sales_case_id AND later.contract_type IN('sbk','ks') AND later.current_status='signed')
 AND (u.commercial_status<>'reserved' OR sc.status<>'active' OR sc.current_stage NOT IN('reservation','rs','sbk')
 OR (SELECT count(*) FROM unit_holds h WHERE h.tenant_id=c.tenant_id AND h.unit_id=c.unit_id AND h.sales_case_id=c.sales_case_id AND h.status='active' AND h.hold_type='reservation' AND NOT h.is_expirable)<>1)
 UNION ALL
 SELECT u.project_id,'unit',u.id,u.code,'AVAILABLE_WITH_HOLD','{}'::jsonb FROM units u
 WHERE u.tenant_id=$1 AND u.project_id IN(SELECT id FROM scope) AND u.commercial_status='available'
 AND EXISTS(SELECT 1 FROM unit_holds h WHERE h.tenant_id=u.tenant_id AND h.unit_id=u.id AND h.status='active')
 UNION ALL
 SELECT u.project_id,'unit',u.id,u.code,'RESERVED_WITHOUT_SIGNED_CONTRACT','{}'::jsonb FROM units u
 WHERE u.tenant_id=$1 AND u.project_id IN(SELECT id FROM scope) AND u.commercial_status='reserved'
 AND NOT app.has_effective_signed_contract(u.tenant_id,u.id)
 UNION ALL
 SELECT u.project_id,'unit',u.id,u.code,'MULTIPLE_ACTIVE_HOLDS','{}'::jsonb FROM units u
 WHERE u.tenant_id=$1 AND u.project_id IN(SELECT id FROM scope)
 AND (SELECT count(*) FROM unit_holds h WHERE h.tenant_id=u.tenant_id AND h.unit_id=u.id AND h.status='active')>1
 UNION ALL
 SELECT h.project_id,'hold',h.id,u.code,'EXPIRED_ACTIVE_PRE_RESERVATION','{}'::jsonb
 FROM unit_holds h JOIN units u ON u.tenant_id=h.tenant_id AND u.id=h.unit_id
 WHERE h.tenant_id=$1 AND h.project_id IN(SELECT id FROM scope) AND h.status='active'
 AND h.hold_type='pre_reservation' AND h.is_expirable AND h.expires_at<=now()
 UNION ALL
 SELECT sc.project_id,'sales_case',sc.id,u.code,'STALE_PRE_RESERVATION_STAGE','{}'::jsonb
 FROM sales_cases sc JOIN units u ON u.tenant_id=sc.tenant_id AND u.id=sc.unit_id
 WHERE sc.tenant_id=$1 AND sc.project_id IN(SELECT id FROM scope) AND sc.status='active' AND sc.current_stage='pre_reservation'
 AND NOT EXISTS(SELECT 1 FROM unit_holds h WHERE h.tenant_id=sc.tenant_id AND h.sales_case_id=sc.id AND h.status='active' AND (NOT h.is_expirable OR h.expires_at>now()))
 UNION ALL
 SELECT u.project_id,'unit',u.id,u.code,'PRICE_HISTORY_MISSING','{}'::jsonb FROM units u
 WHERE u.tenant_id=$1 AND u.project_id IN(SELECT id FROM scope) AND u.archived_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM unit_price_history h WHERE h.tenant_id=u.tenant_id AND h.unit_id=u.id AND h.valid_from<=now() AND h.price_type IN('sale_price','list_price','contract_price'))
 UNION ALL
 SELECT u.project_id,'unit',u.id,u.code,'INITIAL_PRICE_DUPLICATED','{}'::jsonb FROM units u
 WHERE u.tenant_id=$1 AND u.project_id IN(SELECT id FROM scope)
 AND (SELECT count(*) FROM unit_price_history h WHERE h.tenant_id=u.tenant_id AND h.unit_id=u.id AND h.reason='Počáteční cena jednotky')>1
 UNION ALL
 SELECT v.project_id,'document_version',v.id,d.name,'DOCUMENT_CONTEXT_MISMATCH','{}'::jsonb
 FROM document_versions v LEFT JOIN documents d ON d.tenant_id=v.tenant_id AND d.id=v.document_id
 WHERE v.tenant_id=$1 AND v.project_id IN(SELECT id FROM scope) AND (d.id IS NULL OR d.project_id IS DISTINCT FROM v.project_id)
 UNION ALL
 SELECT tv.project_id,'template_version',tv.id,t.name,'APPROVED_TEMPLATE_HASH_MISMATCH','{}'::jsonb
 FROM document_template_versions tv JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
 LEFT JOIN document_versions v ON v.tenant_id=tv.tenant_id AND v.id=tv.source_document_version_id
 WHERE tv.tenant_id=$1 AND tv.project_id IN(SELECT id FROM scope) AND tv.approval_status='approved'
 AND (tv.content_hash !~ '^sha256:[a-f0-9]{64}$' OR v.content_hash IS NULL OR v.content_hash !~ '^sha256:[a-f0-9]{64}$' OR v.id IS NULL OR v.project_id IS DISTINCT FROM tv.project_id OR v.document_id IS DISTINCT FROM tv.source_document_id OR nullif(v.external_version_id,'') IS NULL)
 UNION ALL
 -- Registration pins the exact native source, which can differ from an earlier
 -- upload hash after Office normalization. Preserve the discrepancy as a
 -- warning, never as physical verification; the native hash is checked below.
 SELECT tv.project_id,'template_version',tv.id,t.name,'TEMPLATE_UPLOAD_HASH_DIFFERENT','{}'::jsonb
 FROM document_template_versions tv JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
 JOIN document_versions v ON v.tenant_id=tv.tenant_id AND v.id=tv.source_document_version_id
 WHERE tv.tenant_id=$1 AND tv.project_id IN(SELECT id FROM scope) AND tv.approval_status='approved'
 AND tv.content_hash~'^sha256:[a-f0-9]{64}$' AND v.content_hash~'^sha256:[a-f0-9]{64}$'
 AND tv.content_hash<>v.content_hash AND v.project_id=tv.project_id AND v.document_id=tv.source_document_id AND nullif(v.external_version_id,'') IS NOT NULL
 UNION ALL
 SELECT g.project_id,'generation',g.id,t.name,'GENERATION_CONTEXT_MISMATCH','{}'::jsonb
 FROM document_generation_operations g JOIN document_template_versions tv ON tv.tenant_id=g.tenant_id AND tv.id=g.template_version_id
 JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
 LEFT JOIN document_versions v ON v.tenant_id=g.tenant_id AND v.id=g.output_document_version_id
 WHERE g.tenant_id=$1 AND g.project_id IN(SELECT id FROM scope) AND (tv.project_id<>g.project_id OR
 (g.state='completed' AND (v.id IS NULL OR v.project_id<>g.project_id OR v.document_id IS DISTINCT FROM g.output_document_id)))
 UNION ALL
 SELECT cv.project_id,'contract_version',cv.id,c.reference,'GENERATION_SNAPSHOT_MISMATCH','{}'::jsonb
 FROM contract_versions cv JOIN contracts c ON c.tenant_id=cv.tenant_id AND c.id=cv.contract_id
 LEFT JOIN document_generation_operations g ON g.tenant_id=cv.tenant_id AND g.id=cv.generation_operation_id
 WHERE cv.tenant_id=$1 AND cv.project_id IN(SELECT id FROM scope) AND cv.source_type='generated' AND cv.document_version_id IS NOT NULL
 AND (g.id IS NULL OR g.template_version_id IS DISTINCT FROM cv.template_version_id OR g.contract_id IS DISTINCT FROM cv.contract_id
 OR g.generation_snapshot IS DISTINCT FROM cv.generation_payload OR g.output_document_version_id IS DISTINCT FROM cv.document_version_id)
 UNION ALL
 SELECT g.project_id,'generation',g.id,c.reference,'GENERATION_APPENDIX_SNAPSHOT_MISMATCH','{}'::jsonb
 FROM document_generation_operations g JOIN contracts c ON c.tenant_id=g.tenant_id AND c.id=g.contract_id
 WHERE g.tenant_id=$1 AND g.project_id IN(SELECT id FROM scope) AND g.contract_preparation_version_id IS NOT NULL
 AND g.appendix_snapshot IS DISTINCT FROM (
   SELECT COALESCE(jsonb_agg(jsonb_build_object('number',l.appendix_number,'documentId',d.id,'documentVersionId',v.id,
     'hash',v.content_hash,'externalVersionId',v.external_version_id,'driveId',d.external_drive_id,'itemId',d.external_item_id)
     ORDER BY l.appendix_number),'[]'::jsonb)
   FROM contract_documents l JOIN documents d ON d.tenant_id=l.tenant_id AND d.project_id=l.project_id AND d.id=l.document_id
   JOIN document_versions v ON v.tenant_id=l.tenant_id AND v.project_id=l.project_id AND v.document_id=l.document_id AND v.id=l.document_version_id
   WHERE l.tenant_id=g.tenant_id AND l.contract_id=g.contract_id AND l.contract_version_id=g.contract_preparation_version_id AND l.appendix_number IS NOT NULL)
 UNION ALL
 SELECT u.project_id,'unit',u.id,u.code,'CURRENT_PRICE_PROJECTION_MISMATCH','{}'::jsonb FROM units u
 WHERE u.tenant_id=$1 AND u.project_id IN(SELECT id FROM scope)
 AND app.current_unit_sales_price(u.tenant_id,u.id,now()) IS DISTINCT FROM
 (app.current_unit_price(u.tenant_id,u.id,now())+app.current_unit_accessory_price(u.tenant_id,u.id,now()))
)
SELECT * FROM facts ORDER BY project_id,code,entity_id`;

/** Exact files only: never resolve a document to its latest business version. */
export const physicalEvidenceSql=`
WITH protected_versions AS (
 SELECT cv.*,c.reference FROM contract_versions cv JOIN contracts c ON c.tenant_id=cv.tenant_id AND c.id=cv.contract_id
 WHERE cv.tenant_id=$1 AND cv.project_id=ANY($2::uuid[]) AND (
   cv.document_version_id IS NOT NULL OR cv.version_status='signed'
   OR EXISTS(SELECT 1 FROM contract_parties p WHERE p.tenant_id=cv.tenant_id AND p.signed_version_id=cv.id AND p.signature_status='signed')
   OR EXISTS(SELECT 1 FROM document_generation_operations g WHERE g.tenant_id=cv.tenant_id AND g.contract_preparation_version_id=cv.id))
), files AS (
 SELECT cv.project_id,cv.id entity_id,'contract_version'::text entity_type,cv.reference label,
   cv.document_id::text document_id,cv.document_version_id::text version_id,NULL::text expected_hash,
   NULL::text expected_drive,NULL::text expected_item,NULL::text expected_version,false pinned
 FROM protected_versions cv WHERE cv.document_version_id IS NOT NULL
 UNION ALL
 SELECT cv.project_id,l.id,'contract_appendix',cv.reference||' · Příloha '||l.appendix_number,
   l.document_id::text,l.document_version_id::text,NULL,NULL,NULL,NULL,false
 FROM protected_versions cv JOIN contract_documents l ON l.tenant_id=cv.tenant_id AND l.project_id=cv.project_id
   AND l.contract_id=cv.contract_id AND l.contract_version_id=cv.id AND l.appendix_number IS NOT NULL
 UNION ALL
 SELECT g.project_id,g.id,'generation_appendix',c.reference||' · Příloha '||COALESCE(a.value->>'number','?'),
   a.value->>'documentId',a.value->>'documentVersionId',a.value->>'hash',a.value->>'driveId',a.value->>'itemId',a.value->>'externalVersionId',true
 FROM document_generation_operations g JOIN contracts c ON c.tenant_id=g.tenant_id AND c.id=g.contract_id
 CROSS JOIN LATERAL jsonb_array_elements(g.appendix_snapshot) a(value)
 WHERE g.tenant_id=$1 AND g.project_id=ANY($2::uuid[]) AND g.contract_preparation_version_id IS NOT NULL
 UNION ALL
 SELECT tv.project_id,tv.id,'template_version',t.name,tv.source_document_id::text,tv.source_document_version_id::text,tv.content_hash,NULL,NULL,NULL,false
 FROM document_template_versions tv JOIN document_templates t ON t.tenant_id=tv.tenant_id AND t.id=tv.template_id
 WHERE tv.tenant_id=$1 AND tv.project_id=ANY($2::uuid[]) AND tv.approval_status='approved'
)
SELECT f.project_id,f.entity_id,f.entity_type,f.label,COALESCE(f.expected_hash,v.content_hash) hash,v.external_version_id version_id,
 d.external_drive_id drive_id,d.external_item_id item_id,conn.site_id,
 (v.project_id=f.project_id AND d.project_id=f.project_id AND d.id::text=f.document_id AND d.storage_provider='sharepoint'
  AND (d.sensitivity='normal' OR app.has_project_permission($1,$4,f.project_id,'documents.view_sensitive'))
  AND conn.authentication_mode='managed_identity' AND conn.connection_status='connected' AND conn.credential_reference=$3
  AND (NOT f.pinned OR (f.expected_hash IS NOT NULL AND f.expected_hash=v.content_hash
    AND f.expected_drive=d.external_drive_id AND f.expected_item=d.external_item_id AND f.expected_version=v.external_version_id))) configured
FROM files f LEFT JOIN document_versions v ON v.tenant_id=$1 AND v.id::text=f.version_id
LEFT JOIN documents d ON d.tenant_id=v.tenant_id AND d.id=v.document_id
LEFT JOIN sharepoint_connections conn ON conn.tenant_id=d.tenant_id AND conn.drive_id=d.external_drive_id AND conn.archived_at IS NULL`;

const descriptions:Record<string,string>={
 SIGNED_EVIDENCE_MISSING:'Historický podpis čeká na doložení skutečného podepsaného souboru.',
 SIGNED_EVIDENCE_CONTEXT:'Podepsaná verze nemá platnou dokumentovou vazbu a dokončený upload.',
 SIGNED_CONTRACT_VERSION_MISSING:'Podepsaná smlouva nemá podepsanou logickou verzi.',
 RS_RESERVATION_INCONSISTENT:'Podepsaná RS neodpovídá stavu jednotky, obchodu nebo smluvní blokace.',
 AVAILABLE_WITH_HOLD:'Volná jednotka má aktivní blokaci.',
 RESERVED_WITHOUT_SIGNED_CONTRACT:'Rezervovaná jednotka nemá účinnou podepsanou smlouvu.',
 MULTIPLE_ACTIVE_HOLDS:'Jednotka má více aktivních blokací.',
 EXPIRED_ACTIVE_PRE_RESERVATION:'Vypršel termín předrezervace, ale blokace zůstala aktivní.',
 STALE_PRE_RESERVATION_STAGE:'Obchod zůstal v předrezervaci bez platné blokace.',
 PRICE_HISTORY_MISSING:'Jednotka nemá doloženou účinnou počáteční cenu.',
 INITIAL_PRICE_DUPLICATED:'Jednotka má více záznamů označených jako počáteční cena.',
 DOCUMENT_CONTEXT_MISMATCH:'Dokumentová verze neodpovídá projektu nebo dokumentu.',
 APPROVED_TEMPLATE_HASH_MISMATCH:'Schválená šablona neodpovídá uložené zdrojové verzi.',
 TEMPLATE_UPLOAD_HASH_DIFFERENT:'Otisk schválené šablony se liší od starší upload evidence. Přesný soubor musí ověřit kontrola SharePointu.',
 GENERATION_CONTEXT_MISMATCH:'Generování neodpovídá zdrojové šabloně nebo výstupní verzi.',
 GENERATION_SNAPSHOT_MISMATCH:'Smluvní verze neodpovídá uloženému vstupu generování.',
 GENERATION_APPENDIX_SNAPSHOT_MISMATCH:'Přílohy smlouvy neodpovídají přesným verzím uloženým při generování.',
 CURRENT_PRICE_PROJECTION_MISMATCH:'Celková cena neodpovídá centrálnímu součtu jednotky a příslušenství.',
};

export function classifyFact(fact:Fact,tenantId:string,runId:string,baseline:ReviewedException[]=reviewedLegacyEvidence):Finding{
 const legacy=fact.code==='SIGNED_EVIDENCE_MISSING'&&baseline.some(e=>e.tenantId===tenantId&&e.projectId===fact.project_id&&e.versionId===fact.entity_id&&e.contractId===fact.details.contractId&&
 new Date(e.signedAt).getTime()===new Date(String(fact.details.signedAt)).getTime());
 const severity:Severity=legacy?'legacy':['PRICE_HISTORY_MISSING','TEMPLATE_UPLOAD_HASH_DIFFERENT'].includes(fact.code)?'warning':'critical';
 return{severity,code:fact.code,tenantId,projectId:fact.project_id,entityType:fact.entity_type,entityId:fact.entity_id,label:fact.label,runId,
 description:fact.code==='SIGNED_EVIDENCE_MISSING'&&!legacy?'Podepsaná verze nemá konkrétní dokument a není schválenou historickou výjimkou.':descriptions[fact.code]??'Nesoulad obchodních dat.'};
}

export function signedEvidenceState(input:{tenantId:string;projectId:string;contractId:string;versionId:string;status:string;signedAt:string|null;documentVersionId?:string|null;documentReady?:boolean}){
 if(input.status!=='signed')return 'pending';
 if(input.documentVersionId)return input.documentReady?'documented':'invalid';
 const fact:Fact={project_id:input.projectId,entity_type:'contract_version',entity_id:input.versionId,label:'',code:'SIGNED_EVIDENCE_MISSING',details:{contractId:input.contractId,signedAt:input.signedAt}};
 return classifyFact(fact,input.tenantId,'projection').severity==='legacy'?'legacy_missing':'invalid';
}

export class ConsistencyChecker {
 constructor(private readonly database:Database,private readonly graph?:MicrosoftGraphAdapter,private readonly identityClientId?:string){}
 async run(input:DocumentContext&{projectId?:string;physical?:boolean}):Promise<ConsistencyReport>{
  const runId=randomUUID();
  const snapshot=await this.database.withContext(input,async client=>{
   await client.query("SET LOCAL statement_timeout='30s'");
   const allowed=await client.query(`SELECT 1 FROM tenant_memberships m WHERE m.tenant_id=$1 AND m.id=$2 AND m.user_id=$3 AND m.status='active'
    AND app.current_user_has_permission('system.manage')`,[input.tenantId,input.membershipId,input.userId]);
   if(!allowed.rows.length)throw new Error('system.manage permission required');
   const projects=(await client.query<{id:string;allowed:boolean}>(`SELECT id,
    app.has_project_permission($1,$2,id,'unit.read') AND app.has_project_permission($1,$2,id,'contract.read')
    AND app.has_project_permission($1,$2,id,'documents.read') AND app.has_project_permission($1,$2,id,'price.read') allowed
    FROM projects WHERE tenant_id=$1 AND ($3::uuid IS NULL OR id=$3)`,[input.tenantId,input.membershipId,input.projectId??null])).rows;
   if(input.projectId&&!projects.some(p=>p.allowed))throw new Error('project permission required');
   const projectIds=projects.filter(p=>p.allowed).map(p=>p.id);
   const facts=(await client.query<Fact>(consistencyFactsSql,[input.tenantId,input.membershipId,input.projectId??null])).rows;
   const files=(await client.query<{project_id:string;entity_id:string;entity_type:string;label:string;hash:string;drive_id:string;item_id:string;version_id:string;site_id:string;configured:boolean}>(
    physicalEvidenceSql,[input.tenantId,projectIds,`managed-identity://${this.identityClientId??''}`,input.membershipId])).rows;
   const generations=(await client.query<{id:string;project_id:string;generation_snapshot:Record<string,string>;snapshot_hash:string;snapshot_hash_scheme:string;legacy_pre_enforcement:boolean}>(`
    SELECT g.id,g.project_id,g.generation_snapshot,g.snapshot_hash,g.snapshot_hash_scheme,
      COALESCE(g.created_at<(SELECT applied_at FROM schema_migrations WHERE filename='0058_read_only_release_diagnostics.sql'),false) legacy_pre_enforcement
    FROM document_generation_operations g WHERE g.tenant_id=$1 AND g.project_id=ANY($2::uuid[])`,[input.tenantId,projectIds])).rows;
   return{facts,files,projects,projectIds,generations};
  },{readOnly:true});
  const findings=snapshot.facts.map(f=>classifyFact(f,input.tenantId,runId));
  for(const generation of snapshot.generations){
   let code:string|undefined;let severity:Severity='critical';
   if(generation.snapshot_hash_scheme==='legacy-json'&&generation.legacy_pre_enforcement){code='GENERATION_HASH_LEGACY_UNVERIFIABLE';severity='warning';}
   else{try{if(generation.snapshot_hash_scheme!=='canonical-json-v1'||snapshotHash(generation.generation_snapshot)!==generation.snapshot_hash)code='GENERATION_SNAPSHOT_HASH_MISMATCH';}catch{code='GENERATION_SNAPSHOT_HASH_MISMATCH';}}
   if(code)findings.push({severity,code,tenantId:input.tenantId,projectId:generation.project_id,entityType:'generation',entityId:generation.id,label:'Generování dokumentu',runId,
    description:severity==='warning'?'Historický checksum snapshotu nelze nezávisle přepočítat z uloženého pořadí údajů.':'Uložené údaje generování neodpovídají jejich otisku.'});
  }
  let physicalEvidence:ConsistencyReport['physicalEvidence']='not_checked';
  if(input.physical){
   physicalEvidence='verified';
   const downloadedHashes=new Map<string,string>();
   for(const file of snapshot.files){
    let code:string|undefined;
    try{
     if(!this.graph||!file.configured||!file.site_id||!file.drive_id||!file.item_id||!file.version_id||!file.hash)throw new Error('unavailable');
     const key=JSON.stringify([file.site_id,file.drive_id,file.item_id,file.version_id]);
     let actualHash=downloadedHashes.get(key);
     if(!actualHash){
      const bytes=await this.graph.downloadFile({siteId:file.site_id,driveId:file.drive_id},file.item_id,file.version_id);
      actualHash=`sha256:${createHash('sha256').update(bytes).digest('hex')}`;downloadedHashes.set(key,actualHash);
     }
     if(actualHash!==file.hash)code='PHYSICAL_DOCUMENT_HASH_MISMATCH';
    }catch{code='PHYSICAL_DOCUMENT_UNVERIFIED';physicalEvidence='incomplete';}
    if(code)physicalEvidence='incomplete';
    if(code)findings.push({severity:'critical',code,tenantId:input.tenantId,projectId:file.project_id,entityType:file.entity_type,entityId:file.entity_id,label:file.label,runId,
     description:code==='PHYSICAL_DOCUMENT_HASH_MISMATCH'?'Přesný soubor neodpovídá uloženému otisku.':'Přesný soubor nebylo možné ověřit v SharePointu.'});
   }
  }
  const summary={critical:0,warning:0,legacy:0};for(const finding of findings)summary[finding.severity]++;
  return{runId,checkedAt:new Date().toISOString(),complete:snapshot.projects.every(p=>p.allowed)&&snapshot.projects.length>0,
   projectsChecked:snapshot.projectIds.length,checks:Object.keys(descriptions).length+2,findings,summary,physicalEvidence};
 }
}
