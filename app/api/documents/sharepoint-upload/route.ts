import {forwardBackendMutation} from '../../../lib/backend-proxy';
// Fixed backend destination. Identity/project authorization and file/body limits
// are enforced by the existing upload endpoint; no client Graph URL is used.
export async function POST(request:Request){
  return forwardBackendMutation(request,{method:'POST',target:'/v1/documents/sharepoint-upload',body:request.body,
    unavailableMessage:'Nahrání dokumentu vyžaduje připojený backend.'});
}
