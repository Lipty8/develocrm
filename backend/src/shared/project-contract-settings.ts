export type ProjectContractSettings={name:string;registrationNumber:string;address:string;registryEntry:string;representative:string;email:string;dataBox:string;bankAccount:string;bankName:string;reservationPeriodDays:number};
export const sellerSettingFields=[
  {key:'name',label:'Název prodávající společnosti'},{key:'registrationNumber',label:'IČO / identifikace společnosti'},
  {key:'address',label:'Sídlo společnosti'},{key:'registryEntry',label:'Zápis v rejstříku'},{key:'representative',label:'Zástupce společnosti'},
  {key:'email',label:'Kontaktní e-mail'},{key:'dataBox',label:'Datová schránka'},{key:'bankAccount',label:'Bankovní účet'},{key:'bankName',label:'Název banky'},
] as const;
export function validateProjectContractSettings(value:ProjectContractSettings):void{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Doplňte smluvní údaje prodávajícího.');
  for(const field of sellerSettingFields)if(typeof value[field.key]!=='string'||!value[field.key].trim()||value[field.key].length>500)throw new Error(`Prodávající: doplňte ${field.label.toLocaleLowerCase('cs-CZ')}.`);
  if(!Number.isInteger(value.reservationPeriodDays)||value.reservationPeriodDays<1||value.reservationPeriodDays>180)throw new Error('Rezervační doba musí být 1 až 180 dní.');
}
