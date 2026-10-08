export type GraphConnection = {
  driveId: string;
  siteId: string;
};

export type GraphFileMetadata = {
  driveId: string;
  itemId: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  etag: string | null;
  webUrl: string | null;
  parentItemId: string | null;
  isFolder: boolean;
};

export type GraphFileVersion = {
  id: string;
  label: string;
  size: number | null;
  etag: string | null;
  createdAt: string | null;
};

export type GraphSiteMetadata = { id: string; displayName: string; webUrl: string | null };
export type GraphDriveMetadata = { id: string; name: string; webUrl: string | null; driveType: string | null };

export type GraphDeltaPage = {
  items: GraphFileMetadata[];
  deletedItemIds: string[];
  nextCursor: string | null;
};

export interface GraphTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface MicrosoftGraphAdapter {
  getSite(siteId: string): Promise<GraphSiteMetadata | null>;
  listSiteDrives(siteId: string): Promise<GraphDriveMetadata[]>;
  listFiles(connection: GraphConnection, parentItemId?: string): Promise<GraphFileMetadata[]>;
  uploadFile(connection: GraphConnection, parentItemId: string, fileName: string, bytes: Uint8Array, mimeType: string): Promise<GraphFileMetadata>;
  getFileMetadata(connection: GraphConnection, itemId: string): Promise<GraphFileMetadata | null>;
  downloadFile(connection: GraphConnection, itemId: string, versionId?: string): Promise<Uint8Array>;
  createFolder(connection: GraphConnection, parentItemId: string, folderName: string): Promise<GraphFileMetadata>;
  moveOrRenameFile(connection: GraphConnection, itemId: string, parentItemId: string, newName?: string): Promise<GraphFileMetadata>;
  getVersions(connection: GraphConnection, itemId: string): Promise<GraphFileVersion[]>;
  delta(connection: GraphConnection, encryptedCursor?: string): Promise<GraphDeltaPage>;
}

export class GraphUnavailableError extends Error {
  constructor() {
    super("Microsoft SharePoint není pro tento workspace připojen");
  }
}

export class MicrosoftGraphRequestError extends Error {
  constructor(readonly status: number, readonly requestId: string | null) {
    super(`Microsoft Graph request failed (${status})`);
    this.name = "MicrosoftGraphRequestError";
  }
}

/** Preview never pretends to upload to SharePoint and never emits fake Graph identifiers. */
export class PreviewGraphAdapter implements MicrosoftGraphAdapter {
  async getSite(): Promise<GraphSiteMetadata | null> { return null; }
  async listSiteDrives(): Promise<GraphDriveMetadata[]> { return []; }
  async listFiles(): Promise<GraphFileMetadata[]> { return []; }
  async getFileMetadata(): Promise<GraphFileMetadata | null> { return null; }
  async downloadFile(): Promise<Uint8Array> { throw new GraphUnavailableError(); }
  async getVersions(): Promise<GraphFileVersion[]> { return []; }
  async delta(): Promise<GraphDeltaPage> { return { items: [], deletedItemIds: [], nextCursor: null }; }
  async uploadFile(): Promise<GraphFileMetadata> { throw new GraphUnavailableError(); }
  async createFolder(): Promise<GraphFileMetadata> { throw new GraphUnavailableError(); }
  async moveOrRenameFile(): Promise<GraphFileMetadata> { throw new GraphUnavailableError(); }
}

/** Production adapter. Credentials stay behind the injected token provider (Managed Identity/Key Vault). */
export class EntraMicrosoftGraphAdapter implements MicrosoftGraphAdapter {
  constructor(private readonly tokens: GraphTokenProvider, private readonly graphBaseUrl = "https://graph.microsoft.com/v1.0") {}

  async getSite(siteId: string): Promise<GraphSiteMetadata | null> {
    const response = await this.raw(`/sites/${encodeURIComponent(siteId)}?$select=id,displayName,webUrl`);
    if (response.status === 404) return null;
    if (!response.ok) throw graphRequestError(response);
    const site = await response.json() as Record<string, unknown>;
    return { id: String(site.id ?? ""), displayName: String(site.displayName ?? ""), webUrl: stringValue(site.webUrl) };
  }

  async listSiteDrives(siteId: string): Promise<GraphDriveMetadata[]> {
    const payload = await this.request<{ value?: Array<Record<string, unknown>> }>(`/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl,driveType`);
    return (payload.value ?? []).map((drive) => ({
      id: String(drive.id ?? ""), name: String(drive.name ?? ""), webUrl: stringValue(drive.webUrl), driveType: stringValue(drive.driveType),
    }));
  }

  async listFiles(connection: GraphConnection, parentItemId = "root"): Promise<GraphFileMetadata[]> {
    const parentPath=parentItemId==="root"?"root":`items/${encodeURIComponent(parentItemId)}`;
    const payload = await this.request<{ value?: unknown[] }>(`/drives/${encodeURIComponent(connection.driveId)}/${parentPath}/children`);
    return (payload.value ?? []).map((item) => mapGraphItem(connection.driveId, item));
  }

