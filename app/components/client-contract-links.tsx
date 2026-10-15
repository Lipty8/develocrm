import Link from 'next/link';
import type {ContractRecord} from '../crm-data';
import {contractRoute} from '../crm-routing.mjs';
import {contractStatusLabel} from '../../backend/src/shared/contract-workflow';

export function ClientContractLinks({partyId,contracts}:{partyId:string;contracts:ContractRecord[]}){
  const rows=contracts.filter(contract=>contract.id&&contract.parties?.some(party=>party.partyId===partyId));
  return <section className="card client-relations"><h2>Smlouvy klienta</h2>{rows.map(contract=><Link key={contract.id} href={contractRoute(contract.id!)}><span className="contract-type">{contract.type}</span><span><strong>{contract.reference??contract.title}</strong><small>{contract.project} · {contract.unit}</small></span><span>{contractStatusLabel(contract.statusCode??contract.state)}</span></Link>)}{!rows.length&&<p>Žádná dostupná smlouva tohoto klienta.</p>}</section>;
}
