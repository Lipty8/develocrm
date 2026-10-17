import {addCzechWorkingDays,czechSignatureDay} from './czech-working-days.js';

/** Proposal for the pinned, complete Dejvice original variant only.
 * No persistence: the existing financial domain must apply it atomically under
 * the unit/case lock once its signature/delivery evidence is available.
 * Inputs must come from authorized DB records, never arbitrary render values.
 */
type SignatureAnchor={effectiveSignatureAt?:string|null};
export type OriginalPaymentPlanInput=SignatureAnchor&(
  {type:'rs';reservationFeeAmount:string}|
  {type:'sbk';totalPrice:string;reservationFeeAmount:string;paidReservationFeeAmount:string;finalNoticeDeliveredOn?:string|null}
);
export type OriginalPaymentPlanRow={
  key:'rs_fee'|'sbk_first'|'sbk_final';amount:string;dueOn:string|null;
  anchor:'effective_signature'|'notice_delivery';days:number;calendar:'czech_working_days'|'calendar_days';
  state:'awaiting_signature'|'awaiting_delivery'|'scheduled';
};
export class OriginalPaymentPlanError extends Error{
  constructor(readonly code:string){super('Platební podmínky smlouvy nejsou úplné nebo konzistentní.');this.name='OriginalPaymentPlanError';}
}

const ZERO=BigInt(0),TWENTY=BigInt(20),FIFTY=BigInt(50),HUNDRED=BigInt(100);
const maximum=BigInt('999999999999999'); // numeric(15,2), in haléře.
function money(value:string):bigint{
  if(!/^\d{1,13}(?:\.\d{1,2})?$/.test(value))throw new OriginalPaymentPlanError('invalid_money');
  const [whole,fraction='']=value.split('.');const minor=BigInt(whole)*HUNDRED+BigInt(fraction.padEnd(2,'0'));
  if(minor>maximum)throw new OriginalPaymentPlanError('invalid_money');return minor;
}
function decimal(value:bigint){return`${value/HUNDRED}.${String(value%HUNDRED).padStart(2,'0')}`;}
function signatureRow(key:'rs_fee'|'sbk_first',amount:bigint,days:number,signedAt?:string|null):OriginalPaymentPlanRow{
  return{key,amount:decimal(amount),anchor:'effective_signature',days,calendar:'czech_working_days',
    dueOn:signedAt?addCzechWorkingDays(czechSignatureDay(signedAt),days):null,state:signedAt?'scheduled':'awaiting_signature'};
}
function addCalendarDays(day:string,days:number):string{
  // Reuse strict date/range validation without adding a business day.
  addCzechWorkingDays(day,0);const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);
  const result=date.toISOString().slice(0,10);addCzechWorkingDays(result,0);return result;
}

export function originalPaymentPlan(input:OriginalPaymentPlanInput):OriginalPaymentPlanRow[]{
  const fee=money(input.reservationFeeAmount);
  if(fee<=ZERO)throw new OriginalPaymentPlanError('reservation_fee_required');
  if(input.type==='rs')return[signatureRow('rs_fee',fee,3,input.effectiveSignatureAt)];
  const total=money(input.totalPrice),paid=money(input.paidReservationFeeAmount);
  if(total<=ZERO)throw new OriginalPaymentPlanError('price_required');
  // The original states the RS fee has already been paid, not just prescribed.
  if(paid<fee)throw new OriginalPaymentPlanError('reservation_fee_not_paid');
  if(paid!==fee)throw new OriginalPaymentPlanError('reservation_fee_payment_mismatch');
  // Same positive half-up rounding as PostgreSQL round(numeric,2).
  const first=(total*TWENTY+FIFTY)/HUNDRED,final=total-first-paid;
  if(first<=ZERO||final<ZERO)throw new OriginalPaymentPlanError('inconsistent_installments');
  if(input.finalNoticeDeliveredOn&&!input.effectiveSignatureAt)throw new OriginalPaymentPlanError('delivery_before_effective_contract');
  if(input.finalNoticeDeliveredOn&&input.effectiveSignatureAt&&input.finalNoticeDeliveredOn<czechSignatureDay(input.effectiveSignatureAt))throw new OriginalPaymentPlanError('delivery_before_effective_contract');
  return[
    signatureRow('sbk_first',first,5,input.effectiveSignatureAt),
    {key:'sbk_final',amount:decimal(final),anchor:'notice_delivery',days:30,calendar:'calendar_days',
      dueOn:input.finalNoticeDeliveredOn?addCalendarDays(input.finalNoticeDeliveredOn,30):null,
      state:input.finalNoticeDeliveredOn?'scheduled':'awaiting_delivery'},
  ];
}
