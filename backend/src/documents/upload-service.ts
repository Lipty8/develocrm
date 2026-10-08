import { createHash } from "node:crypto";
import { MicrosoftGraphRequestError, type GraphConnection, type GraphFileMetadata, type MicrosoftGraphAdapter } from "./graph-adapter.js";
import { SharePointFolderStrategy, type DocumentFolderKind } from "./folder-strategy.js";
import { DocumentRepository, type DocumentContext, type DocumentListItem, type DocumentUploadReservation } from "./repository.js";

export type DocumentUploadInput=DocumentContext&{
  projectId:string;idempotencyKey:string;documentId?:string;typeCode?:string;documentName:string;fileName:string;mimeType:string;
  bytes:Uint8Array;versionLabel:string;status?:DocumentListItem["status"];note?:string;unitId?:string;partyId?:string;contractId?:string;salesCaseId?:string;
};
export type DocumentUploadResult={documentId:string;documentVersionId:string;itemId:string;driveId:string;webUrl:string|null;etag:string|null;replayed:boolean};

export class SharePointUploadError extends Error{
  constructor(readonly code:string,readonly graphStatus?:number,readonly graphRequestId?:string|null){
    super("Dokument se nepodařilo uložit do SharePointu.");this.name="SharePointUploadError";
  }
}

type UploadRepository=Pick<DocumentRepository,"getConnectionForUpload"|"reserveUpload"|"getUploadReservation"|"prepareUploadTarget"|"recordGraphUpload"|"finalizeUpload">;

export class SharePointDocumentUploadService{
  constructor(private readonly repository:UploadRepository,private readonly graph:MicrosoftGraphAdapter,
    private readonly managedIdentityClientId:string,private readonly folders=new SharePointFolderStrategy()){}

  async upload(input:DocumentUploadInput):Promise<DocumentUploadResult>{
    validateUploadInput(input);
    const contentHash=`sha256:${sha256(input.bytes)}`;
    const operationType=input.documentId?"version":"create";
    const requestHash=sha256(JSON.stringify({projectId:input.projectId,documentId:input.documentId??null,typeCode:input.typeCode??null,
      documentName:input.documentName,fileName:input.fileName,mimeType:input.mimeType,fileSize:input.bytes.byteLength,contentHash,
      versionLabel:input.versionLabel,status:input.status??"draft",note:input.note??null,unitId:input.unitId??null,partyId:input.partyId??null,
      contractId:input.contractId??null,salesCaseId:input.salesCaseId??null}));
    let reservation=await this.repository.reserveUpload({...input,operationType,existingDocumentId:input.documentId,requestHash,
      originalFileName:input.fileName,fileSize:input.bytes.byteLength,contentHash,status:input.status??"draft"});
    const connection=await this.repository.getConnectionForUpload({...input,projectId:reservation.projectId});
    if(!connection||connection.authenticationMode!=="managed_identity"||connection.credentialReference!==`managed-identity://${this.managedIdentityClientId}`)
      throw new SharePointUploadError("connection_unavailable");
    const graphConnection={siteId:connection.siteId,driveId:connection.driveId};

    if(reservation.state==="completed")return resultFrom(reservation,true);
    if(reservation.state!=="uploaded"){
      const target=await this.resolveTarget(input,reservation,graphConnection);
      if(!reservation.targetPath&&target.path.length){
        await this.repository.prepareUploadTarget({...input,operationId:reservation.id,targetPath:target.path,sharePointFileName:target.fileName});
        reservation=(await this.repository.getUploadReservation({...input,operationId:reservation.id}))??reservation;
      }
      const uploaded=await this.uploadOrRecover(graphConnection,reservation,target.parentItemId,target.fileName,input.bytes,input.mimeType);
      const externalVersionId=await this.externalVersionId(graphConnection,uploaded);
      await this.repository.recordGraphUpload({...input,operationId:reservation.id,driveId:uploaded.driveId,itemId:uploaded.itemId,
        webUrl:uploaded.webUrl,etag:uploaded.etag,externalVersionId,fileSize:uploaded.size});
    }
    const finalized=await this.repository.finalizeUpload({...input,operationId:reservation.id});
    const completed=await this.repository.getUploadReservation({...input,operationId:reservation.id});
    if(!completed?.graphItemId||!completed.graphDriveId)throw new SharePointUploadError("metadata_incomplete");
    return{documentId:finalized.documentId,documentVersionId:finalized.documentVersionId,itemId:completed.graphItemId,
      driveId:completed.graphDriveId,webUrl:completed.graphWebUrl,etag:completed.graphEtag,replayed:finalized.replayed};
  }

