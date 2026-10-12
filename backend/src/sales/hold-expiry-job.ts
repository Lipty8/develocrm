import {randomUUID} from "node:crypto";
import type {Database} from "../database.js";

export type HoldExpiryContext={tenantId:string;membershipId:string};

/** A bounded tenant-scoped job. Every hold is processed in its own atomic transaction. */
export async function expirePreReservations(database:Database,context:HoldExpiryContext,limit=100){
  const correlationId=randomUUID();
  const candidates=await database.withContext({tenantId:context.tenantId},async client=>{
    const member=(await client.query<{user_id:string}>("SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",[context.tenantId,context.membershipId])).rows[0];
    if(!member)throw new Error("Expiry job membership is not active");
    const holds=(await client.query<{id:string}>(`SELECT hold.id FROM unit_holds hold
      WHERE hold.tenant_id=$1 AND hold.status='active' AND hold.hold_type='pre_reservation'
        AND hold.is_expirable AND hold.expires_at<=now()
        AND app.has_project_permission($1,$2,hold.project_id,'holds.manage')
        AND NOT app.has_effective_signed_contract($1,hold.unit_id)
      ORDER BY hold.unit_id,hold.id LIMIT $3`,[context.tenantId,context.membershipId,limit])).rows;
    return {userId:member.user_id,holds};
  });
  let expired=0;
  for(const hold of candidates.holds){
    const changed=await database.withContext({tenantId:context.tenantId,userId:candidates.userId},async client=>{
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='30s'");
      await client.query("SELECT set_config('app.operation_source','scheduled_hold_expiry',true)");
      return (await client.query<{changed:boolean}>("SELECT app.expire_unit_hold($1,$2,$3) changed",[context.tenantId,hold.id,context.membershipId])).rows[0].changed;
    });
    if(changed)expired++;
  }
  return {correlationId,scanned:candidates.holds.length,expired};
}
