/** Exact numeric(14,2) values. Never round contractual amounts to whole CZK.
 * Number input is accepted only when its shortest decimal is already exact
 * at the DB scale; scientific notation and fractions below one haler fail.
 */
export function originalMoney(value:number|string){
  const input=typeof value==='number'?String(value):value;
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(input))throw new Error('original_contract_invalid_money');
  const [whole,fraction='']=input.split('.'),minor=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
  const integer=minor/BigInt(100),cents=Number(minor%BigInt(100));
  const decimal=`${integer}.${String(cents).padStart(2,'0')}`;
  const display=String(integer).replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+(cents?`,${String(cents).padStart(2,'0')}`:'');
  const wholeNumber=Number(integer);
  const words=integerWords(wholeNumber)+(cents?` ${wholeNumber===1?'celá':wholeNumber>=2&&wholeNumber<=4?'celé':'celých'} ${integerWords(cents)} ${cents===1?'setina':cents>=2&&cents<=4?'setiny':'setin'}`:'');
  return{minor,decimal,display,words};
}

/** Exact addition shared by contract preparation and its editable preview. */
export function sumOriginalMoney(values:readonly (number|string)[]){
  const minor=values.reduce<bigint>((sum,value)=>sum+originalMoney(value).minor,BigInt(0));
  return originalMoney(`${minor/BigInt(100)}.${String(minor%BigInt(100)).padStart(2,'0')}`).decimal;
}

const small=['nula','jedna','dvě','tři','čtyři','pět','šest','sedm','osm','devět','deset','jedenáct','dvanáct','třináct','čtrnáct','patnáct','šestnáct','sedmnáct','osmnáct','devatenáct'];
function chunk(value:number,gender:'generic'|'masculine'|'feminine'='generic'){
  const parts:string[]=[];
  const hundreds=['','sto','dvě stě','tři sta','čtyři sta','pět set','šest set','sedm set','osm set','devět set'];
  const tens=['','','dvacet','třicet','čtyřicet','padesát','šedesát','sedmdesát','osmdesát','devadesát'];
  if(value>=100){parts.push(hundreds[Math.floor(value/100)]);value%=100;}
  if(value>=20){parts.push(tens[Math.floor(value/10)]);value%=10;}
  if(value)parts.push(value===1&&gender==='masculine'?'jeden':value===2&&gender==='masculine'?'dva':small[value]);
  return parts.join(' ');
}
function integerWords(value:number){
  if(value===0)return'nula';
  const parts:string[]=[];
  for(const [scale,one,few,many,gender] of [
    [1_000_000_000,'miliarda','miliardy','miliard','feminine'],
    [1_000_000,'milion','miliony','milionů','masculine'],
    [1_000,'tisíc','tisíce','tisíc','masculine'],
  ] as const){
    const count=Math.floor(value/scale);value%=scale;if(!count)continue;
    parts.push(chunk(count,count<=4?gender:'generic'),count===1?one:count>=2&&count<=4?few:many);
  }
  if(value)parts.push(chunk(value));return parts.join(' ');
}
