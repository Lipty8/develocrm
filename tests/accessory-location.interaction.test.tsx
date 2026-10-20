import assert from 'node:assert/strict';
import {before,afterEach,test} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {EditAccessoryModal} from '../app/CRMApp';
import type {AccessoryUpdateInput} from '../backend/src/shared/accessory-legal-details';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent,waitFor:typeof import('@testing-library/react').waitFor;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent,waitFor}=await import('@testing-library/react'));});
afterEach(()=>cleanup());
const item={id:'technical-location',code:'TECH-S',type:'Sklep',category:'cellar',areaM2:5,amount:1000,project:'Technical',available:true,location:'1. PP'};
test('existing location loads and changed value is sent with the same accessory edit',async()=>{
 let saved:AccessoryUpdateInput|undefined;
 render(<EditAccessoryModal item={item} close={()=>{}} save={async value=>{saved=value;}}/>);
 assert.equal((screen.getByLabelText('Podlaží / umístění') as HTMLInputElement).value,'1. PP');
 fireEvent.change(screen.getByLabelText('Podlaží / umístění'),{target:{value:'  2. PP  '}});
 fireEvent.click(screen.getByRole('button',{name:'Uložit'}));await waitFor(()=>assert.ok(saved));
 assert.equal(saved!.floorLabel,'2. PP');assert.equal(saved!.accessoryId,item.id);assert.equal(saved!.amount,1000);
});
test('empty location is explicitly cleared instead of silently keeping stale facts',async()=>{
 let saved:AccessoryUpdateInput|undefined;
 render(<EditAccessoryModal item={item} close={()=>{}} save={async value=>{saved=value;}}/>);
 fireEvent.change(screen.getByLabelText('Podlaží / umístění'),{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:'Uložit'}));await waitFor(()=>assert.ok(saved));assert.equal(saved!.floorLabel,null);
});
test('invalid location is blocked before request and save failure retains entered location',async()=>{
 let calls=0;render(<EditAccessoryModal item={item} close={()=>{}} save={async()=>{calls++;throw new Error('Příslušenství se nepodařilo upravit.');}}/>);
 fireEvent.change(screen.getByLabelText('Podlaží / umístění'),{target:{value:'x'.repeat(121)}});
 fireEvent.click(screen.getByRole('button',{name:'Uložit'}));await screen.findByText(/Umístění musí být/);assert.equal(calls,0);
 fireEvent.change(screen.getByLabelText('Podlaží / umístění'),{target:{value:'Technické podlaží'}});
 fireEvent.click(screen.getByRole('button',{name:'Uložit'}));await screen.findByText('Příslušenství se nepodařilo upravit.');
 assert.equal(calls,1);assert.equal((screen.getByLabelText('Podlaží / umístění') as HTMLInputElement).value,'Technické podlaží');
});
