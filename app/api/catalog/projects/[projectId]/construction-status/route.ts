import { forwardCatalogMutation } from "../../../mutation";
export async function POST(request:Request,context:{params:Promise<{projectId:string}>}){return forwardCatalogMutation(request,context,"POST","project-construction");}
