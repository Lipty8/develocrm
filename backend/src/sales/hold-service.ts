import type { Database } from "../database.js";

export class HoldService {
  constructor(private readonly database: Database) {}
  create(input: { tenantId:string;userId:string;unitId:string;type:"pre_reservation"|"reservation";partyIds:string[];expiresAt:string;membershipId:string;interestId?:string;idempotencyKey:string;reason:string }) {
    return this.database.withContext({ tenantId:input.tenantId,userId:input.userId }, async (client) => (await client.query<{ sales_case_id:string;hold_id:string }>(
      "SELECT * FROM app.create_unit_hold($1,$2,$3,$4::uuid[],$5,$6,$7,$8,$9)",
      [input.tenantId,input.unitId,input.type,input.partyIds,input.expiresAt,input.membershipId,input.interestId ?? null,input.idempotencyKey,input.reason],
    )).rows[0]);
  }
  convert(input: { tenantId:string;userId:string;holdId:string;expiresAt:string;membershipId:string;idempotencyKey:string;reason:string }) {
    return this.database.withContext({ tenantId:input.tenantId,userId:input.userId }, async (client) => (await client.query<{ hold_id:string }>(
      "SELECT app.convert_pre_reservation($1,$2,$3,$4,$5,$6) hold_id",[input.tenantId,input.holdId,input.expiresAt,input.membershipId,input.idempotencyKey,input.reason],
    )).rows[0]);
  }
  cancel(input: { tenantId:string;userId:string;holdId:string;membershipId:string;reason:string }) {
    return this.database.withContext({ tenantId:input.tenantId,userId:input.userId }, async (client) => (await client.query<{ changed:boolean }>(
      "SELECT app.cancel_unit_hold($1,$2,$3,$4) changed",[input.tenantId,input.holdId,input.membershipId,input.reason],
    )).rows[0]);
  }
  expire(input: { tenantId:string;userId:string;holdId:string;membershipId:string }) {
    return this.database.withContext({ tenantId:input.tenantId,userId:input.userId }, async (client) => (await client.query<{ changed:boolean }>(
      "SELECT app.expire_unit_hold($1,$2,$3) changed",[input.tenantId,input.holdId,input.membershipId],
    )).rows[0]);
  }
}
