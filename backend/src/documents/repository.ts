import type { Database, SqlClient } from "../database.js";

export type DocumentListItem = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  category: string;
  mimeType: string;
  fileSize: number | null;
  storageProvider: "sharepoint" | "preview" | "external";
  webUrl: string | null;
  etag: string | null;
  sensitivity: "normal" | "sensitive";
  updatedAt: string;
  author: string | null;
  version: string | null;
  units: string[];
  parties: string[];
  contracts: string[];
};

export type DocumentDetail = DocumentListItem & {
  externalDriveId: string | null;
  externalItemId: string | null;
  archivedAt: string | null;
  versions: Array<{ id: string; identifier: string; externalVersionId: string | null; label: string; etag: string | null; fileSize: number | null; contentHash: string | null; createdAt: string; author: string | null }>;
};

export type DocumentContext = { tenantId: string; userId: string; membershipId: string };

type DocumentRow = {
  id: string; project_id: string; project_name: string; name: string; category: string; mime_type: string;
  file_size: string | number | null; storage_provider: "sharepoint" | "preview" | "external"; web_url: string | null;
  etag: string | null; sensitivity: "normal" | "sensitive"; updated_at: string; author: string | null; version_label: string | null;
  unit_codes: string | null; party_names: string | null; contract_refs: string | null;
  external_drive_id?: string | null; external_item_id?: string | null; archived_at?: string | null;
};

const documentSelect = `
  SELECT document.id,document.project_id,project.name project_name,document.name,document.category,document.mime_type,
    document.file_size,document.storage_provider,document.web_url,document.etag,document.sensitivity,document.updated_at,
    document.external_drive_id,document.external_item_id,document.archived_at,
    author.display_name author,
    (SELECT version.version_label FROM document_versions version WHERE version.tenant_id=document.tenant_id AND version.document_id=document.id ORDER BY version.created_at DESC,version.id DESC LIMIT 1) version_label,
    (SELECT string_agg(DISTINCT unit.code, ', ' ORDER BY unit.code) FROM unit_documents link JOIN units unit ON unit.tenant_id=link.tenant_id AND unit.project_id=link.project_id AND unit.id=link.unit_id WHERE link.tenant_id=document.tenant_id AND link.document_id=document.id) unit_codes,
    (SELECT string_agg(DISTINCT party.display_name, ', ' ORDER BY party.display_name) FROM party_documents link JOIN parties party ON party.tenant_id=link.tenant_id AND party.id=link.party_id WHERE link.tenant_id=document.tenant_id AND link.document_id=document.id) party_names,
    (SELECT string_agg(DISTINCT contract.reference, ', ' ORDER BY contract.reference) FROM contract_documents link JOIN contracts contract ON contract.tenant_id=link.tenant_id AND contract.project_id=link.project_id AND contract.id=link.contract_id WHERE link.tenant_id=document.tenant_id AND link.document_id=document.id) contract_refs
  FROM documents document
  JOIN projects project ON project.tenant_id=document.tenant_id AND project.id=document.project_id
  JOIN tenant_memberships creator ON creator.tenant_id=document.tenant_id AND creator.id=document.created_by_membership_id
  JOIN users author ON author.id=creator.user_id`;

export class DocumentRepository {
  constructor(private readonly database: Database) {}

