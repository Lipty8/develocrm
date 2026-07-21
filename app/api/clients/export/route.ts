import { clients } from "../../../crm-data";

export async function POST(request:Request) {
  const body=await request.json() as {partyIds?:string[];format?:"bcc"|"csv"};
  const backendUrl=process.env.DEVELOCRM_API_URL?.replace(/\/$/,""); const tenantId=process.env.DEVELOCRM_TENANT_ID; const authorization=request.headers.get("authorization");
  if(backendUrl&&tenantId&&authorization)return fetch(`${backendUrl}/v1/clients/export`,{method:"POST",headers:{authorization,"x-tenant-id":tenantId,"content-type":"application/json"},body:JSON.stringify(body)});
  const selected=clients.filter((client)=>body.partyIds?.includes(client.id));
  if(body.format==="bcc")return Response.json({value:selected.map((client)=>client.email).filter(Boolean).join("; "),count:selected.length});
  const rows=[["Jméno / název","E-mail","Telefon","Projekt","Jednotka","Stav klienta"],...selected.map((client)=>[client.name,client.email,client.phone,client.projects,client.units.join(", "),client.state])];
  return Response.json({value:"\ufeff"+rows.map((row)=>row.map((value)=>`"${value.replaceAll('"','""')}"`).join(";")).join("\n"),count:selected.length});
}
