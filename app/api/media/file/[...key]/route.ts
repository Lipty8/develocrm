import { env } from "cloudflare:workers";

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  const object = await env.FILES.get(key.join("/"));
  if (!object) return new Response("Soubor nenalezen", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=300");
  return new Response(object.body, { headers });
}
