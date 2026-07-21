import { getChatGPTUser } from "../../../chatgpt-auth";
import { prototypeSession, type IdentitySession } from "../../../repositories/identity-repository";

export async function GET(request: Request) {
  const backendUrl = process.env.DEVELOCRM_API_URL?.replace(/\/$/, "");
  const tenantId = process.env.DEVELOCRM_TENANT_ID;
  const authorization = request.headers.get("authorization");

  if (backendUrl && tenantId && authorization) {
    const response = await fetch(`${backendUrl}/v1/session`, {
      headers: { authorization, "x-tenant-id": tenantId },
      cache: "no-store",
    });
    if (response.ok) {
      const session = (await response.json()) as Omit<IdentitySession, "source">;
      return Response.json({ ...session, source: "production-api" satisfies IdentitySession["source"] });
    }
    return Response.json({ error: "Produkční identitu se nepodařilo ověřit" }, { status: response.status });
  }

  // Preview zůstává vizuálně i funkčně beze změny. Po zapojení Entra proxy
  // tato větev zmizí a stejný repository kontrakt začne vracet produkční session.
  const previewUser = await getChatGPTUser();
  return Response.json({
    ...prototypeSession,
    user: previewUser
      ? { id: prototypeSession.user.id, email: previewUser.email, displayName: previewUser.displayName }
      : prototypeSession.user,
  } satisfies IdentitySession);
}