  private async resolveTarget(input:DocumentUploadInput,reservation:DocumentUploadReservation,connection:GraphConnection):Promise<{parentItemId:string;fileName:string;path:string[]}>{
    if(reservation.operationType==="version"){
      if(!reservation.currentItemId)throw new SharePointUploadError("document_item_missing");
      const current=await graphRead(()=>this.graph.getFileMetadata(connection,reservation.currentItemId!));
      if(!current||!current.parentItemId)throw new SharePointUploadError("document_item_missing",404);
      return{parentItemId:current.parentItemId,fileName:current.name,path:reservation.targetPath??[]};
    }
    if(reservation.targetPath?.length&&reservation.sharePointFileName){
      return{parentItemId:await this.ensureFolders(connection,reservation.targetPath),fileName:reservation.sharePointFileName,path:reservation.targetPath};
    }
    const category=folderCategory(input.typeCode);
    const path=input.unitId&&reservation.unitCode
      ?this.folders.unitDocuments({projectId:reservation.projectId,projectCode:reservation.projectCode,unitId:input.unitId,unitCode:reservation.unitCode,category})
      :input.partyId&&reservation.partyName
        ?this.folders.clientDocuments({projectId:reservation.projectId,projectCode:reservation.projectCode,partyId:input.partyId,displayName:reservation.partyName})
        :this.folders.projectDocuments({projectId:reservation.projectId,projectCode:reservation.projectCode,category});
    const parentItemId=await this.ensureFolders(connection,path);
    return{parentItemId,fileName:stableFileName(input.fileName,reservation.documentId),path};
  }

  private async ensureFolders(connection:GraphConnection,path:string[]):Promise<string>{
    let parent="root";
    for(const segment of path){
      const children=await graphRead(()=>this.graph.listFiles(connection,parent));
      const existing=children.find(item=>item.isFolder&&item.name===segment);
      if(existing){parent=existing.itemId;continue;}
      try{parent=(await this.graph.createFolder(connection,parent,segment)).itemId;}
      catch(error){
        if(!(error instanceof MicrosoftGraphRequestError)||error.status!==409)throw normalizeUploadError(error);
        const afterConflict=(await graphRead(()=>this.graph.listFiles(connection,parent))).find(item=>item.isFolder&&item.name===segment);
        if(!afterConflict)throw normalizeUploadError(error);
        parent=afterConflict.itemId;
      }
    }
    return parent;
  }

  private async uploadOrRecover(connection:GraphConnection,reservation:DocumentUploadReservation,parentItemId:string,fileName:string,bytes:Uint8Array,mimeType:string):Promise<GraphFileMetadata>{
    const recovered=await this.recoverUploaded(connection,reservation,parentItemId,fileName);
    if(recovered)return recovered;
    try{return await this.graph.uploadFile(connection,parentItemId,fileName,bytes,mimeType);}
    catch(firstError){
      const afterAmbiguousFailure=await this.recoverUploaded(connection,reservation,parentItemId,fileName);
      if(afterAmbiguousFailure)return afterAmbiguousFailure;
      if(!retryable(firstError))throw normalizeUploadError(firstError);
      try{return await this.graph.uploadFile(connection,parentItemId,fileName,bytes,mimeType);}
      catch(secondError){
        const afterRetry=await this.recoverUploaded(connection,reservation,parentItemId,fileName);
        if(afterRetry)return afterRetry;
        throw normalizeUploadError(secondError);
      }
    }
  }

