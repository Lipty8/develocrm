import { forwardCatalogMutation } from "../../mutation";
export async function DELETE(request: Request, context: {params: Promise<{assignmentId:string}>}) { return forwardCatalogMutation(request, context, "DELETE", "assignment"); }
