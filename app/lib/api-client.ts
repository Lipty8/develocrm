"use client";

import { entraAuth } from "./entra-auth";
import { clientUsesBrowserAdapter } from "./data-mode";
import { announceDataMutation } from "./data-invalidation";

export function createApiFetch(
  auth:{getAccessToken():Promise<string|null>;refreshAccessToken?():Promise<string|null>},
  transport:typeof fetch,
  browserMode:()=>boolean=clientUsesBrowserAdapter,
):typeof fetch {
  return async (input:RequestInfo|URL,init:RequestInit={})=>{
    if(browserMode())return transport(input,init);
    const headers=new Headers(init.headers);
    const method=(init.method??(input instanceof Request?input.method:"GET")).toUpperCase();
    const mutation=["POST","PATCH","DELETE"].includes(method);
    const requestCorrelationId=headers.get("x-correlation-id")||crypto.randomUUID();
    headers.set("x-correlation-id",requestCorrelationId);
    const targetPath=typeof input==="string"?input:input instanceof URL?input.pathname:input.url;
    if(mutation)console.info(JSON.stringify({event:"frontend.mutation.start",correlationId:requestCorrelationId,method,target:targetPath}));
    let token:string|null;
    try{
      token=await auth.getAccessToken();
    }catch(error){
      if(mutation)console.error(JSON.stringify({event:"frontend.mutation.auth_error",correlationId:requestCorrelationId,method,target:targetPath,errorName:error instanceof Error?error.name:"Error",errorMessage:error instanceof Error?error.message:"Token se nepodařilo získat"}));
      throw error;
    }
    if(token){
      headers.set("authorization",`${mutation?"DeveloCRM":"Bearer"} ${token}`);
    }
    try{
      let response=await transport(input,{...init,headers});
      if(response.status===401&&auth.refreshAccessToken){
        const refreshed=await auth.refreshAccessToken();
        if(refreshed){
          headers.set("authorization",`${mutation?"DeveloCRM":"Bearer"} ${refreshed}`);
          response=await transport(input,{...init,headers});
          if(response.ok&&typeof window!=="undefined")window.dispatchEvent(new CustomEvent("develocrm:session-restored"));
        }
      }
      if(response.status===401&&typeof window!=="undefined")window.dispatchEvent(new CustomEvent("develocrm:authentication-required"));
      if(mutation)console.info(JSON.stringify({event:"frontend.mutation.complete",correlationId:requestCorrelationId,method,target:targetPath,status:response.status}));
      if(mutation&&response.ok)announceDataMutation({method,target:targetPath});
      return response;
    }catch(error){
      if(mutation)console.error(JSON.stringify({event:"frontend.mutation.transport_error",correlationId:requestCorrelationId,method,target:targetPath,errorName:error instanceof Error?error.name:"Error",errorMessage:error instanceof Error?error.message:"Transport selhal"}));
      throw error;
    }
  };
}

export const apiFetch=createApiFetch(entraAuth,(input,init)=>fetch(input,init));
