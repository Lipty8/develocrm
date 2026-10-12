import {randomUUID} from "node:crypto";
import {Database} from "../database.js";
import {expirePreReservations,type HoldExpiryContext} from "./hold-expiry-job.js";

// Run from the existing Azure Container Apps Jobs infrastructure using the API image.
const databaseUrl=process.env.DATABASE_URL;
const contexts=JSON.parse(process.env.HOLD_EXPIRY_CONTEXTS??"[]") as HoldExpiryContext[];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if(!databaseUrl||!Array.isArray(contexts)||!contexts.length||contexts.some(c=>!uuid.test(c.tenantId)||!uuid.test(c.membershipId)))throw new Error("Expiry job requires DATABASE_URL and explicit tenant/membership contexts");
const database=new Database(databaseUrl);
try{
  for(const context of contexts)console.info(JSON.stringify({event:"pre_reservation_expiry",tenantId:context.tenantId,...await expirePreReservations(database,context)}));
}catch(error){
  console.error(JSON.stringify({event:"pre_reservation_expiry_failed",correlationId:randomUUID(),detail:error instanceof Error?error.message:"Unknown error"}));
  process.exitCode=1;
}finally{await database.close();}
