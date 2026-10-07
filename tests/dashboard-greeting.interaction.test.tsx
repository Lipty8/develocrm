import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardGreeting,
  greetingPeriodAt,
  nextGreetingTransition,
  resolveGreetingTimeZone,
  startDashboardGreetingClock,
} from "../app/lib/dashboard-greeting";

const utc=(hour:number,minute:number)=>new Date(Date.UTC(2026,0,15,hour,minute));

test("pozdrav dodržuje všechny časové hranice",()=>{
  const cases:Array<[number,number,string]>=[
    [0,0,"morning"],[8,59,"morning"],[9,0,"forenoon"],[11,59,"forenoon"],
    [12,0,"afternoon"],[17,59,"afternoon"],[18,0,"evening"],[23,59,"evening"],
  ];
  for(const[hour,minute,expected]of cases)assert.equal(greetingPeriodAt(utc(hour,minute),"UTC"),expected,`${hour}:${minute}`);
});

test("pozdrav používá explicitní timezone před browserem a nepoužívá UTC hodinu",()=>{
  const instant=new Date("2026-01-15T08:30:00Z");
  assert.equal(resolveGreetingTimeZone("Europe/Prague",()=>"America/New_York"),"Europe/Prague");
  assert.equal(greetingPeriodAt(instant,"UTC"),"morning");
  assert.equal(greetingPeriodAt(instant,"Europe/Prague"),"forenoon");
  assert.equal(resolveGreetingTimeZone(undefined,()=>"America/New_York"),"America/New_York");
});

test("jméno je volitelné a známý bezpečný vokativ se použije",()=>{
  const instant=utc(9,30);
  assert.equal(dashboardGreeting(instant,"UTC","Adam Lipták"),"Dobré dopoledne, Adame");
  assert.equal(dashboardGreeting(instant,"UTC",""),"Dobré dopoledne");
  assert.equal(dashboardGreeting(instant,"UTC","adam@example.com"),"Dobré dopoledne");
});

class TestTarget{
  visibilityState="visible";
  listeners=new Map<string,Set<EventListener>>();
  addEventListener(type:string,listener:EventListener){const set=this.listeners.get(type)??new Set<EventListener>();set.add(listener);this.listeners.set(type,set);}
  removeEventListener(type:string,listener:EventListener){this.listeners.get(type)?.delete(listener);}
  emit(type:string){for(const listener of this.listeners.get(type)??[])listener(new Event(type));}
}

test("timer přepne pozdrav přes hranici bez reloadu a uklidí se",()=>{
  let current=new Date("2026-01-15T08:59:30Z");
  let scheduled:(()=>void)|undefined;
  let cleared=0;
  const values:string[]=[];
  const dispose=startDashboardGreetingClock({
    timeZone:"UTC",now:()=>current,onChange:value=>values.push(dashboardGreeting(value,"UTC")),
    setTimer:callback=>{scheduled=callback;return 1 as unknown as ReturnType<typeof setTimeout>;},
    clearTimer:()=>{cleared+=1;},documentTarget:undefined,windowTarget:undefined,
  });
  assert.equal(values.at(-1),"Dobré ráno");
  assert.ok(nextGreetingTransition(current,"UTC").getTime()<=Date.parse("2026-01-15T09:00:01Z"));
  current=new Date("2026-01-15T09:00:01Z");scheduled?.();
  assert.equal(values.at(-1),"Dobré dopoledne");
  dispose();assert.ok(cleared>=1);
});

test("návrat do tabu a probuzení ihned přepočítají pozdrav",()=>{
  let current=new Date("2026-01-15T11:30:00Z");
  const documentTarget=new TestTarget();const windowTarget=new TestTarget();const values:string[]=[];
  const dispose=startDashboardGreetingClock({
    timeZone:"UTC",now:()=>current,onChange:value=>values.push(dashboardGreeting(value,"UTC")),
    setTimer:()=>1 as unknown as ReturnType<typeof setTimeout>,clearTimer:()=>{},documentTarget,windowTarget,
  });
  assert.equal(values.at(-1),"Dobré dopoledne");
  current=new Date("2026-01-15T13:00:00Z");windowTarget.emit("focus");
  assert.equal(values.at(-1),"Dobré odpoledne");
  current=new Date("2026-01-15T18:30:00Z");documentTarget.emit("visibilitychange");
  assert.equal(values.at(-1),"Dobrý večer");
  dispose();
  assert.equal(documentTarget.listeners.get("visibilitychange")?.size,0);
  assert.equal(windowTarget.listeners.get("focus")?.size,0);
  assert.equal(windowTarget.listeners.get("pageshow")?.size,0);
});
