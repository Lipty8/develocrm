import type {TaskRecord} from '../crm-data';
import type {PaymentRecord} from '../repositories/payment-repository';

export function paymentNeedsAttention(row:PaymentRecord){
  return (row.refundable??0)>0||(row.status!=='cancelled'&&row.amount>row.paid&&(row.status==='overdue'||row.type==='reservation_fee'));
}
export function taskNeedsAttention(task:TaskRecord,now:Date){
  return !task.done&&(task.priority==='Vysoká'||Boolean(task.dueAt&&new Date(task.dueAt).getTime()<=now.getTime()+7*86400000));
}
