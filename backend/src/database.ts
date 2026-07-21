import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type DatabaseContext = {
  tenantId?: string;
  userId?: string;
  identityIssuer?: string;
  identitySubject?: string;
};

export interface SqlClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export class Database {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }

  async withContext<T>(context: DatabaseContext, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await setLocal(client, "app.tenant_id", context.tenantId);
      await setLocal(client, "app.user_id", context.userId);
      await setLocal(client, "app.identity_issuer", context.identityIssuer);
      await setLocal(client, "app.identity_subject", context.identitySubject);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

async function setLocal(client: PoolClient, name: string, value?: string): Promise<void> {
  await client.query("SELECT set_config($1, $2, true)", [name, value ?? ""]);
}
