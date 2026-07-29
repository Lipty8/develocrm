import { responseAllowsBrowserFallback } from "../lib/data-mode";

export type PaymentStatus="pending"|"partially_paid"|"paid"|"overdue"|"overpaid"|"cancelled";
export type PaymentTransactionRecord={id:string;amount:number;paidAt:string;variableSymbol?:string;counterpartyAccount?:string;bankTransactionId?:string;note?:string;reversedAt?:string|null;reversalReason?:string|null};
export type PaymentEventRecord={id:string;type:string;at:string;payload?:Record<string,unknown>};
export type PaymentRecord={id:string;projectId:string;project:string;unitId:string;unit:string;partyId?:string;client:string;salesCaseId:string;contractId?:string;contractReference?:string;type:string;label:string;amount:number;currency:"CZK";dueAt:string;variableSymbol?:string;paid:number;status:PaymentStatus;transactions:PaymentTransactionRecord[];events:PaymentEventRecord[]};
export type PaymentFilters={projectId?:string;project?:string;unitId?:string;unit?:string;partyId?:string;contractId?:string;salesCaseId?:string;status?:PaymentStatus;query?:string;sort?:string;direction?:"asc"|"desc"};
export type ImportPreviewRow={row:number;bankTransactionId:string;paidAt:string;amount:number;variableSymbol:string;counterpartyAccount:string;duplicate:boolean;proposedObligationId?:string;proposedLabel?:string;confidence:number};
const STORAGE_KEY="develocrm-preview-payments-v2";

