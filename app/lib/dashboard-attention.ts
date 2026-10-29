import type {ContractRecord,TaskRecord} from '../crm-data';
import type {PaymentRecord} from '../repositories/payment-repository';
import {normalizeContractStatus} from '../../backend/src/shared/contract-workflow';

/** Working documents in closed sales remain history, not a task to finish. */
export function contractNeedsAttention(row:ContractRecord){
  if(row.salesCaseStatus&&row.salesCaseStatus!=='active')return false;
  return ['draft','sent','negotiation','approved','signing'].includes(normalizeContractStatus(row.statusCode??row.state));
}

export function paymentNeedsAttention(row:PaymentRecord){
  return (row.refundable??0)>0||(row.status!=='cancelled'&&row.amount>row.paid&&(row.status==='overdue'||row.type==='reservation_fee'));
}
export function taskNeedsAttention(task:TaskRecord,now:Date){
  return !task.done&&(task.priority==='Vysoká'||Boolean(task.dueAt&&new Date(task.dueAt).getTime()<=now.getTime()+7*86400000));
}
