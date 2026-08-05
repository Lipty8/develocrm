"use client";

import { entraAuth } from "./entra-auth";
import { clientUsesBrowserAdapter } from "./data-mode";

export function createApiFetch(
  auth:{getAccessToken():Promise<string|null>},
  transport:typeof fetch,
  browserMode:()=>boolean=clientUsesBrowserAdapter,
):typeof fetch {
  return async (input:RequestInfo|URL,init:RequestInit={})=>{
    if(browserMode())return transport(input,init);
    const token=await auth.getAccessToken();
    const headers=new Headers(init.headers);
    if(token)headers.set("authorization",`Bearer ${token}`);
    if(!headers.has("x-correlation-id"))headers.set("x-correlation-id",crypto.randomUUID());
    return transport(input,{...init,headers});
  };
}

export const apiFetch=createApiFetch(entraAuth,(input,init)=>fetch(input,init));
