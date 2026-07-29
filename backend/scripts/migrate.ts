import {readFile,readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {Pool} from "pg";
import {applyMigrations,migrationFromSource} from "../src/migrations/runner.js";

const connectionString=process.env.DATABASE_URL?.trim();
if(!connectionString)throw new Error("Chybí povinná proměnná DATABASE_URL");
const directory=resolve(process.cwd(),"backend/migrations");
const files=(await readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const migrations=await Promise.all(files.map(async filename=>migrationFromSource(filename,await readFile(resolve(directory,filename),"utf8"))));
const pool=new Pool({connectionString,max:1});
const client=await pool.connect();
try{
  await applyMigrations(client,migrations,console.log);
}finally{
  client.release();
  await pool.end();
}
