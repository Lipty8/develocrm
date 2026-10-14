import type {SqlClient} from '../database.js';

// Optional schema detection keeps read-only clients compatible during the
// coordinated rollout. Missing support always fails closed for archive reads.
export async function archiveReadSql(client:SqlClient,enabled:boolean):Promise<string>{
 if(!enabled)return 'false';
 const result=await client.query<{available:boolean}>("SELECT to_regprocedure('app.can_manage_project_archive(uuid,uuid,uuid)') IS NOT NULL available");
 return result.rows[0]?.available?'app.can_manage_project_archive($1,$2,project.id)':'false';
}
