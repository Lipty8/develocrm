import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Database} from '../database.js';
import {ManagedIdentityGraphTokenProvider} from '../documents/managed-identity-token-provider.js';
import {EntraMicrosoftGraphAdapter} from '../documents/graph-adapter.js';
import {runReadinessGate} from './readiness-gate.js';

const required=(name:string)=>{const value=process.env[name]?.trim();if(!value)throw new Error(`Missing ${name}`);return value;};
const database=new Database(required('DATABASE_URL'));
try{
 const identityClientId=required('SHAREPOINT_MANAGED_IDENTITY_CLIENT_ID');
 const tokens=new ManagedIdentityGraphTokenProvider(identityClientId),graph=new EntraMicrosoftGraphAdapter(tokens);
 const directory=new URL('../../migrations/',import.meta.url);
 const expectedMigrations=await Promise.all((await readdir(directory)).filter(f=>f.endsWith('.sql')).sort().map(async filename=>({filename,checksum:createHash('sha256').update(await readFile(new URL(filename,directory))).digest('hex')})));
 const result=await runReadinessGate({database,tokens,graph,identityClientId},{tenantId:required('READINESS_TENANT_ID'),userId:required('READINESS_USER_ID'),membershipId:required('READINESS_MEMBERSHIP_ID'),
  expectedMigrations,apiOrigin:required('READINESS_API_ORIGIN'),frontendCompatibilityVerified:process.env.READINESS_FRONTEND_SMOKE_VERIFIED==='true'});
 console.log(JSON.stringify({event:'pilot.readiness',...result}));if(!result.ready)process.exitCode=1;
}catch(error){console.error(JSON.stringify({event:'pilot.readiness.failed',errorName:error instanceof Error?error.name:'Error'}));process.exitCode=1;}
finally{await database.close();}
