import {ORIGINAL_DOB_FULL_VARIANT,SBK_DOB_DELIVERY_VARIANT} from '../documents/template-catalog.js';

// These positions come from the supplied originals, not file-name matching.
const ORIGINAL_APPENDICES = {
  rs: ['Katalogový list Bytu','Situace sklepy','Situace parking','Koordinační situace','Standardní vybavení Bytu','Plná moc'],
  sbk: ['Situace projektu, parkingu, sklepů','Katalogový list Bytu','Standardní vybavení Bytu','Pravidla Klientských změn','Znění Kupní smlouvy'],
} as const;

export type ContractAppendixSelection = {
  number:number; documentId:string|null; documentVersionId:string|null;
  name:string|null; version:string|null; available:boolean;
};
export type ContractAppendixSummary = {
  contractVersionId:string|null; editable:boolean;
  items:Array<ContractAppendixSelection & {label:string}>;
};

export function contractAppendixRequirements(type:'rs'|'sbk',variant:unknown):ReadonlyArray<{number:number;label:string}>{
  return (variant===ORIGINAL_DOB_FULL_VARIANT||type==='sbk'&&variant===SBK_DOB_DELIVERY_VARIANT)
    ?ORIGINAL_APPENDICES[type].map((label,index)=>({number:index+1,label})):[];
}

export type ContractAppendixInput={versionId:string;number:number;documentId:string|null;documentVersionId:string|null;expectedDocumentVersionId:string|null};
export class ContractAppendixValidationError extends Error{
  constructor(){super('Vyberte platnou přílohu a její konkrétní verzi.');this.name='ContractAppendixValidationError';}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function contractAppendixInput(value:unknown):ContractAppendixInput{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ContractAppendixValidationError();
  const row=value as Record<string,unknown>;
  const keys=['versionId','number','documentId','documentVersionId','expectedDocumentVersionId'];
  if(Object.keys(row).some(key=>!keys.includes(key))||Object.keys(row).length!==keys.length
    ||typeof row.versionId!=='string'||!uuid.test(row.versionId)
    ||typeof row.number!=='number'||!Number.isInteger(row.number)||row.number<1||row.number>99
    ||!['documentId','documentVersionId','expectedDocumentVersionId'].every(key=>row[key]===null||typeof row[key]==='string'&&uuid.test(row[key] as string))
    ||(row.documentId===null)!==(row.documentVersionId===null))throw new ContractAppendixValidationError();
  return {versionId:row.versionId,number:row.number,documentId:row.documentId as string|null,
    documentVersionId:row.documentVersionId as string|null,expectedDocumentVersionId:row.expectedDocumentVersionId as string|null};
}
