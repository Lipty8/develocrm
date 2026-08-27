import { env } from "cloudflare:workers";

function dispositionFileName(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  const object = await env.FILES.get(key.join("/"));
  if (!object) return new Response("Soubor nenalezen", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  const fileName = object.customMetadata?.fileName || key.at(-1) || "pudorys";
  const download = new URL(request.url).searchParams.get("download") === "1";
  headers.set("content-disposition", `${download ? "attachment" : "inline"}; filename*=UTF-8''${dispositionFileName(fileName)}`);
  return new Response(object.body, { headers });
}