  private async recoverUploaded(connection:GraphConnection,reservation:DocumentUploadReservation,parentItemId:string,fileName:string):Promise<GraphFileMetadata|null>{
    if(reservation.operationType==="create")return(await graphRead(()=>this.graph.listFiles(connection,parentItemId))).find(item=>!item.isFolder&&item.name===fileName)??null;
    if(!reservation.currentItemId)return null;
    const current=await graphRead(()=>this.graph.getFileMetadata(connection,reservation.currentItemId!));
    return current&&current.etag!==reservation.baselineEtag?current:null;
  }

  private async externalVersionId(connection:GraphConnection,item:GraphFileMetadata):Promise<string|null>{
    try{return(await this.graph.getVersions(connection,item.itemId))[0]?.id??item.etag;}
    catch{return item.etag;}
  }
}

export function validateUploadInput(input:Pick<DocumentUploadInput,"idempotencyKey"|"documentId"|"typeCode"|"documentName"|"fileName"|"mimeType"|"bytes"|"versionLabel">):void{
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(input.idempotencyKey))throw new SharePointUploadError("invalid_idempotency_key");
  if(!input.documentId&&!input.typeCode)throw new SharePointUploadError("document_type_required");
  if(!input.documentName.trim()||input.documentName.length>260)throw new SharePointUploadError("invalid_document_name");
  if(input.bytes.byteLength<1||input.bytes.byteLength>4*1024*1024)throw new SharePointUploadError("invalid_file_size");
  if(!input.mimeType.includes("/")||input.mimeType.length>120)throw new SharePointUploadError("invalid_mime_type");
  if(!input.versionLabel.trim()||input.versionLabel.length>80)throw new SharePointUploadError("invalid_version_label");
  validateFileName(input.fileName);
}

export function validateFileName(value:string):void{
  if(value!==value.trim()||value.length<1||value.length>240||value==="."||value===".."||/[\\/\0\r\n]/.test(value)||value.includes(".."))
    throw new SharePointUploadError("invalid_file_name");
}

function stableFileName(original:string,documentId:string):string{
  const dot=original.lastIndexOf(".");const extension=dot>0?original.slice(dot).toLowerCase():"";const stem=dot>0?original.slice(0,dot):original;
  const safe=stem.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase()||"document";
  return`${safe.slice(0,180)}--${documentId.replace(/-/g,"").slice(0,12)}${extension}`;
}
function folderCategory(typeCode?:string):DocumentFolderKind{
  if(["reservation_contract","future_purchase_contract","purchase_contract","amendment"].includes(typeCode??""))return"contract";
  if(["handover_protocol","photo_documentation"].includes(typeCode??""))return"project_documentation";
  if(["client_change","complaint_protocol"].includes(typeCode??""))return"client_document";
  return"other";
}
function sha256(value:Uint8Array|string):string{return createHash("sha256").update(value).digest("hex");}
function retryable(error:unknown):boolean{return !(error instanceof MicrosoftGraphRequestError)||error.status===408||error.status===429||error.status>=500;}
function normalizeUploadError(error:unknown):SharePointUploadError{
  if(error instanceof SharePointUploadError)return error;
  if(error instanceof MicrosoftGraphRequestError){const code=error.status===403?"graph_forbidden":error.status===404?"graph_not_found":error.status===429?"graph_throttled":"graph_unavailable";return new SharePointUploadError(code,error.status,error.requestId);}
  return new SharePointUploadError("graph_unavailable");
}
async function graphRead<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw normalizeUploadError(error);}}
function resultFrom(reservation:DocumentUploadReservation,replayed:boolean):DocumentUploadResult{
  if(!reservation.graphItemId||!reservation.graphDriveId)throw new SharePointUploadError("metadata_incomplete");
  return{documentId:reservation.documentId,documentVersionId:reservation.documentVersionId,itemId:reservation.graphItemId,driveId:reservation.graphDriveId,
    webUrl:reservation.graphWebUrl,etag:reservation.graphEtag,replayed};
}
