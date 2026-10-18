/** Existing party_addresses value shape; identity and permissions stay in the
 * party domain. Shared validation never accepts a party/tenant from form data.
 */
export type PartyAddressValue={addressType:string;line1:string;line2?:string|null;city:string;postalCode?:string|null;countryCode:string};
export class PartyAddressValidationError extends Error{
  constructor(message:string){super(message);this.name='PartyAddressValidationError';}
}
export function normalizePartyAddress(value:PartyAddressValue):PartyAddressValue{
  if(!value||!['residence','registered_office','correspondence','billing','other'].includes(value.addressType))throw new PartyAddressValidationError('Vyberte platný typ adresy.');
  const text=(input:unknown,label:string,maximum:number,required=false)=>{
    if(typeof input!=='string'&&input!==undefined&&input!==null)throw new PartyAddressValidationError(`Zkontrolujte údaj ${label}.`);
    const result=typeof input==='string'?input.trim():'';
    if(required&&!result)throw new PartyAddressValidationError(`Doplňte ${label}.`);
    if(result.length>maximum||Array.from(result).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127))throw new PartyAddressValidationError(`Zkontrolujte údaj ${label}.`);
    return result;
  };
  const countryCode=text(value.countryCode,'země',2,true).toUpperCase();
  if(!/^[A-Z]{2}$/.test(countryCode))throw new PartyAddressValidationError('Zadejte dvoupísmenný kód země, například CZ.');
  return{addressType:value.addressType,line1:text(value.line1,'ulici a číslo',500,true),line2:text(value.line2,'doplnění adresy',500),
    city:text(value.city,'město',160,true),postalCode:text(value.postalCode,'PSČ',20),countryCode};
}
