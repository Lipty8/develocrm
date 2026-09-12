import type { Database, SqlClient } from "../database.js";

export type MediaEntityType = "project" | "unit";
export type MediaKind = "cover" | "floorplan";

type Context = { tenantId: string; userId: string; membershipId: string };
type MediaAssetRow = {
  id:string;tenant_id:string;project_id:string;unit_id:string|null;entity_type:MediaEntityType;entity_id:string;
  kind:MediaKind;storage_key:string;file_name:string;mime_type:string;uploaded_at:string;uploaded_by_user_id:string|null;
};

export type MediaAsset = {
  id: string;
  tenantId: string;
  projectId: string;
  unitId: string | null;
  entityType: MediaEntityType;
  entityId: string;
  kind: MediaKind;
  storageKey: string;
  fileName: string;
  mimeType: string;
  uploadedAt: string;
  uploadedByUserId: string | null;
};

export class MediaAccessError extends Error {
  constructor(readonly reason: "not_found" | "forbidden" | "invalid") {
    super(reason === "not_found" ? "media not found" : reason === "forbidden" ? "media.read permission required" : "invalid media metadata");
  }
}

export class MediaRepository {
  constructor(private readonly database: Database) {}

  async authorizeUpload(input: Context & { entityType: MediaEntityType; entityId: string; kind: MediaKind }) {
    return this.database.withContext(input, async client => {
      const owner=await this.authorizeOwnerInTransaction(client,input);
      return { tenantId: input.tenantId, projectId: owner.projectId, unitId: owner.unitId, userId: input.userId };
    });
  }

  async getByStorageKey(input: Context & { storageKey: string }): Promise<MediaAsset> {
    return this.database.withContext(input, async client => {
      const row = (await client.query<MediaAssetRow>(`SELECT id,tenant_id,project_id,unit_id,entity_type,entity_id,kind,storage_key,file_name,mime_type,uploaded_at,uploaded_by_user_id
          FROM media_assets WHERE tenant_id=$1 AND storage_key=$2 AND active`, [input.tenantId, input.storageKey])).rows[0];
      if (!row) throw new MediaAccessError("not_found");
      const allowed = (await client.query<{ allowed:boolean }>(
        "SELECT app.has_project_permission($1,$2,$3,'media.read') allowed",
        [input.tenantId, input.membershipId, row.project_id],
      )).rows[0]?.allowed;
      if (!allowed) throw new MediaAccessError("forbidden");
      return mapAsset(row);
    });
  }

  async getForEntity(input: Context & { entityType: MediaEntityType; entityId: string; kind: MediaKind }): Promise<MediaAsset | null> {
    return this.database.withContext(input, async client => {
      const owner = await this.authorizeReadInTransaction(client, input);
      const row = (await client.query<MediaAssetRow>(
        `SELECT id,tenant_id,project_id,unit_id,entity_type,entity_id,kind,storage_key,file_name,mime_type,uploaded_at,uploaded_by_user_id
         FROM media_assets
         WHERE tenant_id=$1 AND project_id=$2 AND entity_type=$3 AND entity_id=$4 AND kind=$5 AND active`,
        [input.tenantId,owner.projectId,input.entityType,input.entityId,input.kind],
      )).rows[0];
      return row ? mapAsset(row) : null;
    });
  }

