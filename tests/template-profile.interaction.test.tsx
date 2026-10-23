import assert from 'node:assert/strict';
import {before,afterEach,test} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {TemplateProfilePicker,TemplateGenerationNotice,ORIGINAL_DOB_FULL_VARIANT,SBK_DOB_DELIVERY_VARIANT} from '../app/components/template-profile-picker';

let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,
  cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent;
before(async()=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});
  Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  ({render,screen,cleanup,fireEvent}=await import('@testing-library/react'));
});
afterEach(()=>cleanup());

test('RS odděluje původní variantu a nový kontrolní návrh bez změny výchozí',()=>{
  let selected='default';
  const view=render(<TemplateProfilePicker type="reservation_contract" value={selected} onChange={value=>{selected=value;}}/>);
  assert.ok(screen.getByRole('option',{name:'Dosavadní varianta'}));
  fireEvent.change(screen.getByRole('combobox'),{target:{value:ORIGINAL_DOB_FULL_VARIANT}});
  assert.equal(selected,ORIGINAL_DOB_FULL_VARIANT);
  view.rerender(<TemplateProfilePicker type="reservation_contract" value={selected} onChange={()=>{}}/>);
  assert.ok(screen.getByText(/Nelze ji aktivovat pro smlouvy/));
});

test('SBK nabízí skutečnou kompletní variantu s datem narození, ne neexistující legacy variantu',()=>{
  render(<TemplateProfilePicker type="future_purchase_contract" value={ORIGINAL_DOB_FULL_VARIANT} onChange={()=>{}}/>);
  assert.equal(screen.queryByRole('option',{name:'Dosavadní varianta'}),null);
  assert.match(screen.getByRole('combobox').textContent??'',/datum narození/);
});

test('technická šablona nepotřebuje smluvní variantu a starší projektová varianta zůstává vybratelná',()=>{
  const view=render(<TemplateProfilePicker type="other" value="default" onChange={()=>{}}/>);
  assert.equal(screen.queryByRole('combobox'),null);
  view.rerender(<TemplateProfilePicker type="reservation_contract" value="custom-existing" onChange={()=>{}}/>);
  assert.equal((screen.getByRole('combobox') as HTMLSelectElement).value,'custom-existing');
});

test('upozornění rozlišuje review-only šablonu od dostupného generování',()=>{
  const view=render(<TemplateGenerationNotice supported={false}/>);
  assert.match(screen.getByRole('status').textContent??'',/pouze ke kontrole/);
  view.rerender(<TemplateGenerationNotice supported/>);
  assert.equal(screen.queryByRole('status'),null);
});
test('nová doručovací varianta je volitelná pouze pro SBK a zůstává neaktivní',()=>{
 let selected=ORIGINAL_DOB_FULL_VARIANT;
 const view=render(<TemplateProfilePicker type="future_purchase_contract" value={selected} onChange={value=>{selected=value;}}/>);
 fireEvent.change(screen.getByRole('combobox'),{target:{value:SBK_DOB_DELIVERY_VARIANT}});
 assert.equal(selected,SBK_DOB_DELIVERY_VARIANT);
 view.rerender(<TemplateProfilePicker type="future_purchase_contract" value={selected} onChange={()=>{}}/>);
 assert.match(screen.getByRole('combobox').textContent??'',/doručování prodávajícímu z projektu/);
 assert.ok(screen.getByText(/nahraje jako koncept/));
 assert.ok(screen.getByText(/obsahové kontrole a výslovném schválení konkrétní verze/));
 assert.equal(screen.queryByText(/Nelze ji aktivovat/),null);
 view.rerender(<TemplateProfilePicker type="reservation_contract" value={ORIGINAL_DOB_FULL_VARIANT} onChange={()=>{}}/>);
 assert.equal(screen.queryByRole('option',{name:/doručování prodávajícímu z projektu/}),null);
});
