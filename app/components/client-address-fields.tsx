"use client";
import type {PartyAddressValue} from '../../backend/src/shared/party-address';
import type {ClientRecord} from '../crm-data';

export function ClientAddressSummary({client}:{client:Pick<ClientRecord,'kind'|'address'|'deliveryAddress'|'canReadContractIdentity'>}){
  if(client.canReadContractIdentity===false)return null;
  const format=(value?:PartyAddressValue|null)=>value?[value.line1,value.line2,[value.postalCode,value.city].filter(Boolean).join(' '),value.countryCode].filter(Boolean).join(', '):'—';
  return <><div><dt>{client.kind==='FO'?'Adresa bydliště':'Sídlo společnosti'}</dt><dd>{format(client.address)}</dd></div>
    <div><dt>Doručovací adresa</dt><dd>{format(client.deliveryAddress)}</dd></div></>;
}

export function ClientAddressFields({title,value,onChange}:{title:string;value:PartyAddressValue;onChange:(value:PartyAddressValue)=>void}){
  const update=(key:keyof PartyAddressValue,text:string)=>onChange({...value,[key]:text});
  return <fieldset className="contract-payment-terms"><legend>{title}</legend>
    <label><span>Ulice a číslo</span><input value={value.line1} maxLength={500} onChange={event=>update('line1',event.target.value)}/></label>
    <label><span>Doplnění adresy</span><input value={value.line2??''} maxLength={500} onChange={event=>update('line2',event.target.value)} placeholder="Budova, patro…"/></label>
    <div className="form-row"><label><span>Město</span><input value={value.city} maxLength={160} onChange={event=>update('city',event.target.value)}/></label>
      <label><span>PSČ</span><input value={value.postalCode??''} maxLength={20} onChange={event=>update('postalCode',event.target.value)}/></label>
      <label><span>Země</span><input value={value.countryCode} maxLength={2} onChange={event=>update('countryCode',event.target.value.toUpperCase())}/></label></div>
  </fieldset>;
}
