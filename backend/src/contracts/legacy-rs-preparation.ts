import {createHash} from 'node:crypto';
import {originalMoney} from './original-money.js';

export class LegacyRsPreparationError extends Error{
  constructor(readonly code:string){super('Přípravu smlouvy se nepodařilo dokončit.');this.name='LegacyRsPreparationError';}
}
export type LegacyRsPreparationInput={expectedVersionId:string;previewToken:string;agreedUnitPrice:string;reservationFee:string;idempotencyKey:string;reason:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(code:string):never=>{throw new LegacyRsPreparationError(code);};
export function legacyRsPreparationInput(body:unknown):LegacyRsPreparationInput{
  if(!body||typeof body!=='object'||Array.isArray(body))return fail('invalid_input');
  const value=body as Record<string,unknown>;
  const keys=['expectedVersionId','previewToken','agreedUnitPrice','reservationFee','idempotencyKey','reason'];
  if(Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>typeof value[key]!=='string'))return fail('invalid_input');
  if(!uuid.test(value.expectedVersionId as string)||! /^[a-f0-9]{64}$/.test(value.previewToken as string))return fail('invalid_input');
  if(!/^[A-Za-z0-9:_-]{8,160}$/.test(value.idempotencyKey as string))return fail('invalid_input');
  const reason=(value.reason as string).trim();if(reason.length<5||reason.length>1000)return fail('reason_required');
  const agreedUnitPrice=money(value.agreedUnitPrice),reservationFee=money(value.reservationFee);
  if(originalMoney(reservationFee).minor<=BigInt(0))return fail('fee_required');
  return{expectedVersionId:value.expectedVersionId as string,previewToken:value.previewToken as string,agreedUnitPrice,reservationFee,idempotencyKey:value.idempotencyKey as string,reason};
}
function money(value:unknown){
  if(typeof value!=='string')return fail('invalid_money');
  try{return originalMoney(value).decimal;}catch{return fail('invalid_money');}
}
export type LegacyRsPriceBasis={contractId:string;projectId:string;unitId:string;salesCaseId:string;versionId:string;
  currentUnitPrice:string|null;accessories:Array<{assignmentId:string;accessoryId:string;code:string;type:string;amount:string}>};

/** Server-owned preview facts only. Array order, decimal spelling and wall-clock
 * time are not business changes; assignments, IDs and amounts are. */
export function legacyRsPriceBasis(basis:LegacyRsPriceBasis){
  const accessories=basis.accessories.map(item=>({...item,amount:money(item.amount)})).sort((a,b)=>a.assignmentId.localeCompare(b.assignmentId,'en'));
  if(new Set(accessories.map(item=>item.assignmentId)).size!==accessories.length
    ||new Set(accessories.map(item=>item.accessoryId)).size!==accessories.length)return fail('ambiguous_accessories');
  const currentUnitPrice=basis.currentUnitPrice===null?null:money(basis.currentUnitPrice);
  const normalized={contractId:basis.contractId,projectId:basis.projectId,unitId:basis.unitId,salesCaseId:basis.salesCaseId,versionId:basis.versionId,currentUnitPrice,accessories};
  const previewToken=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const accessoryMinor=accessories.reduce((sum,item)=>sum+originalMoney(item.amount).minor,BigInt(0));
  return{...normalized,previewToken,accessoryPrice:decimal(accessoryMinor),currentTotalPrice:currentUnitPrice===null?null:decimal(originalMoney(currentUnitPrice).minor+accessoryMinor)};
}
function decimal(minor:bigint){const result=`${minor/BigInt(100)}.${String(minor%BigInt(100)).padStart(2,'0')}`;return money(result);}

export function legacyRsAgreedTerms(basis:LegacyRsPriceBasis,input:LegacyRsPreparationInput){
  const preview=legacyRsPriceBasis(basis);
  if(input.expectedVersionId!==basis.versionId||input.previewToken!==preview.previewToken)return fail('stale_preview');
  const agreedUnitPrice=money(input.agreedUnitPrice),reservationFee=money(input.reservationFee);
  const totalPrice=decimal(originalMoney(agreedUnitPrice).minor+originalMoney(preview.accessoryPrice).minor);
  if(originalMoney(totalPrice).minor<=BigInt(0)||originalMoney(reservationFee).minor<=BigInt(0)
    ||originalMoney(reservationFee).minor>originalMoney(totalPrice).minor)return fail('invalid_fee');
  // The caller explicitly supplies the agreed unit price. Never substitute
  // today's list price or derive an arbitrary reservation fee.
  return{unitPrice:agreedUnitPrice,totalPrice,reservationFee,
    accessories:preview.accessories.map(({accessoryId,code,type,amount})=>({accessoryId,code,type,amount}))};
}
