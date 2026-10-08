import { MicrosoftGraphRequestError, type MicrosoftGraphAdapter } from "./graph-adapter.js";
import { DocumentRepository, type DocumentContext } from "./repository.js";

export type SharePointValidationResult = {
  connectionId: string;
  site: { id: string; displayName: string };
  library: { id: string; name: string };
  rootItemCount: number;
};

export class SharePointConnectionValidationError extends Error {
  constructor(readonly code:string,readonly graphStatus?:number,readonly graphRequestId?:string|null){
    super("Připojení k SharePointu se nepodařilo ověřit");
    this.name="SharePointConnectionValidationError";
  }
}

export class SharePointConnectionService {
  constructor(
    private readonly repository:Pick<DocumentRepository,"configureConnection"|"getConnectionForValidation"|"recordConnectionValidation">,
    private readonly graph:MicrosoftGraphAdapter,
    private readonly managedIdentityClientId:string,
  ) {}

  async configure(input:DocumentContext & {name:string;entraTenantId:string;siteId:string;driveId:string}):Promise<{id:string}>{
    return this.repository.configureConnection({...input,credentialReference:`managed-identity://${this.managedIdentityClientId}`});
  }

  async validate(context:DocumentContext):Promise<SharePointValidationResult>{
    const connection=await this.repository.getConnectionForValidation(context);
    if(!connection)throw new SharePointConnectionValidationError("connection_not_found");
    try{
      if(connection.authenticationMode!=="managed_identity"||connection.credentialReference!==`managed-identity://${this.managedIdentityClientId}`){
        throw new SharePointConnectionValidationError("managed_identity_mismatch");
      }
      const site=await this.graph.getSite(connection.siteId);
      if(!site)throw new SharePointConnectionValidationError("site_not_found",404);
      const drives=await this.graph.listSiteDrives(connection.siteId);
      const drive=drives.find(candidate=>candidate.id===connection.driveId);
      if(!drive)throw new SharePointConnectionValidationError("drive_not_in_site");
      const rootItems=await this.graph.listFiles({siteId:connection.siteId,driveId:connection.driveId});
      await this.repository.recordConnectionValidation({...context,connectionId:connection.id,status:"connected"});
      return {connectionId:connection.id,site:{id:site.id,displayName:site.displayName},library:{id:drive.id,name:drive.name},rootItemCount:rootItems.length};
    }catch(error){
      const normalized=normalizeValidationError(error);
      await this.repository.recordConnectionValidation({...context,connectionId:connection.id,status:"error",errorCode:normalized.code});
      throw normalized;
    }
  }
}

function normalizeValidationError(error:unknown):SharePointConnectionValidationError{
  if(error instanceof SharePointConnectionValidationError)return error;
  if(error instanceof MicrosoftGraphRequestError){
    const code=error.status===401?"graph_unauthorized":error.status===403?"graph_forbidden":error.status===404?"graph_not_found":error.status===429?"graph_throttled":"graph_unavailable";
    return new SharePointConnectionValidationError(code,error.status,error.requestId);
  }
  return new SharePointConnectionValidationError("graph_unavailable");
}
