import type { Database } from "../database.js";

export type CommercialStatus =
  | "available" | "pre_reserved" | "reserved" | "contracted" | "sold" | "handed_over" | "blocked";

export class CommercialStatusService {
  constructor(private readonly database: Database) {}

  block(input: { tenantId: string; unitId: string; actorMembershipId: string; actorUserId: string; reason: string }) {
    return this.execute({ ...input, target: "blocked", command: "blockUnit" });
  }

  unblock(input: { tenantId: string; unitId: string; actorMembershipId: string; actorUserId: string; reason: string }) {
    return this.execute({ ...input, target: "available", command: "unblockUnit" });
  }

  private async execute(input: {
    tenantId: string; unitId: string; actorMembershipId: string; actorUserId: string;
    reason: string; target: CommercialStatus; command: "blockUnit" | "unblockUnit";
  }): Promise<string> {
    if (input.reason.trim().length < 3) throw new Error("Důvod musí mít alespoň 3 znaky");
    return this.database.withContext({ tenantId: input.tenantId, userId: input.actorUserId }, async (client) => {
      const result = await client.query<{ event_id: string }>(
        `SELECT app.transition_unit_commercial_status($1, $2, $3, $4, $5, $6) AS event_id`,
        [input.tenantId, input.unitId, input.target, input.command, input.reason.trim(), input.actorMembershipId],
      );
      return result.rows[0].event_id;
    });
  }
}
