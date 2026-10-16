"use client";
import {sellerSettingFields,type ProjectContractSettings,validateProjectContractSettings} from '../../backend/src/shared/project-contract-settings';
export const emptyProjectContractSettings:ProjectContractSettings={name:'',registrationNumber:'',address:'',registryEntry:'',representative:'',email:'',dataBox:'',bankAccount:'',bankName:'',reservationPeriodDays:30};
export {validateProjectContractSettings};
export function ProjectContractFields({value,onChange}:{value:ProjectContractSettings;onChange:(value:ProjectContractSettings)=>void}){
  return <fieldset className="contract-payment-terms"><legend>Smluvní údaje prodávajícího</legend>
    <div className="rs-preparation-summary">{sellerSettingFields.map(field=><label key={field.key}><span>{field.label}</span><input value={value[field.key]} maxLength={500} onChange={event=>onChange({...value,[field.key]:event.target.value})}/></label>)}
    <label><span>Standardní rezervační doba (dní)</span><input type="number" min={1} max={180} value={value.reservationPeriodDays} onChange={event=>onChange({...value,reservationPeriodDays:Number(event.target.value)})}/></label></div>
  </fieldset>;
}
