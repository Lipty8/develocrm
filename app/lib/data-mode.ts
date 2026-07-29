export type DeveloCrmDataMode = "api" | "browser";
let clientBrowserAdapterEnabled=false;

export function serverDataMode(): DeveloCrmDataMode {
  return process.env.DEVELOCRM_DATA_MODE === "browser" ? "browser" : "api";
}

export function browserFallbackResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("x-develocrm-data-mode", "browser");
  return Response.json(payload, {...init,headers});
}

export function responseAllowsBrowserFallback(response: Response): boolean {
  return response.headers.get("x-develocrm-data-mode") === "browser" || clientBrowserAdapterEnabled;
}

export function rememberClientDataMode(source:"production-api"|"prototype-fallback"):void {
  clientBrowserAdapterEnabled=source==="prototype-fallback";
}

export function clientUsesBrowserAdapter(): boolean {
  return clientBrowserAdapterEnabled;
}

export function apiUnavailable(message: string, correlationId = crypto.randomUUID()): Response {
  return Response.json(
    {error:message,correlationId,retryable:true},
    {status:503,headers:{"x-correlation-id":correlationId}},
  );
}
