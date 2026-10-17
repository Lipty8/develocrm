import assert from 'node:assert/strict';
import test from 'node:test';
import {addCzechWorkingDays,czechSignatureDay,isCzechWorkingDay} from '../src/contracts/czech-working-days.js';

test('RS tři pracovní dny začínají až po podpisu a přeskočí víkend',()=>{
  assert.equal(addCzechWorkingDays('2026-10-16',3),'2026-10-21');
  assert.equal(addCzechWorkingDays('2026-10-17',3),'2026-10-21');
  assert.equal(addCzechWorkingDays('2026-10-19',3),'2026-10-22');
});
test('vánoční svátky a přechod roku',()=>{
  assert.equal(addCzechWorkingDays('2026-12-23',3),'2026-12-30');
  assert.equal(addCzechWorkingDays('2026-12-30',3),'2027-01-05');
});
test('Velký pátek a Velikonoční pondělí 2026',()=>{
  assert.equal(isCzechWorkingDay('2026-04-03'),false);
  assert.equal(isCzechWorkingDay('2026-04-06'),false);
  assert.equal(addCzechWorkingDays('2026-04-02',3),'2026-04-09');
});
test('pohyblivé Velikonoce 2027 a hranice března',()=>{
  assert.equal(isCzechWorkingDay('2027-03-26'),false);
  assert.equal(isCzechWorkingDay('2027-03-29'),false);
  assert.equal(addCzechWorkingDays('2027-03-25',3),'2027-04-01');
});
test('svátky z § 1 a § 2 nejsou pracovní den ani v týdnu',()=>{
  for(const day of ['01-01','05-01','05-08','07-05','07-06','09-28','10-28','11-17','12-24','12-25','12-26']){
    assert.equal(isCzechWorkingDay(`2026-${day}`),false,day);
  }
  assert.equal(isCzechWorkingDay('2026-03-28'),false); // Saturday, not a new holiday.
  assert.equal(isCzechWorkingDay('2026-03-09'),true); // Significant day is not a holiday.
});
test('SBK pět pracovních dnů přes dva červencové svátky',()=>{
  assert.equal(addCzechWorkingDays('2027-07-02',5),'2027-07-13');
});
test('přestupný rok bez převádění kalendářních dnů přes lokální půlnoc',()=>{
  assert.equal(addCzechWorkingDays('2028-02-28',3),'2028-03-02');
  assert.equal(addCzechWorkingDays('2026-03-27',1),'2026-03-30');
  assert.equal(addCzechWorkingDays('2026-10-23',1),'2026-10-26');
});
test('podpis v UTC se v zimě i létě převede na české smluvní datum',()=>{
  assert.equal(czechSignatureDay('2026-01-15T23:30:00Z'),'2026-01-16');
  assert.equal(czechSignatureDay('2026-07-01T22:30:00Z'),'2026-07-02');
  assert.equal(czechSignatureDay('2026-07-02T00:30:00+02:00'),'2026-07-02');
});
test('nepoužije serverové dnešní datum při chybějícím nebo nejednoznačném podpisu',()=>{
  for(const value of ['', '2026-10-17','2026-10-17T12:00:00','2026-02-30T12:00:00Z','2026-10-17T25:00:00Z']){
    assert.throws(()=>czechSignatureDay(value));
  }
});
test('neplatné kalendářní hodnoty, rozsahy a necelé lhůty jsou odmítnuté',()=>{
  for(const day of ['', '2026-02-30','2027-02-29','2026-13-01','2026-1-1','2015-04-03','2100-01-01'])assert.throws(()=>addCzechWorkingDays(day,3));
  for(const count of [-1,0.5,NaN,Infinity,367])assert.throws(()=>addCzechWorkingDays('2026-10-17',count));
  assert.equal(addCzechWorkingDays('2026-10-17',0),'2026-10-17');
});
