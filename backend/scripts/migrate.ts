import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {Pool} from "pg";

const connectionString=process.env.DATABASE_URL?.trim();
if(!connectionString)throw new Error("Chybí povinná proměnná DATABASE_URL");
const directory=resolve(process.cwd(),"backend/migrations");
const files=(await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const pool=new Pool({connectionString,max:1});
const client=await pool.connect();
try{
  await client.query("SELECT pg_advisory_lock(hashtext('develocrm:migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for(const filename of files){
    const sql=await readFile(resolve(directory,filename),"utf8");
    const checksum=createHash("sha256").update(sql).digest("hex");
    const applied=await client.query<{checksum:string}>("SELECT checksum FROM schema_migrations WHERE filename=$1",[filename]);
    if(applied.rows[0]){
      if(applied.rows[0].checksum!==checksum)throw new Error(`Migrace ${filename} byla po aplikaci změněna`);
      continue;
    }
    await client.query("BEGIN");
    try{
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)",[filename,checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }
  }
}finally{
  await client.query("SELECT pg_advisory_unlock(hashtext('develocrm:migrations'))").catch(()=>undefined);
  client.release();
  await pool.end();
}
