import type {Database,SqlClient} from '../database.js';
import type {DocumentContext} from '../documents/repository.js';
import {legacyRsPreparationInput,legacyRsPriceBasis,legacyRsAgreedTerms,LegacyRsPreparationError,type LegacyRsPriceBasis} from './legacy-rs-preparation.js';

type Context=DocumentContext&{contractId:string};
type Row={id:string;project_id:string;unit_id:string;sales_case_id:string;reference:string;contract_type:string;current_status:string;
  case_status:string;closed_at:string|null;archived_at:string|null;unit_archived_at:string|null;unit_price_snapshot:string|null;total_price_snapshot:string|null;
  accessory_price_snapshot:unknown[];reservation_fee_amount:string|null;payment_amount:string|null;actor:string};
const reject=(code:string):never=>{throw new LegacyRsPreparationError(code);};

/** Deliberately not exposed as an HTTP command until native transaction/race
 * tests and the explicit confirmation UI are complete. No background repair. */
export class LegacyRsPreparationRepository{
  constructor(private readonly database:Database){}
  async preview(input:Context){
    return this.database.withContext(input,async client=>{
      const row=await this.authorized(client,input);
      await this.eligible(client,input,row);
      return legacyRsPriceBasis(await this.basis(client,input,row));
    },{readOnly:true});
  }
  async prepare(input:Context,body:unknown){
    const command=legacyRsPreparationInput(body);
    return this.database.withContext(input,async client=>{
      // Same unit-first lock used by signature, holds, price and assignment
      // operations. Re-read permissions and facts after acquiring it.
      await client.query('SELECT app.lock_workflow_unit($1,(SELECT unit_id FROM contracts WHERE tenant_id=$1 AND id=$2))',[input.tenantId,input.contractId]);
      const row=await this.authorized(client,input,true);
      const previous=(await client.query<{id:string;generation_payload:{legacyPreparation?:{command:unknown}}}>(`
        SELECT id,generation_payload FROM contract_versions WHERE tenant_id=$1 AND contract_id=$2
          AND generation_payload->'legacyPreparation'->'command'->>'idempotencyKey'=$3
        ORDER BY version_number LIMIT 1`,[input.tenantId,input.contractId,command.idempotencyKey])).rows[0];
      if(previous){
        // JSONB object ordering is not stable. Compare values in SQL.
        const same=(await client.query<{same:boolean}>(`SELECT generation_payload->'legacyPreparation'->'command'=$3::jsonb same
          FROM contract_versions WHERE tenant_id=$1 AND id=$2`,[input.tenantId,previous.id,JSON.stringify(command)])).rows[0]?.same;
        if(!same)return reject('idempotency_mismatch');
        return{versionId:previous.id,replayed:true};
      }
      await this.eligible(client,input,row);
      const basis=await this.basis(client,input,row),terms=legacyRsAgreedTerms(basis,command);
      const payload={source:'legacy_rs_preparation',legacyPreparation:{command,preview:legacyRsPriceBasis(basis),
        previous:{unitPrice:row.unit_price_snapshot,totalPrice:row.total_price_snapshot,accessories:row.accessory_price_snapshot,reservationFee:row.reservation_fee_amount},agreed:terms}};
      // The existing operation appends a version, supersedes the old working
      // version and explicitly reopens approval. It does not delete evidence.
      const version=(await client.query<{id:string}>(`SELECT app.create_contract_version($1,$2,$3,'manual',$4,$5,$6::jsonb) id`,
        [input.tenantId,input.contractId,`${row.reference} – doplnění smluvních údajů`,input.membershipId,basis.versionId,JSON.stringify(payload)])).rows[0].id;
      await client.query(`UPDATE contracts SET unit_price_snapshot=$3::numeric,total_price_snapshot=$4::numeric,
        accessory_price_snapshot=$5::jsonb,reservation_fee_amount=$6::numeric WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId,input.contractId,terms.unitPrice,terms.totalPrice,JSON.stringify(terms.accessories),terms.reservationFee]);
      const evidence={contractId:input.contractId,versionId:version,basedOnVersionId:basis.versionId,reason:command.reason,previewToken:command.previewToken,agreed:terms};
      await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,after_data,metadata)
        VALUES($1,$2,'contract.legacy_terms_prepared','contract',$3,$4::jsonb,jsonb_build_object('projectId',$5::uuid,'unitId',$6::uuid))`,
        [input.tenantId,row.actor,input.contractId,JSON.stringify(evidence),row.project_id,row.unit_id]);
      await client.query(`INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
        VALUES($1,'contract',$2,'contract.legacy_terms_prepared.v1',$3::jsonb)`,[input.tenantId,input.contractId,JSON.stringify(evidence)]);
      return{versionId:version,replayed:false};
    });
  }
  private async authorized(client:SqlClient,input:Context,lock=false):Promise<Row>{
    const row=(await client.query<Row>(`SELECT c.id,c.project_id,c.unit_id,c.sales_case_id,c.reference,c.contract_type,c.current_status,
      c.unit_price_snapshot::text,c.total_price_snapshot::text,c.accessory_price_snapshot,c.reservation_fee_amount::text,c.payment_amount::text,
      s.status case_status,s.closed_at,p.archived_at,u.archived_at unit_archived_at,m.user_id actor
      FROM contracts c JOIN sales_cases s ON s.tenant_id=c.tenant_id AND s.id=c.sales_case_id AND s.unit_id=c.unit_id AND s.project_id=c.project_id
      JOIN projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id
      JOIN units u ON u.tenant_id=c.tenant_id AND u.id=c.unit_id AND u.project_id=c.project_id
      JOIN tenant_memberships m ON m.tenant_id=c.tenant_id AND m.id=$3 AND m.user_id=$4 AND m.status='active'
      WHERE c.tenant_id=$1 AND c.id=$2 AND app.has_project_permission(c.tenant_id,m.id,c.project_id,'contract.manage')
        AND app.has_project_permission(c.tenant_id,m.id,c.project_id,'price.read')
      ${lock?'FOR UPDATE OF c':''}`,[input.tenantId,input.contractId,input.membershipId,input.userId])).rows[0];
    if(!row)return reject('not_found_or_forbidden');return row;
  }
  private async eligible(client:SqlClient,input:Context,row:Row){
    if(row.contract_type!=='rs'||!['draft','sent','negotiation','approved'].includes(row.current_status)
      ||row.case_status!=='active'||row.closed_at||row.archived_at||row.unit_archived_at)return reject('not_preparable');
    if(row.unit_price_snapshot!==null||row.total_price_snapshot!==null||row.accessory_price_snapshot.length
      ||row.reservation_fee_amount!==null||row.payment_amount!==null)return reject('existing_terms_require_review');
    const blocked=(await client.query<{blocked:boolean}>(`SELECT
      EXISTS(SELECT 1 FROM contract_parties WHERE tenant_id=$1 AND contract_id=$2 AND signature_status='signed') OR
      EXISTS(SELECT 1 FROM contract_versions WHERE tenant_id=$1 AND contract_id=$2 AND (document_version_id IS NOT NULL OR locked_at IS NOT NULL OR payment_terms_snapshot IS NOT NULL OR version_status='signed')) OR
      EXISTS(SELECT 1 FROM payment_obligations WHERE tenant_id=$1 AND contract_id=$2) OR
      EXISTS(SELECT 1 FROM document_generation_operations WHERE tenant_id=$1 AND contract_id=$2) OR
      EXISTS(SELECT 1 FROM contract_documents WHERE tenant_id=$1 AND contract_id=$2) OR
      EXISTS(SELECT 1 FROM document_upload_operations WHERE tenant_id=$1 AND metadata->>'contractId'=$2::text) blocked`,
      [input.tenantId,input.contractId])).rows[0].blocked;
    if(blocked)return reject('existing_evidence_requires_review');
  }
  private async basis(client:SqlClient,input:Context,row:Row):Promise<LegacyRsPriceBasis>{
    const version=(await client.query<{id:string}>(`SELECT id FROM contract_versions WHERE tenant_id=$1 AND contract_id=$2 ORDER BY version_number DESC LIMIT 1`,[input.tenantId,input.contractId])).rows[0];
    if(!version)return reject('version_required');
    const price=(await client.query<{amount:string|null}>(`SELECT CASE WHEN EXISTS(SELECT 1 FROM unit_price_history
      WHERE tenant_id=$1 AND unit_id=$2 AND valid_from<=statement_timestamp()) THEN app.current_unit_price($1,$2,statement_timestamp())::text END amount`,[input.tenantId,row.unit_id])).rows[0].amount;
    const accessories=(await client.query<LegacyRsPriceBasis['accessories'][number]>(`SELECT a.id "assignmentId",item.id "accessoryId",item.code,t.category type,
      app.current_accessory_price(item.tenant_id,item.id,statement_timestamp())::text amount
      FROM unit_accessory_assignments a JOIN accessories item ON item.tenant_id=a.tenant_id AND item.id=a.accessory_id
      JOIN accessory_types t ON t.tenant_id=item.tenant_id AND t.id=item.accessory_type_id
      WHERE a.tenant_id=$1 AND a.unit_id=$2 AND a.valid_from<=statement_timestamp()
        AND (a.valid_to IS NULL OR a.valid_to>statement_timestamp()) AND item.archived_at IS NULL
      ORDER BY a.id`,[input.tenantId,row.unit_id])).rows;
    return{contractId:row.id,projectId:row.project_id,unitId:row.unit_id,salesCaseId:row.sales_case_id,versionId:version.id,currentUnitPrice:price,accessories};
  }
}
