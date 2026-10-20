/** Contractual rights are separate from physical inventory category and price. */
export type AccessoryLegalForm='cellar_unit'|'outdoor_parking_use_right'|'garage_coownership';
export type AccessoryLegalDetails={legalForm:AccessoryLegalForm|null;shareNumerator:number|null;shareDenominator:number|null};
export type AccessoryUpdateInput={accessoryId:string;code:string;areaM2?:number|null;floorLabel?:string|null;amount:number;amountNet?:number|null;reason?:string;legalDetails?:AccessoryLegalDetails};
export function normalizeAccessoryLocation(value:unknown):string|null{
  if(value===null)return null;
  if(typeof value!=='string'||value.length>120||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Umístění musí být text do 120 znaků bez řídicích znaků.');
  return value.trim()||null;
}
export class AccessoryLegalDetailsError extends Error{
  constructor(){super('Zkontrolujte smluvní vymezení příslušenství a spoluvlastnický podíl.');this.name='AccessoryLegalDetailsError';}
}
export function normalizeAccessoryLegalDetails(value:unknown):AccessoryLegalDetails{
  const invalid=():never=>{throw new AccessoryLegalDetailsError();};
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const item=value as Record<string,unknown>;
  if(Object.keys(item).some(key=>!['legalForm','shareNumerator','shareDenominator'].includes(key)))return invalid();
  if(item.legalForm!==null&&!['cellar_unit','outdoor_parking_use_right','garage_coownership'].includes(String(item.legalForm)))return invalid();
  const n=item.shareNumerator??null,d=item.shareDenominator??null;
  if((n===null)!==(d===null))return invalid();
  if(n!==null&&(typeof n!=='number'||typeof d!=='number'||!Number.isInteger(n)||!Number.isInteger(d)||n<1||d<n||d>1_000_000_000))return invalid();
  if(item.legalForm!=='garage_coownership'&&(n!==null||d!==null))return invalid();
  return{legalForm:item.legalForm as AccessoryLegalForm|null,shareNumerator:n as number|null,shareDenominator:d as number|null};
}
export function originalAccessoryKind(item:{type:string;legalForm?:AccessoryLegalForm|null}):'cellar'|'garage'|'outdoor_parking'|null{
  if(item.type==='cellar'&&item.legalForm==='cellar_unit')return 'cellar';
  if(['parking','garage'].includes(item.type)&&item.legalForm==='garage_coownership')return 'garage';
  if(item.type==='parking'&&item.legalForm==='outdoor_parking_use_right')return 'outdoor_parking';
  return null;
}
