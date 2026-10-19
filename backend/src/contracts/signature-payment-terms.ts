import {originalPaymentPlan,type OriginalPaymentPlanRow} from './original-payment-plan.js';

/** Existing contract-version JSON, not another financial ledger or calculator. */
export type SignaturePaymentTerms={
  version:1;profile:'dejvice-original-dob-full-v1';calendarPolicy:'cz-2026-v1';signatureAnchor:'last_required_signature';
  contractType:'rs'|'sbk';totalPrice:string;reservationFee:string;paidReservationFee:string;
  precedingRsContractId:string|null;buyerPartyId:string;variableSymbol:string;
  rows:Array<Omit<OriginalPaymentPlanRow,'state'|'dueOn'>>;
};
const money=/^\d{1,13}(?:\.\d{1,2})?$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function decimal(value:string){const[whole,fraction='']=value.split('.');return`${whole.replace(/^0+(?=\d)/,'')}.${fraction.padEnd(2,'0')}`;}

/** Fail closed on malformed/stale persistence; calculations remain centralized. */
export function signaturePaymentTerms(value:unknown):SignaturePaymentTerms|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const p=value as Record<string,unknown>;
  if(p.version!==1||p.profile!=='dejvice-original-dob-full-v1'||p.calendarPolicy!=='cz-2026-v1'
    ||p.signatureAnchor!=='last_required_signature'||!['rs','sbk'].includes(String(p.contractType))
    ||typeof p.buyerPartyId!=='string'||!uuid.test(p.buyerPartyId)||typeof p.variableSymbol!=='string'||!/^\d+$/.test(p.variableSymbol))return null;
  for(const key of ['totalPrice','reservationFee','paidReservationFee'])if(typeof p[key]!=='string'||!money.test(p[key] as string))return null;
  if(p.contractType==='sbk'&&(typeof p.precedingRsContractId!=='string'||!uuid.test(p.precedingRsContractId)))return null;
  if(p.contractType==='rs'&&(p.precedingRsContractId!==null||decimal(p.paidReservationFee as string)!=='0.00'))return null;
  try{
    const expected=originalPaymentPlan(p.contractType==='rs'?{type:'rs',reservationFeeAmount:p.reservationFee as string}:
      {type:'sbk',totalPrice:p.totalPrice as string,reservationFeeAmount:p.reservationFee as string,paidReservationFeeAmount:p.paidReservationFee as string});
    if(!Array.isArray(p.rows)||p.rows.length!==expected.length)return null;
    for(let i=0;i<expected.length;i++){
      const row=p.rows[i] as Record<string,unknown>|null,e=expected[i];
      if(!row||typeof row!=='object'||typeof row.amount!=='string'||!money.test(row.amount)
        ||row.key!==e.key||decimal(row.amount)!==e.amount||row.anchor!==e.anchor||row.days!==e.days||row.calendar!==e.calendar)return null;
    }
    return p as SignaturePaymentTerms;
  }catch{return null;}
}
