import assert from 'node:assert/strict';
import {before,afterEach,test} from 'node:test';
import React,{useState} from 'react';
import {JSDOM} from 'jsdom';
import {AccessoryLegalFields,accessoryLegalLabel} from '../app/components/AccessoryLegalFields';
import type {AccessoryLegalDetails} from '../backend/src/shared/accessory-legal-details';
let render:typeof import('@testing-library/react').render,screen:typeof import('@testing-library/react').screen,cleanup:typeof import('@testing-library/react').cleanup,fireEvent:typeof import('@testing-library/react').fireEvent;
before(async()=>{const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://develocrm.test'});Object.assign(globalThis,{self:dom.window,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});({render,screen,cleanup,fireEvent}=await import('@testing-library/react'));});
afterEach(()=>cleanup());
test('parking form explicitly selects rights, stores share and clears inapplicable shares',()=>{
 let current:AccessoryLegalDetails={legalForm:null,shareNumerator:null,shareDenominator:null};
 function Harness(){const[value,setValue]=useState(current);return <AccessoryLegalFields category="parking" value={value} onChange={next=>{current=next;setValue(next);}}/>;}
 render(<Harness/>);fireEvent.change(screen.getByRole('combobox'),{target:{value:'garage_coownership'}});
 fireEvent.change(screen.getByRole('spinbutton',{name:'Podíl – čitatel'}),{target:{value:'1'}});fireEvent.change(screen.getByRole('spinbutton',{name:'Podíl – jmenovatel'}),{target:{value:'25'}});
 assert.equal(accessoryLegalLabel(current),'Spoluvlastnický podíl na garáži · 1/25');
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'outdoor_parking_use_right'}});
 assert.deepEqual(current,{legalForm:'outdoor_parking_use_right',shareNumerator:null,shareDenominator:null});assert.equal(screen.queryByRole('spinbutton'),null);
});
test('cellar offers only its supported legal form; persisted garage values load unchanged',()=>{
 const value:AccessoryLegalDetails={legalForm:null,shareNumerator:null,shareDenominator:null};
 const view=render(<AccessoryLegalFields category="cellar" value={value} onChange={()=>{}}/>);assert.equal(screen.getAllByRole('option').length,2);
 view.rerender(<AccessoryLegalFields category="parking" value={{legalForm:'garage_coownership',shareNumerator:1,shareDenominator:25}} onChange={()=>{}}/>);
 assert.equal((screen.getByRole('spinbutton',{name:'Podíl – jmenovatel'}) as HTMLInputElement).value,'25');
});
