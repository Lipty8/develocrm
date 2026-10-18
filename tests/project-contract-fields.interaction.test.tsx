import assert from 'node:assert/strict';
import {before,afterEach,test} from 'node:test';
import React,{useState} from 'react';
import {JSDOM} from 'jsdom';
import {ProjectContractFields,emptyProjectContractSettings,validateProjectContractSettings} from '../app/components/project-contract-fields';
import type {ProjectContractSettings} from '../backend/src/shared/project-contract-settings';

let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,
  cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent;
before(async()=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});
  Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  ({render,screen,cleanup,fireEvent}=await import('@testing-library/react'));
});
afterEach(()=>cleanup());

test('stávající projektový formulář nabízí nové smluvní údaje a zachová ostatní pole',()=>{
  let current:ProjectContractSettings={...emptyProjectContractSettings,name:'Technical seller'};
  function Harness(){const[value,setValue]=useState(current);return <ProjectContractFields value={value} onChange={next=>{current=next;setValue(next);}}/>;}
  render(<Harness/>);
  for(const[label,value]of [['Jméno a funkce u podpisu','Technical signer'],['Účet pro klientské změny','111/0000'],['Doručovací adresa prodávajícího','Technical delivery']]){
    fireEvent.change(screen.getByRole('textbox',{name:label}),{target:{value}});
  }
  assert.equal(current.signatureName,'Technical signer');
  assert.equal(current.clientChangesBankAccount,'111/0000');
  assert.equal(current.deliveryAddress,'Technical delivery');
  assert.equal(current.name,'Technical seller');
});

test('znovu načtené hodnoty se zobrazí přes stejnou komponentu',()=>{
  render(<ProjectContractFields value={{...emptyProjectContractSettings,signatureName:'Stored signer',clientChangesBankAccount:'222/0000',deliveryAddress:'Stored address'}} onChange={()=>{}}/>);
  assert.equal((screen.getByRole('textbox',{name:'Jméno a funkce u podpisu'}) as HTMLInputElement).value,'Stored signer');
  assert.equal((screen.getByRole('textbox',{name:'Účet pro klientské změny'}) as HTMLInputElement).value,'222/0000');
  assert.equal((screen.getByRole('textbox',{name:'Doručovací adresa prodávajícího'}) as HTMLInputElement).value,'Stored address');
});

test('starší kompletní nastavení bez nových polí zůstane platné',()=>{
  const value={...emptyProjectContractSettings,name:'Test',registrationNumber:'00000000',address:'Test',registryEntry:'Test',representative:'Test',email:'test@example.test',dataBox:'TEST',bankAccount:'000/0000',bankName:'Test'};
  validateProjectContractSettings(value);
  render(<ProjectContractFields value={value} onChange={()=>{}}/>);
  assert.equal((screen.getByRole('textbox',{name:'Jméno a funkce u podpisu'}) as HTMLInputElement).value,'');
});
