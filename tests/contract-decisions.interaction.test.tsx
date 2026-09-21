import assert from "node:assert/strict";
import {afterEach,before,test} from "node:test";
import React,{useState} from "react";
import {JSDOM} from "jsdom";
import {RowActionMenu} from "../app/components/row-action-menu";
import {TableColumnMenu,TableColumnPreferenceProvider,useTableColumns,type TableColumnDefinition} from "../app/components/table-column-config";
import {TableColumnFilter} from "../app/components/table-column-filter";
import {ContractAddendumModal,ContractNoteModal,FormModal,PaymentDetailModal,PaymentRefundForm,paymentRefundAvailability} from "../app/CRMApp";

let cleanup:()=>void;
let render:typeof import("@testing-library/react").render;
let screen:typeof import("@testing-library/react").screen;
let fireEvent:typeof import("@testing-library/react").fireEvent;
let waitFor:typeof import("@testing-library/react").waitFor;
let act:typeof import("@testing-library/react").act;
let userEvent:typeof import("@testing-library/user-event").default;

before(async()=>{
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://develocrm.test"});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,MouseEvent:dom.window.MouseEvent,KeyboardEvent:dom.window.KeyboardEvent,getComputedStyle:dom.window.getComputedStyle,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
  Object.defineProperty(globalThis,"navigator",{value:dom.window.navigator,configurable:true});
  const library=await import("@testing-library/react");
  ({cleanup,render,screen,fireEvent,waitFor,act}=library);
  userEvent=(await import("@testing-library/user-event")).default;
});

afterEach(()=>{cleanup();window.localStorage.clear();});

const columns:readonly TableColumnDefinition[]=[
  {id:"name",label:"Název",required:true,defaultVisible:true},
  {id:"price",label:"Cena",defaultVisible:true},
  {id:"status",label:"Stav",defaultVisible:false},
];

function ColumnHarness(){
  const state=useTableColumns("interaction-table",columns);
  return <><TableColumnMenu columns={columns} state={state}/><output>{state.visibleIds.join(",")}</output></>;
}

test("column picker se otevře, okamžitě skryje sloupec, uloží preferenci a umí reset",async()=>{
  const user=userEvent.setup({document});
  render(<TableColumnPreferenceProvider userKey="tester"><ColumnHarness/></TableColumnPreferenceProvider>);
  await waitFor(()=>assert.match(screen.getByRole("status").textContent??"",/price/));
  await user.click(screen.getByRole("button",{name:/Sloupce/}));
  const price=screen.getByRole("checkbox",{name:"Cena"});
  await user.click(price);
  assert.doesNotMatch(screen.getByRole("status").textContent??"",/price/);
  await waitFor(()=>assert.match(window.localStorage.getItem("develocrm.table-columns.v2:tester:interaction-table")??"",/name/));
  await user.click(screen.getByRole("button",{name:/Obnovit výchozí sloupce/}));
  assert.match(screen.getByRole("status").textContent??"",/price/);
});

test("row menu podporuje click, akci, zavření a klávesu Escape",async()=>{
  const user=userEvent.setup({document});let selected="";
  render(<RowActionMenu label="Akce smlouvy" actions={[{label:"Otevřít",onSelect:()=>{selected="open";}},{label:"Archivovat",danger:true,onSelect:()=>{selected="archive";}}]}/>);
  const trigger=screen.getByRole("button",{name:"Akce smlouvy"});
  await user.click(trigger);assert.ok(screen.getByRole("menu"));
  await user.click(screen.getByRole("menuitem",{name:"Otevřít"}));assert.equal(selected,"open");assert.equal(screen.queryByRole("menu"),null);
  await user.click(trigger);await user.keyboard("{Escape}");assert.equal(screen.queryByRole("menu"),null);
});

test("hlavička sloupce řadí a její popover aplikuje filtr",async()=>{
  const user=userEvent.setup({document});
  function Harness(){const[sort,setSort]=useState<"none"|"asc"|"desc">("none");const[active,setActive]=useState(false);return <table><thead><tr><TableColumnFilter label="Cena" sortDirection={sort} onSort={setSort}/><TableColumnFilter label="Stav" active={active}><button onClick={()=>setActive(true)}>Jen aktivní</button></TableColumnFilter></tr></thead><tbody><tr><td>{sort}</td><td>{active?"aktivní":"vše"}</td></tr></tbody></table>}
  render(<Harness/>);
  await user.click(screen.getByRole("button",{name:"Seřadit sloupec Cena"}));assert.equal(screen.getByText("asc").textContent,"asc");
  await user.click(screen.getAllByRole("button",{name:"Filtrovat sloupec Stav"})[0]);await user.click(screen.getByRole("button",{name:"Jen aktivní"}));assert.equal(screen.getByText("aktivní").textContent,"aktivní");
});

test("FormModal zobrazuje loading a chybu a chrání před dvojím submittem",async()=>{
  let calls=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  render(<FormModal title="Test" close={()=>{}} onSave={async()=>{calls+=1;await pending;}}><span>Obsah</span></FormModal>);
  const submit=screen.getByRole("button",{name:"Uložit"});
  fireEvent.click(submit);fireEvent.click(submit);
  assert.equal(calls,1);assert.equal(screen.getByRole("button",{name:"Ukládám…"}).hasAttribute("disabled"),true);
  await act(async()=>release());
  cleanup();
  render(<FormModal title="Chyba" close={()=>{}} onSave={async()=>{throw new Error("Uložení bylo odmítnuto");}}><span>Obsah</span></FormModal>);
  await userEvent.setup({document}).click(screen.getByRole("button",{name:"Uložit"}));
  assert.ok(await screen.findByText("Uložení bylo odmítnuto"));
});

