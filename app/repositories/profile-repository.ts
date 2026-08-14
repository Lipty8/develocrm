import type {IdentitySession} from "./identity-repository";
import { responseAllowsBrowserFallback } from "../lib/data-mode";
import { apiFetch } from "../lib/api-client";

export type ProfileInput={displayName:string;jobTitle:string;phone:string;initials:string;language:"cs"|"en";timezone:string;notifications:{email:boolean;inApp:boolean}};
const KEY="develocrm.profile.v32";
type StoredProfile=Pick<IdentitySession["user"],"displayName"|"jobTitle"|"phone"|"initials"|"language"|"timezone"|"notifications">;

export const profileRepository={
  async update(input:ProfileInput):Promise<IdentitySession["user"]>{
    const response=await apiFetch("/api/identity/profile",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return ((await response.json()) as {user:IdentitySession["user"]}).user;
    if(response.status===503&&responseAllowsBrowserFallback(response)&&typeof window!=="undefined"){
      const user={id:"prototype-iva",email:"iva@develo.example",displayName:input.displayName,jobTitle:input.jobTitle,phone:input.phone,initials:input.initials,language:input.language,timezone:input.timezone,notifications:input.notifications};
      localStorage.setItem(KEY,JSON.stringify({displayName:user.displayName,jobTitle:user.jobTitle,phone:user.phone,initials:user.initials,language:user.language,timezone:user.timezone,notifications:user.notifications} satisfies StoredProfile));return user;
    }
    throw new Error(((await response.json().catch(()=>({}))) as {error?:string}).error??"Profil nelze uložit");
  },
  hydrate(user:IdentitySession["user"]){if(typeof window==="undefined")return user;const stored=localStorage.getItem(KEY);if(!stored)return user;try{const parsed=JSON.parse(stored) as Partial<StoredProfile>;return{...user,...("displayName" in parsed?{displayName:parsed.displayName}:{}),...("jobTitle" in parsed?{jobTitle:parsed.jobTitle}:{}),...("phone" in parsed?{phone:parsed.phone}:{}),...("initials" in parsed?{initials:parsed.initials}:{}),...("language" in parsed?{language:parsed.language}:{}),...("timezone" in parsed?{timezone:parsed.timezone}:{}),...("notifications" in parsed?{notifications:parsed.notifications}:{})};}catch{return user;}}
};
