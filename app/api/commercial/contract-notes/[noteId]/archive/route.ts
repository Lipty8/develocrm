import {forwardBackendMutation} from "../../../../../lib/backend-proxy";
export async function POST(request:Request,context:{params:Promise<{noteId:string}>}){const {noteId}=await context.params;return forwardBackendMutation(request,{method:"POST",target:`/v1/contract-notes/${encodeURIComponent(noteId)}/archive`,unavailableMessage:"Archivace poznámky vyžaduje připojený backend"});}
