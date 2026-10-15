import {contractEndMessage,type ContractEndOutcome} from '../../backend/src/shared/contract-end-outcome';
export function ContractEndResult({outcome}:{outcome?:ContractEndOutcome|null}){
  if(!outcome)return null;
  return <section className="form-info" role="status"><div><strong>{contractEndMessage(outcome)}</strong>{outcome.reasons.map(reason=><p key={reason.code}>{reason.message}</p>)}</div></section>;
}
