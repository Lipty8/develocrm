"use client";
import {AlertTriangle} from 'lucide-react';
import type {DuplicateMatch} from '../repositories/client-repository';

export function ClientDuplicateReview({matches,override,onOverride,onUse,onOpen}:{matches:DuplicateMatch[];override:boolean;onOverride:()=>void;onUse:(id:string)=>void;onOpen?:(id:string)=>void}){
  if(!matches.length)return null;
  return <div className="duplicate-review" aria-label="Podobní klienti">
    <div className="duplicate-warning"><AlertTriangle size={18}/><span><strong>{matches.some(match=>match.strength==='strong')?'Klient s těmito údaji už pravděpodobně existuje.':'Našli jsme podobného klienta. Ověřte prosím další údaje.'}</strong><small>Ověřte kontakty a projektové vazby před vytvořením nového záznamu.</small></span></div>
    {matches.map(match=><article key={match.id} className={match.strength==='strong'?'strong-match':'possible-match'}><div><strong>{match.name}</strong><small>{[match.email,match.phone].filter(Boolean).join(' · ')||'Kontakt není dostupný'}</small><small>{[...match.projects,...match.units].join(' · ')||'Bez aktivní projektové vazby'}</small><span>{match.reasons.join(', ')}</span></div><div>
      {onOpen?<button type="button" className="secondary-button compact" onClick={()=>onOpen(match.id)}>Otevřít klienta</button>:<a className="secondary-button compact" href={`/clients/${encodeURIComponent(match.id)}`} target="_blank" rel="noreferrer">Otevřít klienta</a>}
      <button type="button" className="primary-button compact" onClick={()=>onUse(match.id)}>Použít existujícího klienta</button>
    </div></article>)}
    {!override&&<button type="button" className="text-button duplicate-override" onClick={onOverride}>Přesto vytvořit nového</button>}
    {override&&<small>Vytvoření nového záznamu bude zaznamenáno do auditu.</small>}
  </div>;
}
