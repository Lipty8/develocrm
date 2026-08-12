import type { Database } from "../database.js";

export class HoldService {
  constructor(private readonly database: Database) {}
  create(input: { tenantId:string;userId:string;unitId:string;type:"pre_reservation"|"reservation";partyIds:string[];expiresAt:string;membershipId:string;interestId?:string;idempotencyKey:string;reason:string }) {
    const reason=input.reason.trim()||(input.type==="pre_reservation"?"Vytvořena předrezervace":"Vytvořena rezervace");
    return this.database.withContext({ tenantId:input.tenantId,userId:input.userId }, async (client) => (await client.query<{ sales_case_id:string;hold_id:string }>(
      "SELECT * FROM app.create_unit_hold($1,$2,$3,$4::uuid[],$5,$6,$7,$8,$9)",
      [input.tenantId,input.unitId,input.type,input.partyIds,input.expiresAt,input.membershipId,input.interestId ?? null,input.idempotencyKey,reason],
    )).rows[0]);
  }
  createWithParty(input:{tenantId:string;userId:string;unitId:string;type:"pre_reservation"|"reservation";expiresAt:string;membershipId:string;idempotencyKey:string;reason:string;newParty:{kind:"individual"|"organization";salutation?:string;firstName?:string;lastName?:string;legalName?:string;registrationNumber?:string;email?:string;phone?:string}}){
    const reason=input.reason.trim()||(input.type==="pre_reservation"?"Vytvořena předrezervace":"Vytvořena rezervace");
    const party=input.newParty;
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async(client)=>(await client.query<{party_id:string;sales_case_id:string;hold_id:string}>(
      "SELECT * FROM app.create_party_and_unit_hold($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [input.tenantId,input.unitId,input.type,input.expiresAt,input.membershipId,input.idempotencyKey,reason,party.kind,party.salutation??null,party.firstName??null,party.lastName??null,party.legalName??null,party.registrationNumber??null,party.email??null,party.phone??null],
    )).rows[0]);
  }
  convert(input: { tenantId:string;userId:string;holdId:string;expiresAt:string;membershipId:string;idempotencyKey:string;reason:string }) {
    const reason=input.reason.trim()||"Předrezervace převedena na rezervaci";
    return this.database.withContext({ tenantId:input.tenantId,userId:input.userId }, async (client) => (await client.query<{ hold_id:string }>(
      "SELECT app.convert_pre_reservation($1,$2,$3,$4,$5,$6) hold_id",[input.tenantId,input.holdId,input.expiresAt,input.membershipId,input.idempotencyKey,reason],
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
