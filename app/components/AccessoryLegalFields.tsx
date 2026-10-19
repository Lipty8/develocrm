"use client";
import type {AccessoryLegalDetails,AccessoryLegalForm} from '../../backend/src/shared/accessory-legal-details';

export function accessoryLegalLabel(value?:AccessoryLegalDetails){
  const label=value?.legalForm==='cellar_unit'?'Sklep jako samostatná jednotka':value?.legalForm==='garage_coownership'?'Spoluvlastnický podíl na garáži':value?.legalForm==='outdoor_parking_use_right'?'Právo užívat venkovní stání':'Smluvní vymezení není doplněno';
  return value?.shareNumerator&&value.shareDenominator?`${label} · ${value.shareNumerator}/${value.shareDenominator}`:label;
}
export function AccessoryLegalFields({category,value,onChange}:{category:string;value:AccessoryLegalDetails;onChange:(value:AccessoryLegalDetails)=>void}){
  if(!['cellar','parking','garage'].includes(category))return null;
  return <fieldset><legend>Smluvní vymezení</legend><label><span>Právní forma příslušenství</span><select value={value.legalForm??''} onChange={event=>onChange({legalForm:(event.target.value||null) as AccessoryLegalForm|null,shareNumerator:null,shareDenominator:null})}>
    <option value="">Není doplněno</option>
    {category==='cellar'&&<option value="cellar_unit">Sklep jako samostatná jednotka</option>}
    {category==='parking'&&<option value="outdoor_parking_use_right">Právo užívat venkovní stání</option>}
    {['parking','garage'].includes(category)&&<option value="garage_coownership">Spoluvlastnický podíl na garáži</option>}
  </select></label>
  {value.legalForm==='garage_coownership'&&<div className="form-row"><label><span>Podíl – čitatel</span><input type="number" min="1" max="1000000000" step="1" value={value.shareNumerator??''} onChange={event=>onChange({...value,shareNumerator:event.target.value===''?null:Number(event.target.value)})}/></label><label><span>Podíl – jmenovatel</span><input type="number" min="1" max="1000000000" step="1" value={value.shareDenominator??''} onChange={event=>onChange({...value,shareDenominator:event.target.value===''?null:Number(event.target.value)})}/></label></div>}
  <p className="form-help">Vyplňte podle schválených podkladů. Neznámý podíl ponechte prázdný; pro smlouvu s pevným podílem bude nutné jej doplnit.</p></fieldset>;
}