test("poznámkový modal provede reálný vstup a předá očištěný text mutaci",async()=>{
  const user=userEvent.setup({document});let saved="";
  render(<ContractNoteModal close={()=>{}} save={async text=>{saved=text;}}/>);
  await user.type(screen.getByRole("textbox",{name:"Poznámka"}),"  Interní informace  ");
  await user.click(screen.getByRole("button",{name:"Uložit poznámku"}));
  await waitFor(()=>assert.equal(saved,"Interní informace"));
});

test("modal dodatku předá název a vratka dovolí volitelnou poznámku",async()=>{
  const user=userEvent.setup({document});let addendumTitle:string|undefined;
  const contract={id:"contract-1",reference:"DEJ-417-RS",title:"RS",type:"RS"} as never;
  render(<ContractAddendumModal contract={contract} close={()=>{}} save={async title=>{addendumTitle=title;}}/>);
  await user.type(screen.getByRole("textbox",{name:"Název dodatku (volitelné)"}),"Dodatek ke kupujícím");
  await user.click(screen.getByRole("button",{name:"Vytvořit dodatek"}));
  await waitFor(()=>assert.equal(addendumTitle,"Dodatek ke kupujícím"));
  cleanup();
  let refund:Record<string,unknown>|undefined;window.confirm=()=>true;
  const payment={id:"obligation-1",unit:"417",client:"Jan Novák",paid:100000,refunded:0,refundable:100000,refundAllowed:true,contractReference:"DEJ-417-RS",transactions:[{id:"transaction-1",amount:100000,paidAt:"2026-09-15T08:00:00Z",sourceType:"manual",refunds:[]}]} as never;
  render(<PaymentRefundForm payment={payment} busy={false} error="" cancel={()=>{}} save={async value=>{refund=value;}}/>);
  assert.ok(screen.getByText("K VRÁCENÍ"));
  assert.equal(screen.getByRole("textbox",{name:"Částka vratky"}).getAttribute("value"),"100 000");
  assert.ok(screen.getByRole("note").textContent?.includes("Peníze nejsou prostřednictvím DeveloCRM odesílány."));
  await user.click(screen.getByRole("button",{name:"Potvrdit vratku"}));
  await waitFor(()=>assert.equal(refund?.sourceTransactionId,"transaction-1"));
  assert.equal(refund?.amount,100000);assert.equal(refund?.reason,undefined);assert.equal(typeof refund?.idempotencyKey,"string");
});

test("detail platby zvýrazní vratku, zkrátí souhrn a rozliší historii",()=>{
  const payment={id:"obligation-1",project:"Rezidence Dejvice",unit:"417",client:"Jan Novák",label:"Rezervační poplatek",amount:2471000,paid:2471000,refunded:500000,refundable:1971000,refundAllowed:true,status:"paid",dueAt:"2026-09-15",contractReference:"DEJ-417-RS",contractType:"rs",contractStatus:"cancelled",transactions:[{id:"transaction-1",amount:2471000,paidAt:"2026-09-15T08:00:00Z",sourceType:"manual",note:"Připsáno",refunds:[{id:"refund-1",amount:500000,refundedAt:"2026-09-16T08:00:00Z",reason:"Vráceno klientovi"}]}]} as never;
  const {container}=render(<PaymentDetailModal payment={payment} close={()=>{}} openUnit={()=>{}} canRecord={false} canReverse={false} saved={()=>{}}/>);
  const summary=container.querySelector(".payment-refund-overview");
  assert.ok(summary);
  assert.doesNotMatch(summary.textContent??"",/ČISTĚ PŘIJATO/i);
  assert.ok(summary.querySelector(".refund-due-summary")?.textContent?.includes("1 971 000"));
  assert.equal(summary.querySelectorAll(".badge").length,1);
  assert.ok(screen.getByText(/Nevrácená platba z ukončené rezervace/));
  assert.ok(container.querySelector(".payment-history article strong")?.textContent?.includes("Úhrada +2 471 000 Kč"));
  assert.ok(container.querySelector(".refund-history strong")?.textContent?.includes("Vratka −500 000 Kč"));
  assert.ok(screen.getByRole("button",{name:"Vytvořit vratku"}));
});

test("vratka předvyplní nižší z částky transakce a celkového zůstatku",()=>{
  const payment={id:"obligation-2",unit:"417",client:"Jan Novák",paid:2471000,refunded:500000,refundable:1971000,refundAllowed:true,contractReference:"DEJ-417-RS",transactions:[{id:"transaction-2",amount:2471000,paidAt:"2026-09-15T08:00:00Z",sourceType:"manual",refunds:[]}]} as never;
  render(<PaymentRefundForm payment={payment} busy={false} error="" cancel={()=>{}} save={()=>{}}/>);
  assert.equal(screen.getByRole("textbox",{name:"Částka vratky"}).getAttribute("value"),"1 971 000");
});

test("CTA vratky používá serverovou projekci oprávnění a zbývající částky",()=>{
  const base={paid:150000,refunded:50000,refundable:100000,refundAllowed:true} as never;
  assert.deepEqual(paymentRefundAvailability(base),{refunded:50000,refundable:100000,available:true});
  assert.equal(paymentRefundAvailability({...base,refundAllowed:false} as never).available,false);
  assert.equal(paymentRefundAvailability({...base,refundable:0} as never).available,false);
  assert.deepEqual(paymentRefundAvailability({paid:150000,refunded:0,contractType:"rs",contractStatus:"signed"} as never),{refunded:0,refundable:0,available:false});
});
