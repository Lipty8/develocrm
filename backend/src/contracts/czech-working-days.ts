/** Contract calendar, not the user's display timezone.
 * Holidays: Act 245/2000, sections 1-3, including Good Friday since 2016.
 * https://ppropo.mpsv.cz/zakon_245_2000 (verified 2026-10-17).
 * No runtime clock or browser locale is used for a contractual date.
 */
const FIXED_HOLIDAYS=new Set(['01-01','05-01','05-08','07-05','07-06','09-28','10-28','11-17','12-24','12-25','12-26']);
const dayKey=(date:Date)=>date.toISOString().slice(0,10);

function parseDay(value:string):Date{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('invalid_contract_calendar_date');
  const date=new Date(`${value}T12:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||dayKey(date)!==value)throw new Error('invalid_contract_calendar_date');
  // Do not silently apply today's holiday law to old records or unbounded years.
  if(date.getUTCFullYear()<2016||date.getUTCFullYear()>2099)throw new Error('unsupported_contract_calendar_year');
  return date;
}

function easterSunday(year:number):Date{
  // Gregorian computus. Date arithmetic below is on calendar days at UTC noon,
  // not elapsed 24h periods in a timezone with daylight-saving transitions.
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return new Date(Date.UTC(year,month-1,day,12));
}

export function isCzechWorkingDay(value:string):boolean{
  const date=parseDay(value),weekday=date.getUTCDay();
  if(weekday===0||weekday===6||FIXED_HOLIDAYS.has(value.slice(5)))return false;
  const easter=easterSunday(date.getUTCFullYear());
  const friday=new Date(easter);friday.setUTCDate(friday.getUTCDate()-2);
  const monday=new Date(easter);monday.setUTCDate(monday.getUTCDate()+1);
  return value!==dayKey(friday)&&value!==dayKey(monday);
}

/** Start counting the day AFTER the supplied, evidenced contractual anchor. */
export function addCzechWorkingDays(anchorDay:string,days:number):string{
  if(!Number.isInteger(days)||days<0||days>366)throw new Error('invalid_working_day_count');
  const cursor=parseDay(anchorDay);
  for(let remaining=days;remaining>0;){
    cursor.setUTCDate(cursor.getUTCDate()+1);
    if(isCzechWorkingDay(dayKey(cursor)))remaining--;
  }
  return dayKey(cursor);
}

/** Convert an explicitly zoned actual signature instant, never a planned date. */
export function czechSignatureDay(signedAt:string):string{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(signedAt))throw new Error('invalid_signature_instant');
  // Validate the written calendar day too: Date.parse normalizes e.g. February 30.
  parseDay(signedAt.slice(0,10));
  const instant=new Date(signedAt);if(!Number.isFinite(instant.getTime()))throw new Error('invalid_signature_instant');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const value=(type:string)=>parts.find(part=>part.type===type)?.value;
  const key=`${value('year')}-${value('month')}-${value('day')}`;parseDay(key);return key;
}