  async listProject(input: DocumentContext & { projectId: string; category?: string; unitId?: string; partyId?: string }): Promise<DocumentListItem[]> {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const result = await client.query<DocumentRow>(`${documentSelect}
        WHERE document.tenant_id=$1 AND document.project_id=$3 AND document.archived_at IS NULL
          AND app.has_project_permission(document.tenant_id,$2,document.project_id,'documents.view')
          AND (document.sensitivity='normal' OR app.has_project_permission(document.tenant_id,$2,document.project_id,'documents.view_sensitive'))
          AND ($4::text IS NULL OR document.category=$4)
          AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM unit_documents filter_link WHERE filter_link.tenant_id=document.tenant_id AND filter_link.document_id=document.id AND filter_link.unit_id=$5))
          AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM party_documents filter_link WHERE filter_link.tenant_id=document.tenant_id AND filter_link.document_id=document.id AND filter_link.party_id=$6))
        ORDER BY document.updated_at DESC,document.name`, [input.tenantId,input.membershipId,input.projectId,input.category??null,input.unitId??null,input.partyId??null]);
      return result.rows.map(mapDocument);
    });
  }

  async listUnit(input: DocumentContext & { unitId: string; category?: string }): Promise<DocumentListItem[]> {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const result = await client.query<DocumentRow>(`${documentSelect}
        WHERE document.tenant_id=$1 AND document.archived_at IS NULL
          AND app.has_project_permission(document.tenant_id,$2,document.project_id,'documents.view')
          AND (document.sensitivity='normal' OR app.has_project_permission(document.tenant_id,$2,document.project_id,'documents.view_sensitive'))
          AND ($4::text IS NULL OR document.category=$4)
          AND EXISTS(SELECT 1 FROM unit_documents filter_link WHERE filter_link.tenant_id=document.tenant_id AND filter_link.project_id=document.project_id AND filter_link.document_id=document.id AND filter_link.unit_id=$3)
        ORDER BY document.updated_at DESC,document.name`, [input.tenantId,input.membershipId,input.unitId,input.category??null]);
      return result.rows.map(mapDocument);
    });
  }

  async getById(input: DocumentContext & { documentId: string }): Promise<DocumentDetail | null> {
    return this.database.withContext({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
      const result = await client.query<DocumentRow>(`${documentSelect}
        WHERE document.tenant_id=$1 AND document.id=$3
          AND app.has_project_permission(document.tenant_id,$2,document.project_id,'documents.view')
          AND (document.sensitivity='normal' OR app.has_project_permission(document.tenant_id,$2,document.project_id,'documents.view_sensitive'))`, [input.tenantId,input.membershipId,input.documentId]);
      const row = result.rows[0];
      if (!row) return null;
      const versions = await client.query<{id:string;version_identifier:string;external_version_id:string|null;version_label:string;etag:string|null;file_size:string|number|null;content_hash:string|null;created_at:string;author:string|null}>(`
        SELECT version.id,version.version_identifier,version.external_version_id,version.version_label,version.etag,version.file_size,version.content_hash,version.created_at,author.display_name author
        FROM document_versions version JOIN tenant_memberships creator ON creator.tenant_id=version.tenant_id AND creator.id=version.created_by_membership_id JOIN users author ON author.id=creator.user_id
        WHERE version.tenant_id=$1 AND version.document_id=$2 ORDER BY version.created_at DESC,version.id DESC`,[input.tenantId,input.documentId]);
      return { ...mapDocument(row), externalDriveId:row.external_drive_id??null,externalItemId:row.external_item_id??null,archivedAt:row.archived_at??null,
        versions:versions.rows.map(version=>({id:version.id,identifier:version.version_identifier,externalVersionId:version.external_version_id,label:version.version_label,etag:version.etag,fileSize:numberOrNull(version.file_size),contentHash:version.content_hash,createdAt:version.created_at,author:version.author})) };
    });
  }

  async connectionStatus(input: DocumentContext): Promise<{ status:"not_configured"|"connected"|"error"|"disabled";syncStatus:"idle"|"syncing"|"error"|"paused";lastSuccessfulSyncAt:string|null }> {
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{
      const row=(await client.query<{connection_status:"connected"|"error"|"disabled";sync_status:"idle"|"syncing"|"error"|"paused";last_successful_sync_at:string|null}>(`SELECT connection_status,sync_status,last_successful_sync_at FROM sharepoint_connections WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,[input.tenantId])).rows[0];
      return row?{status:row.connection_status,syncStatus:row.sync_status,lastSuccessfulSyncAt:row.last_successful_sync_at}:{status:"not_configured",syncStatus:"idle",lastSuccessfulSyncAt:null};
    });
  }

  async createMetadata(input: DocumentContext & { projectId:string;name:string;category:string;mimeType:string;fileSize?:number;storageProvider:string;externalDriveId?:string;externalItemId?:string;webUrl?:string;etag?:string;sensitivity?:string;operation?:string }): Promise<{id:string}> {
    return this.command(input,(client)=>client.query<{id:string}>("SELECT app.create_document_metadata($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) id",[input.tenantId,input.projectId,input.name,input.category,input.mimeType,input.fileSize??null,input.storageProvider,input.externalDriveId??null,input.externalItemId??null,input.webUrl??null,input.etag??null,input.sensitivity??"normal",input.membershipId,input.operation??"import"]));
  }

  async updateMetadata(input: DocumentContext & { documentId:string;name:string;category:string;webUrl?:string;etag?:string;fileSize?:number }): Promise<{id:string}> {
    return this.command(input,(client)=>client.query<{id:string}>("SELECT app.update_document_metadata($1,$2,$3,$4,$5,$6,$7,$8) id",[input.tenantId,input.documentId,input.name,input.category,input.webUrl??null,input.etag??null,input.fileSize??null,input.membershipId]));
  }

  async createVersion(input: DocumentContext & { documentId:string;versionIdentifier:string;externalVersionId?:string;versionLabel:string;etag?:string;fileSize?:number;contentHash?:string }): Promise<{id:string}> {
    return this.command(input,(client)=>client.query<{id:string}>("SELECT app.create_document_version($1,$2,$3,$4,$5,$6,$7,$8,$9) id",[input.tenantId,input.documentId,input.versionIdentifier,input.externalVersionId??null,input.versionLabel,input.etag??null,input.fileSize??null,input.contentHash??null,input.membershipId]));
  }

  async archive(input: DocumentContext & { documentId:string;reason:string }): Promise<{id:string}> {
    return this.command(input,(client)=>client.query<{id:string}>("SELECT app.archive_document($1,$2,$3,$4) id",[input.tenantId,input.documentId,input.membershipId,input.reason]));
  }

  async linkProject(input: DocumentContext & { documentId:string;projectId:string }): Promise<{id:string}> { return this.command(input,client=>client.query<{id:string}>("SELECT app.link_document_to_project($1,$2,$3,$4) id",[input.tenantId,input.documentId,input.projectId,input.membershipId])); }
  async linkUnit(input: DocumentContext & { documentId:string;unitId:string }): Promise<{id:string}> { return this.command(input,client=>client.query<{id:string}>("SELECT app.link_document_to_unit($1,$2,$3,$4) id",[input.tenantId,input.documentId,input.unitId,input.membershipId])); }
  async linkParty(input: DocumentContext & { documentId:string;partyId:string }): Promise<{id:string}> { return this.command(input,client=>client.query<{id:string}>("SELECT app.link_document_to_party($1,$2,$3,$4) id",[input.tenantId,input.documentId,input.partyId,input.membershipId])); }
  async linkContract(input: DocumentContext & { documentId:string;contractId:string;contractVersionId?:string;documentVersionId?:string }): Promise<{id:string}> { return this.command(input,client=>client.query<{id:string}>("SELECT app.link_document_to_contract($1,$2,$3,$4,$5,$6) id",[input.tenantId,input.documentId,input.contractId,input.contractVersionId??null,input.documentVersionId??null,input.membershipId])); }

  private async command(input:DocumentContext,query:(client:SqlClient)=>Promise<{rows:Array<{id:string}>}>):Promise<{id:string}>{
    return this.database.withContext({tenantId:input.tenantId,userId:input.userId},async client=>{const result=await query(client);return result.rows[0];});
  }
}

function mapDocument(row:DocumentRow):DocumentListItem{return{id:row.id,projectId:row.project_id,projectName:row.project_name,name:row.name,category:row.category,mimeType:row.mime_type,fileSize:numberOrNull(row.file_size),storageProvider:row.storage_provider,webUrl:row.web_url,etag:row.etag,sensitivity:row.sensitivity,updatedAt:row.updated_at,author:row.author,version:row.version_label,units:splitList(row.unit_codes),parties:splitList(row.party_names),contracts:splitList(row.contract_refs)};}
function splitList(value:string|null):string[]{return value?value.split(", ").filter(Boolean):[];}
function numberOrNull(value:string|number|null):number|null{return value==null?null:Number(value);}
