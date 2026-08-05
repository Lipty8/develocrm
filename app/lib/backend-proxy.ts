import { apiUnavailable } from "./data-mode";

export type BackendMutationMethod = "POST" | "PATCH" | "DELETE";

type MutationOptions = {
  method: BackendMutationMethod;
  target: string;
  unavailableMessage: string;
  body?: BodyInit | null;
  contentType?: string | null;
};

type ProxyLog = {
  event: "bff.mutation.start" | "bff.mutation.complete" | "bff.mutation.transport_error" | "bff.mutation.unavailable";
  correlationId: string;
  method: BackendMutationMethod;
  target: string;
  status?: number;
  durationMs?: number;
  errorName?: string;
  errorMessage?: string;
};

function writeLog(level: "info" | "warn" | "error", value: ProxyLog): void {
  console[level](JSON.stringify(value));
}

function correlationId(request: Request): string {
  const incoming = request.headers.get("x-correlation-id")?.trim();
  return incoming || crypto.randomUUID();
}

function backendAuthorization(value: string | null): string | null {
  const authorization=value?.trim();
  if (!authorization) return null;
  if (authorization.startsWith("DeveloCRM ")) return `Bearer ${authorization.slice("DeveloCRM ".length)}`;
  return authorization;
}

function safeTarget(backendUrl: string, target: string): URL {
  if (!target.startsWith("/")) throw new Error("Backend target musí být relativní cesta");
  const backend = new URL(backendUrl);
  const resolved = new URL(target, `${backend.origin}/`);
  if (resolved.origin !== backend.origin) throw new Error("Backend target nesmí změnit origin");
  return resolved;
}

export async function forwardBackendMutation(request: Request, options: MutationOptions): Promise<Response> {
  const backendUrl = process.env.DEVELOCRM_API_URL?.trim().replace(/\/$/, "");
  const tenantId = process.env.DEVELOCRM_TENANT_ID?.trim();
  const authorization = backendAuthorization(request.headers.get("authorization"));
  const requestCorrelationId = correlationId(request);

  if (!backendUrl || !tenantId || !authorization) {
    writeLog("warn", {
      event: "bff.mutation.unavailable",
      correlationId: requestCorrelationId,
      method: options.method,
      target: options.target,
    });
    return apiUnavailable(options.unavailableMessage, requestCorrelationId);
  }

  let target: URL;
  try {
    target = safeTarget(backendUrl, options.target);
  } catch (error) {
    writeLog("error", {
      event: "bff.mutation.transport_error",
      correlationId: requestCorrelationId,
      method: options.method,
      target: options.target,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : "Neplatný backend target",
    });
    return Response.json(
      { error: "Neplatná konfigurace backendové proxy", correlationId: requestCorrelationId, retryable: false },
      { status: 500, headers: { "x-correlation-id": requestCorrelationId } },
    );
  }

  const contentType = options.contentType === undefined
    ? request.headers.get("content-type") || "application/json"
    : options.contentType;
  let body = options.body;
  if (body === undefined && options.method !== "DELETE") {
    const bytes = await request.arrayBuffer();
    body = bytes.byteLength ? bytes : null;
  }

  const headers = new Headers({
    accept: "application/json",
    authorization,
    "x-tenant-id": tenantId,
    "x-correlation-id": requestCorrelationId,
  });
  if (contentType) headers.set("content-type", contentType);

  const startedAt = Date.now();
  writeLog("info", {
    event: "bff.mutation.start",
    correlationId: requestCorrelationId,
    method: options.method,
    target: target.toString(),
  });

  try {
    const response = await fetch(target, {
      method: options.method,
      headers,
      body: options.method === "DELETE" ? undefined : body,
      cache: "no-store",
      redirect: "error",
    });
    const responseCorrelationId = response.headers.get("x-correlation-id") || requestCorrelationId;
    const responseHeaders = new Headers({
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
      "x-correlation-id": responseCorrelationId,
    });
    writeLog("info", {
      event: "bff.mutation.complete",
      correlationId: responseCorrelationId,
      method: options.method,
      target: target.toString(),
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    const responseBody = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
    return new Response(responseBody, { status: response.status, headers: responseHeaders });
  } catch (error) {
    writeLog("error", {
      event: "bff.mutation.transport_error",
      correlationId: requestCorrelationId,
      method: options.method,
      target: target.toString(),
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : "Backend transport selhal",
    });
    return Response.json(
      { error: "Spojení s backendem se nezdařilo", correlationId: requestCorrelationId, retryable: true },
      { status: 502, headers: { "x-correlation-id": requestCorrelationId, "cache-control": "no-store" } },
    );
  }
}
