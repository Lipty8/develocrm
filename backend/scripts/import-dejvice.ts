import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import pg from "pg";
import {importDejvice} from "../src/imports/dejvice.js";

const args=parseArgs(process.argv.slice(2));
const databaseUrl=process.env.DATABASE_URL?.trim();
if(!databaseUrl)throw new Error("Chybí DATABASE_URL pro migračního administrátora");
for(const key of ["tenant-id","membership-id"] as const)if(!args[key])throw new Error(`Chybí --${key}`);
const client=new pg.Client({connectionString:databaseUrl});
await client.connect();
try{
  const source=await readFile(resolve("backend/seeds/0004_pilot_rezidence_dejvice.sql"),"utf8");
  const report=await importDejvice(client,source,{tenantId:args["tenant-id"],membershipId:args["membership-id"],dryRun:Boolean(args["dry-run"])});
  console.log(JSON.stringify(report,null,2));
}finally{await client.end();}

function parseArgs(values:string[]):Record<string,string>{
  const result:Record<string,string>={};
  for(let index=0;index<values.length;index++){
    const value=values[index];if(!value.startsWith("--"))throw new Error(`Neplatný argument ${value}`);
    const key=value.slice(2);if(key==="dry-run"){result[key]="true";continue;}
    const next=values[++index];if(!next||next.startsWith("--"))throw new Error(`Chybí hodnota --${key}`);result[key]=next;
  }
  return result;
}
