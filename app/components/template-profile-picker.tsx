"use client";

import {ORIGINAL_DOB_FULL_VARIANT} from '../../backend/src/documents/template-catalog';

export {ORIGINAL_DOB_FULL_VARIANT};

export function TemplateProfilePicker({type,value,onChange}:{type:string;value:string;onChange:(value:string)=>void}){
  const isContract=type==='reservation_contract'||type==='future_purchase_contract';
  if(!isContract)return null;
  return <label><span>Varianta šablony</span><select value={value} onChange={event=>onChange(event.target.value)}>
    {type==='reservation_contract'&&<option value="default">Dosavadní varianta</option>}
    {value!=='default'&&value!==ORIGINAL_DOB_FULL_VARIANT&&<option value={value}>Stávající projektová varianta</option>}
    <option value={ORIGINAL_DOB_FULL_VARIANT}>Dejvice · datum narození · kompletní příslušenství · ke kontrole</option>
  </select>{value===ORIGINAL_DOB_FULL_VARIANT&&<small>Tuto variantu lze zatím pouze nahrát a zkontrolovat. Nelze ji aktivovat pro smlouvy.</small>}</label>;
}

export function TemplateGenerationNotice({supported}:{supported:boolean|undefined}){
  if(supported!==false)return null;
  return <p role="status">Šablona je připravena pouze ke kontrole. Generování smluv z ní zatím není dostupné.</p>;
}
