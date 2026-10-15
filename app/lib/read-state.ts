export class ReadError extends Error{
  constructor(public readonly status:number,public readonly correlationId:string|null=null){super(status===403?'K těmto údajům nemáte oprávnění.':status===401?'Pro pokračování se prosím přihlaste.':'Údaje se nepodařilo načíst. Zkuste to znovu.');}
}
export function readError(response:Response){return new ReadError(response.status,response.headers.get('x-correlation-id'));}
