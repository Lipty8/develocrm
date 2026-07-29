import type {IdentitySession} from "./identity-repository";
import { responseAllowsBrowserFallback } from "../lib/data-mode";

export type ProfileInput={displayName:string;jobTitle:string;phone:string;initials:string;language:"cs"|"en";timezone:string;notifications:{email:boolean;inApp:boolean}};
const KEY="develocrm.profile.v32";

export const profileRepository={
  async update(input:ProfileInput):Promise<IdentitySession["user"]>{
    const response=await fetch("/api/identity/profile",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return ((await response.json()) as {user:IdentitySession["user"]}).user;
    if(response.status===503&&responseAllowsBrowserFallback(response)&&typeof window!=="undefined"){
      const user={id:"prototype-iva",email:"iva@develo.example",displayName:input.displayName,jobTitle:input.jobTitle,phone:input.phone,initials:input.initials,language:input.language,timezone:input.timezone,notifications:input.notifications};
      localStorage.setItem(KEY,JSON.stringify(user));return user;
    }
    throw new Error(((await response.json().catch(()=>({}))) as {error?:string}).error??"Profil nelze uložit");
  },
  hydrate(user:IdentitySession["user"]){if(typeof window==="undefined")return user;const stored=localStorage.getItem(KEY);return stored?{...user,...JSON.parse(stored)}:user;}
};