const initialPayments:PaymentRecord[]=[];
function deriveStatus(amount:number,paid:number,dueAt:string,cancelled=false):PaymentStatus{
  if(cancelled)return"cancelled";if(paid>amount)return"overpaid";if(paid===amount)return"paid";if(new Date(dueAt)<new Date())return"overdue";if(paid>0)return"partially_paid";return"pending";
}
function readPreview(){if(typeof window==="undefined")return structuredClone(initialPayments);try{return JSON.parse(localStorage.getItem(STORAGE_KEY)??"null")??structuredClone(initialPayments);}catch{return structuredClone(initialPayments);}}
function writePreview(rows:PaymentRecord[]){localStorage.setItem(STORAGE_KEY,JSON.stringify(rows));}
function filterRows(rows:PaymentRecord[],filters:PaymentFilters){
  const query=filters.query?.toLocaleLowerCase("cs-CZ");
  let result=rows.filter(row=>(!filters.project||row.project===filters.project)&&(!filters.projectId||row.projectId===filters.projectId)&&(!filters.unit||row.unit===filters.unit)&&(!filters.unitId||row.unitId===filters.unitId)&&(!filters.partyId||row.partyId===filters.partyId)&&(!filters.contractId||row.contractId===filters.contractId)&&(!filters.salesCaseId||row.salesCaseId===filters.salesCaseId)&&(!filters.status||row.status===filters.status)&&(!query||`${row.unit} ${row.client} ${row.project} ${row.label}`.toLocaleLowerCase("cs-CZ").includes(query)));
  const key=filters.sort??"dueAt";const direction=filters.direction==="desc"?-1:1;
  result=[...result].sort((a,b)=>String((a as unknown as Record<string,unknown>)[key]??"").localeCompare(String((b as unknown as Record<string,unknown>)[key]??""),"cs",{numeric:true})*direction);
  return result;
}
export interface PaymentRepository{
  list(filters?:PaymentFilters,signal?:AbortSignal):Promise<{payments:PaymentRecord[];source:"postgresql"|"preview-adapter"}>;
  record(obligationId:string,input:{amount:number;paidAt:string;variableSymbol?:string;counterpartyAccount?:string;bankTransactionId?:string;note?:string}):Promise<void>;
  reverse(transactionId:string,reason:string):Promise<void>;
  previewCsv(text:string):Promise<ImportPreviewRow[]>;
  confirmImport(rows:ImportPreviewRow[]):Promise<number>;
}
class ApiPaymentRepository implements PaymentRepository{
  async list(filters:PaymentFilters={},signal?:AbortSignal){
    const query=new URLSearchParams(Object.entries(filters).filter((entry):entry is [string,string]=>Boolean(entry[1])));
    const response=await fetch(`/api/payments?${query}`,{signal,cache:"no-store"});
    if(response.ok)return await response.json() as {payments:PaymentRecord[];source:"postgresql"};
    if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error("Platby nelze načíst");
    return{payments:filterRows(readPreview(),filters),source:"preview-adapter" as const};
  }
  async record(obligationId:string,input:{amount:number;paidAt:string;variableSymbol?:string;counterpartyAccount?:string;bankTransactionId?:string;note?:string}){
    const response=await fetch(`/api/payments/${obligationId}/transactions`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    if(response.ok)return;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({error:"Úhradu nelze uložit"}))).error);
    const rows=readPreview();const row=rows.find(item=>item.id===obligationId);if(!row)throw new Error("Předpis nebyl nalezen");
    if(input.bankTransactionId&&rows.some(item=>item.transactions.some(tx=>tx.bankTransactionId===input.bankTransactionId)))throw new Error("Tato bankovní transakce již byla importována");
    const tx={id:crypto.randomUUID(),...input};row.transactions.unshift(tx);row.events.unshift({id:crypto.randomUUID(),type:"payment.recorded",at:new Date().toISOString(),payload:{amount:input.amount}});row.paid=row.transactions.filter(item=>!item.reversedAt).reduce((sum,item)=>sum+item.amount,0);row.status=deriveStatus(row.amount,row.paid,row.dueAt);writePreview(rows);
  }
  async reverse(transactionId:string,reason:string){
    const response=await fetch(`/api/payment-transactions/${transactionId}/reversal`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason})});
    if(response.ok)return;if(!(response.status===503&&responseAllowsBrowserFallback(response)))throw new Error((await response.json().catch(()=>({error:"Reverzaci nelze provést"}))).error);
    const rows=readPreview();const row=rows.find(item=>item.transactions.some(tx=>tx.id===transactionId));const tx=row?.transactions.find(item=>item.id===transactionId);if(!row||!tx)throw new Error("Úhrada nebyla nalezena");if(tx.reversedAt)return;
    tx.reversedAt=new Date().toISOString();tx.reversalReason=reason;row.events.unshift({id:crypto.randomUUID(),type:"payment.reversed",at:tx.reversedAt,payload:{reason}});row.paid=row.transactions.filter(item=>!item.reversedAt).reduce((sum,item)=>sum+item.amount,0);row.status=deriveStatus(row.amount,row.paid,row.dueAt);writePreview(rows);
  }
  async previewCsv(text:string){
    const lines=text.replace(/^\ufeff/,"").split(/\r?\n/).filter(Boolean);if(lines.length<2)throw new Error("CSV neobsahuje žádné transakce");
    const separator=lines[0].includes(";")?";":",";const headers=lines[0].split(separator).map(value=>value.trim().toLowerCase());
    const col=(names:string[])=>headers.findIndex(header=>names.includes(header));const indexes={date:col(["datum","date","paid_at"]),amount:col(["částka","castka","amount"]),vs:col(["variabilní symbol","variabilni symbol","vs","variable_symbol"]),account:col(["účet","ucet","account"]),id:col(["id","transaction_id","bank_transaction_id"])};
    if(indexes.date<0||indexes.amount<0||indexes.id<0)throw new Error("CSV musí obsahovat datum, částku a ID transakce");
    const payments=readPreview();return lines.slice(1).map((line,index)=>{const cells=line.split(separator).map(value=>value.trim().replace(/^"|"$/g,""));const amount=Number(cells[indexes.amount].replace(/\s/g,"").replace(",","."));
      const variableSymbol=indexes.vs>=0?cells[indexes.vs]:"";const account=indexes.account>=0?cells[indexes.account]:"";const bankTransactionId=cells[indexes.id];const candidate=payments.find(row=>row.variableSymbol===variableSymbol)??payments.find(row=>Math.abs(row.amount-row.paid-amount)<0.01);const duplicate=payments.some(row=>row.transactions.some(tx=>tx.bankTransactionId===bankTransactionId));
      return{row:index+2,bankTransactionId,paidAt:new Date(cells[indexes.date]).toISOString(),amount,variableSymbol,counterpartyAccount:account,duplicate,proposedObligationId:candidate?.id,proposedLabel:candidate?`${candidate.unit} · ${candidate.label}`:undefined,confidence:candidate?(candidate.variableSymbol===variableSymbol?95:65):0};});
  }
  async confirmImport(rows:ImportPreviewRow[]){let count=0;for(const row of rows.filter(item=>!item.duplicate&&item.proposedObligationId)){await this.record(row.proposedObligationId!,{amount:row.amount,paidAt:row.paidAt,variableSymbol:row.variableSymbol,counterpartyAccount:row.counterpartyAccount,bankTransactionId:row.bankTransactionId,note:"Import bankovního výpisu po potvrzení"});count++;}return count;}
}
export const paymentRepository:PaymentRepository=new ApiPaymentRepository();
export const paymentStatusLabel:Record<PaymentStatus,string>={pending:"Čeká na úhradu",partially_paid:"Částečně uhrazeno",paid:"Uhrazeno",overdue:"Po splatnosti",overpaid:"Přeplatek",cancelled:"Stornováno"};
