import {useEffect,useState} from "react";

export type DashboardGreetingPeriod="morning"|"forenoon"|"afternoon"|"evening";

const greetingLabels:Record<DashboardGreetingPeriod,string>={
  morning:"Dobré ráno",
  forenoon:"Dobré dopoledne",
  afternoon:"Dobré odpoledne",
  evening:"Dobrý večer",
};

const knownVocatives:Record<string,string>={Adam:"Adame",Iva:"Ivo"};

function validTimeZone(value:string|undefined):value is string{
  if(!value?.trim())return false;
  try{new Intl.DateTimeFormat("cs-CZ",{timeZone:value}).format();return true;}catch{return false;}
}

export function resolveGreetingTimeZone(explicitTimeZone?:string,browserTimeZone?:()=>string|undefined):string{
  if(validTimeZone(explicitTimeZone))return explicitTimeZone;
  const detected=browserTimeZone?.()??(typeof Intl!=="undefined"?Intl.DateTimeFormat().resolvedOptions().timeZone:undefined);
  return validTimeZone(detected)?detected:"UTC";
}

export function greetingPeriodAt(value:Date,timeZone:string):DashboardGreetingPeriod{
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",hourCycle:"h23"}).format(value));
  if(hour<9)return"morning";
  if(hour<12)return"forenoon";
  if(hour<18)return"afternoon";
  return"evening";
}

export function greetingName(displayName:string|undefined):string{
  const firstName=displayName?.trim().split(/\s+/)[0]??"";
  if(!firstName||firstName.includes("@")||!/[\p{L}]/u.test(firstName))return"";
  return knownVocatives[firstName]??firstName;
}

export function dashboardGreeting(value:Date,timeZone:string,displayName?:string):string{
  const greeting=greetingLabels[greetingPeriodAt(value,timeZone)];
  const name=greetingName(displayName);
  return name?`${greeting}, ${name}`:greeting;
}

export function nextGreetingTransition(value:Date,timeZone:string):Date{
  const current=greetingPeriodAt(value,timeZone);
  const start=value.getTime();
  const step=15*60_000;
  let lower=start;
  let upper=start+step;
  const limit=start+26*60*60_000;
  while(upper<limit&&greetingPeriodAt(new Date(upper),timeZone)===current){lower=upper;upper+=step;}
  while(upper-lower>500){const middle=Math.floor((lower+upper)/2);if(greetingPeriodAt(new Date(middle),timeZone)===current)lower=middle;else upper=middle;}
  return new Date(upper);
}

type ListenerTarget={addEventListener:(type:string,listener:EventListener)=>void;removeEventListener:(type:string,listener:EventListener)=>void};
type VisibilityTarget=ListenerTarget&{visibilityState?:string};
type TimerHandle=ReturnType<typeof setTimeout>;

export function startDashboardGreetingClock({
  timeZone,
  onChange,
  now=()=>new Date(),
  setTimer=(callback,delay)=>setTimeout(callback,delay),
  clearTimer=handle=>clearTimeout(handle),
  documentTarget=typeof document!=="undefined"?document:undefined,
  windowTarget=typeof window!=="undefined"?window:undefined,
}:{
  timeZone:string;
  onChange:(value:Date)=>void;
  now?:()=>Date;
  setTimer?:(callback:()=>void,delay:number)=>TimerHandle;
  clearTimer?:(handle:TimerHandle)=>void;
  documentTarget?:VisibilityTarget;
  windowTarget?:ListenerTarget;
}):()=>void{
  let timer:TimerHandle|undefined;
  const refresh=()=>{
    const current=now();
    onChange(current);
    if(timer!==undefined)clearTimer(timer);
    const delay=Math.max(100,nextGreetingTransition(current,timeZone).getTime()-current.getTime()+25);
    timer=setTimer(refresh,delay);
  };
  const onVisibilityChange=()=>{if(documentTarget?.visibilityState!=="hidden")refresh();};
  const onResume=()=>refresh();
  refresh();
  documentTarget?.addEventListener("visibilitychange",onVisibilityChange);
  windowTarget?.addEventListener("focus",onResume);
  windowTarget?.addEventListener("pageshow",onResume);
  return()=>{
    if(timer!==undefined)clearTimer(timer);
    documentTarget?.removeEventListener("visibilitychange",onVisibilityChange);
    windowTarget?.removeEventListener("focus",onResume);
    windowTarget?.removeEventListener("pageshow",onResume);
  };
}

export function useDashboardGreeting(displayName:string|undefined,explicitTimeZone?:string):string|null{
  const [greeting,setGreeting]=useState<string|null>(null);
  useEffect(()=>{
    const timeZone=resolveGreetingTimeZone(explicitTimeZone);
    return startDashboardGreetingClock({timeZone,onChange:value=>setGreeting(dashboardGreeting(value,timeZone,displayName))});
  },[displayName,explicitTimeZone]);
  return greeting;
}
