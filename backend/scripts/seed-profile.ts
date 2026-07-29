import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const profile=process.env.DEVELOCRM_SEED_PROFILE??"none";
const allowed=new Set(["none","pilot","demo"]);
if(!allowed.has(profile))throw new Error("DEVELOCRM_SEED_PROFILE musí být none, pilot nebo demo");
if(profile==="none")process.exit(0);
if(profile==="pilot")throw new Error("Pilotní data se neseedují automaticky. Použijte pilot:bootstrap a poté pilot:import:dejvice s explicitními identifikátory.");
if(!process.env.DATABASE_URL)throw new Error("Chybí DATABASE_URL");

const files=["0001_preview_block_b.sql","0002_preview_block_c.sql","0003_preview_block_d.sql","0005_preview_documents.sql"];
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
  for(const file of files){
    const sql=await readFile(resolve("backend/seeds",file),"utf8");
    await client.query(sql);
  }
}finally{await client.end();}
