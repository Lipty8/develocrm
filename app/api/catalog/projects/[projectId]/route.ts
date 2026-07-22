import { forwardCatalogMutation } from "../../mutation";
export async function PATCH(request: Request, context: {params: Promise<{projectId:string}>}) { return forwardCatalogMutation(request, context, "PATCH", "project"); }
