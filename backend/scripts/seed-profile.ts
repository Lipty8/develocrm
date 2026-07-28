import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const profile=process.env.DEVELOCRM_SEED_PROFILE??"none";
const allowed=new Set(["none","pilot","demo"]);
if(!allowed.has(profile))throw new Error("DEVELOCRM_SEED_PROFILE musí být none, pilot nebo demo");
if(profile==="none")process.exit(0);
if(!process.env.DATABASE_URL)throw new Error("Chybí DATABASE_URL");

const files=profile==="demo"
  ? ["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql","0005_preview_documents.sql"]
  : ["0001_preview_block_b.sql","0004_pilot_rezidence_dejvice.sql"];
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
  for(const file of files){
    let sql=await readFile(resolve("backend/seeds",file),"utf8");
    if(profile==="pilot"&&file==="0001_preview_block_b.sql"){
      const marker="INSERT INTO projects (";
      sql=sql.slice(0,sql.indexOf(marker))+"COMMIT;\n";
    }
    await client.query(sql);
  }
}finally{await client.end();}
