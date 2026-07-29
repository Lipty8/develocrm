import { Database } from "../src/database.js";
import { PilotBootstrapService } from "../src/iam/pilot-bootstrap.js";

const args=parseArgs(process.argv.slice(2));
const databaseUrl=process.env.DATABASE_URL?.trim();
if(!databaseUrl)throw new Error("Chybí DATABASE_URL pro migračního administrátora");
const required=["entra-tenant-id","admin-oid","admin-email","admin-name","workspace-name"] as const;
for(const name of required)if(!args[name])throw new Error(`Chybí --${name}`);
const database=new Database(databaseUrl);
try{
  const result=await new PilotBootstrapService(database).bootstrap({
    entraTenantId:args["entra-tenant-id"],
    adminOid:args["admin-oid"],
    adminEmail:args["admin-email"],
    adminName:args["admin-name"],
    workspaceName:args["workspace-name"],
    workspaceSlug:args["workspace-slug"],
    workspaceId:args["workspace-id"],
  });
  console.log(JSON.stringify({status:result.created?"created":"already_configured",...result},null,2));
}finally{await database.close();}

function parseArgs(values:string[]):Record<string,string>{
  const result:Record<string,string>={};
  for(let index=0;index<values.length;index+=2){
    const key=values[index]?.replace(/^--/,"");const value=values[index+1];
    if(!key||!value||values[index][0]!=="-"||value.startsWith("--"))throw new Error(`Neplatný argument ${values[index]??""}`);
    result[key]=value;
  }
  return result;
}
