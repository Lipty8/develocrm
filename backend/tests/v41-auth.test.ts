import assert from "node:assert/strict";
import test from "node:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import { EntraTokenVerifier } from "../src/auth/entra.js";
import { EntraAuthController } from "../../app/lib/entra-auth.js";
import { createApiFetch } from "../../app/lib/api-client.js";

const tenantId="10000000-0000-4000-8000-000000000001";
const clientId="20000000-0000-4000-8000-000000000001";
const issuer=`https://login.microsoftonline.com/${tenantId}/v2.0`;
const {privateKey,publicKey}=await generateKeyPair("RS256");
const jwk=await exportJWK(publicKey) as JWK;
jwk.kid="v41-test";
jwk.alg="RS256";
const localJwks=createLocalJWKSet({keys:[jwk]});

async function token(overrides:Record<string,unknown>={},audience=clientId){
  const now=Math.floor(Date.now()/1000);
  const claims={tid:tenantId,oid:"30000000-0000-4000-8000-000000000001",scp:"access_as_user",preferred_username:"admin@example.test",name:"Pilot Admin",...overrides};
  return new SignJWT(claims).setProtectedHeader({alg:"RS256",kid:"v41-test"})
    .setIssuer(issuer).setAudience(audience).setIssuedAt(now).setExpirationTime((claims.exp as number|undefined)??now+3600).sign(privateKey);
}

const verifier=()=>new EntraTokenVerifier(clientId,new Set([tenantId]),"access_as_user",()=>localJwks);

test("Entra verifier přijme delegated access token se scope, tid a oid",async()=>{
  const identity=await verifier().verify(`Bearer ${await token()}`);
  assert.equal(identity.entraTenantId,tenantId);
  assert.equal(identity.subject,"30000000-0000-4000-8000-000000000001");
});

test("Entra verifier odmítne chybnou audience a token jiné aplikace",async()=>{
  await assert.rejects(verifier().verify(`Bearer ${await token({},"other-app")}`),/aud(?:ience)?/i);
});

test("Entra verifier odmítne nepovolený tenant",async()=>{
  const otherTenant="10000000-0000-4000-8000-000000000099";
  const otherIssuer=`https://login.microsoftonline.com/${otherTenant}/v2.0`;
  const value=await new SignJWT({tid:otherTenant,oid:"oid",scp:"access_as_user",preferred_username:"a@b.test"})
    .setProtectedHeader({alg:"RS256",kid:"v41-test"}).setIssuer(otherIssuer).setAudience(clientId).setExpirationTime("1h").sign(privateKey);
  await assert.rejects(verifier().verify(`Bearer ${value}`),/tenant není povolen/i);
});

test("Entra verifier odmítne token bez oid",async()=>{
  await assert.rejects(verifier().verify(`Bearer ${await token({oid:undefined,sub:"fallback-sub"})}`),/oid/i);
});

test("Entra verifier odmítne application-only token bez access_as_user",async()=>{
  await assert.rejects(verifier().verify(`Bearer ${await token({scp:undefined,roles:["Api.Access"]})}`),/access_as_user/i);
});

test("Entra verifier odmítne expirovaný token",async()=>{
  await assert.rejects(verifier().verify(`Bearer ${await token({exp:Math.floor(Date.now()/1000)-60})}`),/expired/i);
});

function mockAccount(){return{homeAccountId:"home",environment:"login.microsoftonline.com",tenantId,username:"admin@example.test",localAccountId:"local",name:"Pilot Admin"};}
function authResult(accessToken="api-token"){return{accessToken,account:mockAccount(),expiresOn:new Date(Date.now()+3600_000),authority,uniqueId:"local",tenantId,idToken:"not-used",idTokenClaims:{},scopes:["access_as_user"],tokenType:"Bearer",correlationId:"test",fromCache:true};}
const authority=`https://login.microsoftonline.com/${tenantId}`;
const frontendConfig={mode:"api" as const,clientId:"frontend",tenantId,authority,apiScope:`api://${clientId}/access_as_user`,redirectUri:"https://crm.test/dashboard",postLogoutRedirectUri:"https://crm.test"};

test("frontend MSAL obnoví účet a používá acquireTokenSilent",async()=>{
  let silentCalls=0;
  const account=mockAccount();
  const controller=new EntraAuthController({
    loadConfig:async()=>frontendConfig,
    createClient:()=>({
      initialize:async()=>undefined,handleRedirectPromise:async()=>null,getActiveAccount:()=>account,
      setActiveAccount:()=>undefined,getAllAccounts:()=>[account],loginRedirect:async()=>undefined,
      acquireTokenSilent:async()=>{silentCalls++;return authResult();},
      acquireTokenRedirect:async()=>undefined,logoutRedirect:async()=>undefined,
    }),
  });
  assert.equal((await controller.initialize()).authenticated,true);
  assert.equal(await controller.getAccessToken(),"api-token");
  assert.equal(await controller.getAccessToken(),"api-token");
  assert.equal(silentCalls,1);
});

test("frontend MSAL sloučí souběžné požadavky o access token",async()=>{
  let silentCalls=0;
  const account=mockAccount();
  const controller=new EntraAuthController({
    loadConfig:async()=>frontendConfig,
    createClient:()=>({
      initialize:async()=>undefined,handleRedirectPromise:async()=>null,getActiveAccount:()=>account,
      setActiveAccount:()=>undefined,getAllAccounts:()=>[account],loginRedirect:async()=>undefined,
      acquireTokenSilent:async()=>{silentCalls++;await new Promise(resolve=>setTimeout(resolve,10));return authResult();},
      acquireTokenRedirect:async()=>undefined,logoutRedirect:async()=>undefined,
    }),
  });
  const values=await Promise.all([controller.getAccessToken(),controller.getAccessToken(),controller.getAccessToken()]);
  assert.deepEqual(values,["api-token","api-token","api-token"]);
  assert.equal(silentCalls,1);
});

test("centrální API klient připojí Bearer token a při chybě nepoužije fallback",async()=>{
  let called=0;
  let correlationId="";
  const transport=(async(_input:RequestInfo|URL,init?:RequestInit)=>{called++;const headers=new Headers(init?.headers);correlationId=headers.get("x-correlation-id")??"";return Response.json({authorization:headers.get("authorization")});}) as typeof fetch;
  const wrapped=createApiFetch({getAccessToken:async()=>"api-token"},transport,()=>false);
  const response=await wrapped("/api/catalog");
  assert.equal((await response.json()).authorization,"Bearer api-token");
  assert.match(correlationId,/^[0-9a-f-]{36}$/);
  const failing=createApiFetch({getAccessToken:async()=>{throw new Error("token failed");}},transport,()=>false);
  await assert.rejects(failing("/api/catalog"),/token failed/);
  assert.equal(called,1);
});

test("frontend logout používá MSAL logoutRedirect",async()=>{
  let loggedOut=false;
  const account=mockAccount();
  const controller=new EntraAuthController({
    loadConfig:async()=>frontendConfig,
    createClient:()=>({
      initialize:async()=>undefined,handleRedirectPromise:async()=>null,getActiveAccount:()=>account,
      setActiveAccount:()=>undefined,getAllAccounts:()=>[account],loginRedirect:async()=>undefined,
      acquireTokenSilent:async()=>authResult(),acquireTokenRedirect:async()=>undefined,
      logoutRedirect:async()=>{loggedOut=true;},
    }),
  });
  await controller.logout();
  assert.equal(loggedOut,true);
});
