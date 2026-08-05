import { clients } from "../../../crm-data";
import { serverDataMode } from "../../../lib/data-mode";
import { forwardBackendMutation } from "../../../lib/backend-proxy";

export async function POST(request:Request) {
  const body=await request.json() as {partyIds?:string[];format?:"bcc"|"csv"};
  if(serverDataMode()==="api")return forwardBackendMutation(request,{method:"POST",target:"/v1/clients/export",body:JSON.stringify(body),unavailableMessage:"Export klientů vyžaduje připojený backend"});
  const selected=clients.filter((client)=>body.partyIds?.includes(client.id));
  if(body.format==="bcc")return Response.json({value:selected.map((client)=>client.email).filter(Boolean).join("; "),count:selected.length});
  const rows=[["Jméno / název","E-mail","Telefon","Projekt","Jednotka","Stav klienta"],...selected.map((client)=>[client.name,client.email,client.phone,client.projects,client.units.join(", "),client.state])];
  return Response.json({value:"\ufeff"+rows.map((row)=>row.map((value)=>`"${value.replaceAll('"','""')}"`).join(";")).join("\n"),count:selected.length});
}
