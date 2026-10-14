import {backendAuthorization} from "../../../../../lib/backend-proxy";
export async function GET(request:Request,context:{params:Promise<{projectId:string}>}){
 const {projectId}=await context.params;
 const base=process.env.DEVELOCRM_API_URL?.replace(/\/$/,"");const tenant=process.env.DEVELOCRM_TENANT_ID;const authorization=backendAuthorization(request.headers.get('authorization'));
 if(!base||!tenant||!authorization)return Response.json({error:"Dopady archivace nelze načíst."},{status:503});
 const response=await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/archive-impact`,{headers:{authorization,'x-tenant-id':tenant},cache:'no-store'});
 return Response.json(await response.json(),{status:response.status});
}
