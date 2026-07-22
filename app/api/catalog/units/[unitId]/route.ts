import { forwardCatalogMutation } from "../../mutation";
export async function PATCH(request: Request, context: {params: Promise<{unitId:string}>}) { return forwardCatalogMutation(request, context, "PATCH", "unit"); }
export async function POST(request: Request, context: {params: Promise<{unitId:string}>}) { return forwardCatalogMutation(request, context, "POST", "unit-accessory"); }