  async register(input: Context & {
    entityType: MediaEntityType; entityId: string; kind: MediaKind; url: string; storageKey: string;
    fileName: string; mimeType: string;
  }): Promise<MediaAsset> {
    return this.database.withContext(input, async client => {
      const owner = await this.authorizeOwnerInTransaction(client, input);
      const allowedMime=input.kind==="cover"?["image/jpeg","image/png","image/webp"]:["image/jpeg","image/png","image/webp","application/pdf"];
      const expectedPrefix=`${input.tenantId}/${owner.projectId}/${input.entityType}/${input.entityId}/${input.kind}/`;
      const expectedUrl=`/api/media/file/${encodeURIComponent(input.storageKey)}`;
      if(!allowedMime.includes(input.mimeType)||!input.storageKey.startsWith(expectedPrefix)||input.url!==expectedUrl)throw new MediaAccessError("invalid");
      if (input.entityType === "project") {
        await client.query("SELECT app.set_project_cover($1,$2,$3,$4,'crm',$5,$6)", [input.tenantId,input.entityId,input.url,input.mimeType,input.storageKey,input.membershipId]);
      } else {
        await client.query("SELECT app.set_unit_floorplan($1,$2,$3,$4,'crm',$5,$6)", [input.tenantId,input.entityId,input.url,input.mimeType,input.storageKey,input.membershipId]);
      }
      await client.query(
        `UPDATE media_assets SET active=false,replaced_at=now()
         WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 AND kind=$4 AND active`,
        [input.tenantId,input.entityType,input.entityId,input.kind],
      );
      const row = (await client.query<MediaAssetRow>(`INSERT INTO media_assets(tenant_id,project_id,unit_id,entity_type,entity_id,kind,storage_key,file_name,mime_type,uploaded_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT(tenant_id,storage_key) DO UPDATE SET
            project_id=EXCLUDED.project_id,unit_id=EXCLUDED.unit_id,entity_type=EXCLUDED.entity_type,
            entity_id=EXCLUDED.entity_id,kind=EXCLUDED.kind,file_name=EXCLUDED.file_name,mime_type=EXCLUDED.mime_type,
            uploaded_by_user_id=EXCLUDED.uploaded_by_user_id,active=true,replaced_at=NULL
          RETURNING id,tenant_id,project_id,unit_id,entity_type,entity_id,kind,storage_key,file_name,mime_type,uploaded_at,uploaded_by_user_id`,
        [input.tenantId,owner.projectId,owner.unitId,input.entityType,input.entityId,input.kind,input.storageKey,input.fileName,input.mimeType,input.userId],
      )).rows[0];
      return mapAsset(row);
    });
  }

  private async authorizeOwnerInTransaction(client: SqlClient, input: Context & {entityType:MediaEntityType;entityId:string;kind:MediaKind}) {
    if (input.entityType === "project" && input.kind !== "cover") throw new MediaAccessError("not_found");
    if (input.entityType === "unit" && input.kind !== "floorplan") throw new MediaAccessError("not_found");
    const query = input.entityType === "project"
      ? `SELECT project.id project_id, NULL::uuid unit_id FROM projects project
         WHERE project.tenant_id=$1 AND project.id=$2 AND project.archived_at IS NULL`
      : `SELECT unit.project_id,unit.id unit_id FROM units unit
         WHERE unit.tenant_id=$1 AND unit.id=$2 AND unit.archived_at IS NULL`;
    const row = (await client.query(query,[input.tenantId,input.entityId])).rows[0] as {project_id:string;unit_id:string|null}|undefined;
    if (!row) throw new MediaAccessError("not_found");
    const allowed=(await client.query<{allowed:boolean}>("SELECT app.has_project_permission($1,$2,$3,'media.manage') allowed",[input.tenantId,input.membershipId,row.project_id])).rows[0]?.allowed;
    if(!allowed)throw new MediaAccessError("forbidden");
    return { projectId:row.project_id, unitId:row.unit_id };
  }

  private async authorizeReadInTransaction(client: SqlClient, input: Context & {entityType:MediaEntityType;entityId:string;kind:MediaKind}) {
    if (input.entityType === "project" && input.kind !== "cover") throw new MediaAccessError("not_found");
    if (input.entityType === "unit" && input.kind !== "floorplan") throw new MediaAccessError("not_found");
    const query = input.entityType === "project"
      ? `SELECT project.id project_id, NULL::uuid unit_id FROM projects project
         WHERE project.tenant_id=$1 AND project.id=$2
           AND app.has_project_permission(project.tenant_id,$3,project.id,'media.read')`
      : `SELECT unit.project_id,unit.id unit_id FROM units unit
         WHERE unit.tenant_id=$1 AND unit.id=$2
           AND app.has_project_permission(unit.tenant_id,$3,unit.project_id,'media.read')`;
    const row = (await client.query<{project_id:string;unit_id:string|null}>(query,[input.tenantId,input.entityId,input.membershipId])).rows[0];
    if (!row) throw new MediaAccessError("not_found");
    return { projectId:row.project_id, unitId:row.unit_id };
  }
}

function mapAsset(row: MediaAssetRow): MediaAsset {
  return { id:row.id,tenantId:row.tenant_id,projectId:row.project_id,unitId:row.unit_id,entityType:row.entity_type,
    entityId:row.entity_id,kind:row.kind,storageKey:row.storage_key,fileName:row.file_name,mimeType:row.mime_type,
    uploadedAt:row.uploaded_at,uploadedByUserId:row.uploaded_by_user_id };
}
