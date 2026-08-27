import { forwardCatalogMutation } from "../../../mutation";

export async function POST(
  request: Request,
  context: { params: Promise<{ unitId: string }> },
) {
  return forwardCatalogMutation(request, context, "POST", "unit-accessory");
}
