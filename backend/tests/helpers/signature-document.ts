import {randomUUID} from "node:crypto";
import type {SqlClient} from "../../src/database.js";

// Metadata-only fixture for DB workflow tests. Graph byte/hash verification is
// separately covered by the real upload/evidence service harness.
export async function signatureDocument(client:SqlClient,tenant:string,member:string,contractId:string):Promise<string>{
  const c=(await client.query<{project_id:string;unit_id:string;sales_case_id:string;contract_type:string}>("SELECT project_id,unit_id,sales_case_id,contract_type FROM contracts WHERE tenant_id=$1 AND id=$2",[tenant,contractId])).rows[0];
  const type=({rs:'reservation_contract',sbk:'future_purchase_contract',ks:'purchase_contract'} as Record<string,string>)[c.contract_type]??'amendment';
  const op=(await client.query<{id:string}>("SELECT app.reserve_document_upload($1,$2,$3,$4,'create',NULL,$5,'Technical fixture','fixture.pdf','application/pdf',16,$6,'v1','ready',NULL,$7,NULL,$8,$9,$10) id",
    [tenant,c.project_id,randomUUID(),'a'.repeat(64),type,`sha256:${'b'.repeat(64)}`,c.unit_id,contractId,c.sales_case_id,member])).rows[0].id;
  await client.query("SELECT app.record_document_graph_upload($1,$2,'fixture-drive',$3,'https://sharepoint.example.test/fixture','fixture-etag','1.0',16,$4)",[tenant,op,randomUUID(),member]);
  const d=(await client.query<{document_id:string;document_version_id:string}>("SELECT * FROM app.finalize_document_upload($1,$2,$3)",[tenant,op,member])).rows[0];
  return(await client.query<{id:string}>("SELECT app.bind_external_contract_document($1,$2,$3,$4,$5) id",[tenant,contractId,d.document_id,d.document_version_id,member])).rows[0].id;
}
