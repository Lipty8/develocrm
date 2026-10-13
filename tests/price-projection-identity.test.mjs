import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const crm=readFileSync(new URL('../app/CRMApp.tsx',import.meta.url),'utf8');
const catalog=readFileSync(new URL('../app/api/catalog/route.ts',import.meta.url),'utf8');
// Exercise the production merge block, not a second pricing implementation.
const mergeLine=crm.split('\n').find(line=>line.includes('for(const unit of units){const key=unit.backendId'));
assert.ok(mergeLine);
const merge=new Function('units','snapshot',mergeLine);
const start=catalog.indexOf('    const legacyBreakdown =');
const end=catalog.indexOf('    return {',start);
assert.ok(start>=0&&end>start);
const adaptPrices=new Function('unit','priceBreakdowns',catalog.slice(start,end)+'return {unitPrice,accessoryPrice,totalPrice};');

test('partial project price permission never reuses a same-code alias from another project',()=>{
 const units=[{id:'417',backendId:'project-a-unit',price:null,priceConfigured:false},{id:'417',backendId:'project-b-unit',price:null,priceConfigured:false}];
 const snapshot={currentPrices:{'project-a-unit':5000000,'417':5000000},priceBreakdowns:{'project-a-unit':{unitPrice:5000000,accessoryPrice:0},'417':{unitPrice:5000000,accessoryPrice:0}}};
 merge(units,snapshot);assert.equal(units[0].price,5000000);assert.equal(units[1].price,null);assert.equal(units[1].priceConfigured,false);
});
test('BFF uses UUID and preserves explicit missing or unauthorized price',()=>{
 const projections={'project-a-unit':{unitPrice:5000000,accessoryPrice:0,totalPrice:5000000},'417':{unitPrice:5000000,accessoryPrice:0,totalPrice:5000000}};
 assert.equal(adaptPrices({id:'project-b-unit',code:'417',unitPrice:null,totalPrice:null,accessoryPrice:0},projections).unitPrice,null);
 assert.equal(adaptPrices({id:'project-b-unit',code:'417'},projections).totalPrice,null);
 assert.equal(adaptPrices({id:'project-a-unit',code:'417'},projections).unitPrice,5000000);
 assert.equal(adaptPrices({id:'project-a-unit',code:'417',unitPrice:0,totalPrice:0},projections).unitPrice,0);
 assert.equal(adaptPrices({id:'project-a-unit',code:'417',unitPrice:null,totalPrice:null},projections).unitPrice,null);
});
test('price history cannot fall back from a known UUID to another project code',()=>{
 assert.match(crm,/unitPriceHistories\[unit\.backendId\?\?unit\.id\]\?\?\[\]/);
 assert.doesNotMatch(crm,/unitPriceHistories\[unit\.backendId\?\?unit\.id\]\?\?unitPriceHistories\[unit\.id\]/);
});
