import {createHash} from "node:crypto";

export type Migration={filename:string;source:string;checksum:string};
export type MigrationClient={query:(sql:string,parameters?:unknown[])=>Promise<{rows:Array<{checksum?:string;filename?:string}>;rowCount?:number|null}>};

export function migrationFromSource(filename:string,source:string):Migration{
  return{filename,source:unwrapMigrationTransaction(source),checksum:createHash("sha256").update(source).digest("hex")};
}
export function unwrapMigrationTransaction(source:string):string{
  return source.replace(/(^|\n)\s*BEGIN;\s*/i,"$1").replace(/\s*COMMIT;\s*$/i,"");
}
export async function applyMigrations(client:MigrationClient,migrations:Migration[],log:(message:string)=>void=()=>undefined):Promise<void>{
  await client.query("SELECT pg_advisory_lock(hashtext('develocrm:migrations'))");
  try{
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
      filename text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied=await client.query("SELECT filename,checksum FROM schema_migrations ORDER BY filename");
    const available=new Set(migrations.map(migration=>migration.filename));
    const missing=applied.rows.filter(row=>row.filename&&!available.has(row.filename));
    if(missing.length)throw new Error(`Chybí již aplikovaná migrace: ${missing.map(row=>row.filename).join(", ")}`);
    const checksums=new Map(applied.rows.map(row=>[row.filename,row.checksum]));
    for(const migration of migrations){
      const existing=checksums.get(migration.filename);
      if(existing){
        if(existing!==migration.checksum)throw new Error(`Migrace ${migration.filename} byla po aplikaci změněna`);
        continue;
      }
      await client.query("BEGIN");
      try{
        await client.query(migration.source);
        await client.query("INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)",[migration.filename,migration.checksum]);
        await client.query("COMMIT");log(`Applied ${migration.filename}`);
      }catch(error){await client.query("ROLLBACK");throw error;}
    }
  }finally{await client.query("SELECT pg_advisory_unlock(hashtext('develocrm:migrations'))").catch(()=>undefined);}
}