  async uploadFile(connection: GraphConnection, parentItemId: string, fileName: string, bytes: Uint8Array, mimeType: string): Promise<GraphFileMetadata> {
    const item = await this.request<unknown>(`/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(parentItemId)}:/${encodeURIComponent(fileName)}:/content`, {
      method: "PUT", headers: { "content-type": mimeType }, body: Uint8Array.from(bytes).buffer,
    });
    return mapGraphItem(connection.driveId, item);
  }

  async getFileMetadata(connection: GraphConnection, itemId: string): Promise<GraphFileMetadata | null> {
    const response = await this.raw(`/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw graphRequestError(response);
    return mapGraphItem(connection.driveId, await response.json());
  }

  async downloadFile(connection: GraphConnection, itemId: string, versionId?: string): Promise<Uint8Array> {
    const suffix=versionId?`/versions/${encodeURIComponent(versionId)}/content`:"/content";
    // Listing driveItem versions is available in Graph v1.0, while downloading
    // one exact historical version is currently exposed only by Graph beta.
    // Keep beta isolated to this read-only call; current-file reads stay on v1.0.
    const absolute=versionId
      ?`${this.graphBaseUrl.replace(/\/v1\.0\/?$/, "/beta")}/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}${suffix}`
      :undefined;
    const response=await this.raw(absolute??`/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}${suffix}`,undefined,Boolean(absolute));
    if(!response.ok)throw graphRequestError(response);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.byteLength<1||bytes.byteLength>8*1024*1024)throw new MicrosoftGraphRequestError(413,response.headers.get("request-id"));
    return bytes;
  }

  async createFolder(connection: GraphConnection, parentItemId: string, folderName: string): Promise<GraphFileMetadata> {
    const item = await this.request<unknown>(`/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(parentItemId)}/children`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: folderName, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    return mapGraphItem(connection.driveId, item);
  }

  async moveOrRenameFile(connection: GraphConnection, itemId: string, parentItemId: string, newName?: string): Promise<GraphFileMetadata> {
    const item = await this.request<unknown>(`/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(newName ? { name: newName } : {}), parentReference: { id: parentItemId } }),
    });
    return mapGraphItem(connection.driveId, item);
  }

  async getVersions(connection: GraphConnection, itemId: string): Promise<GraphFileVersion[]> {
    const payload = await this.request<{ value?: Array<Record<string, unknown>> }>(`/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}/versions`);
    return (payload.value ?? []).map((item) => ({
      id: String(item.id ?? ""), label: String(item.id ?? ""),
      size: typeof item.size === "number" ? item.size : null,
      etag: typeof item.eTag === "string" ? item.eTag : null,
      createdAt: typeof item.lastModifiedDateTime === "string" ? item.lastModifiedDateTime : null,
    }));
  }

  async delta(connection: GraphConnection, encryptedCursor?: string): Promise<GraphDeltaPage> {
    const path = encryptedCursor || `/drives/${encodeURIComponent(connection.driveId)}/root/delta`;
    const payload = await this.request<Record<string, unknown>>(path, undefined, Boolean(encryptedCursor));
    const rawItems = Array.isArray(payload.value) ? payload.value : [];
    const deletedItemIds: string[] = [];
    const items: GraphFileMetadata[] = [];
    for (const item of rawItems) {
      const record = item as Record<string, unknown>;
      if (record.deleted) deletedItemIds.push(String(record.id ?? ""));
      else items.push(mapGraphItem(connection.driveId, record));
    }
    return { items, deletedItemIds, nextCursor: stringValue(payload["@odata.nextLink"] ?? payload["@odata.deltaLink"]) };
  }

  private async request<T>(path: string, init?: RequestInit, absolute = false): Promise<T> {
    const response = await this.raw(path, init, absolute);
    if (!response.ok) throw graphRequestError(response);
    return response.json() as Promise<T>;
  }

  private async raw(path: string, init?: RequestInit, absolute = false): Promise<Response> {
    const token = await this.tokens.getAccessToken();
    return fetch(absolute ? path : `${this.graphBaseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init?.headers ?? {}) },
    });
  }
}

function graphRequestError(response: Response): MicrosoftGraphRequestError {
  return new MicrosoftGraphRequestError(response.status, response.headers.get("request-id") ?? response.headers.get("client-request-id"));
}

function mapGraphItem(driveId: string, input: unknown): GraphFileMetadata {
  const item = (input ?? {}) as Record<string, unknown>;
  const file = item.file as Record<string, unknown> | undefined;
  const parent = item.parentReference as Record<string, unknown> | undefined;
  return {
    driveId, itemId: String(item.id ?? ""), name: String(item.name ?? ""),
    mimeType: stringValue(file?.mimeType), size: typeof item.size === "number" ? item.size : null,
    etag: stringValue(item.eTag), webUrl: stringValue(item.webUrl), parentItemId: stringValue(parent?.id),
    isFolder: Boolean(item.folder),
  };
}

function stringValue(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
