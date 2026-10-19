import test from 'node:test';
import assert from 'node:assert/strict';
import {nextRampTarget,dailyRampLimit} from './outreach-ramp.mjs';
import {campaignLimit,remainingCapacity} from './outreach-policy.mjs';

test('10% growth keeps fractions, caps at 50, and requires completed delivered sends',()=>{
  assert.equal(nextRampTarget({completed:true,statuses:['delivered']}),11);
  assert.equal(nextRampTarget({previous:11,completed:true,statuses:['clicked','opened']}),12.1);
  assert.equal(nextRampTarget({previous:49,completed:true,statuses:['read']}),50);
  for(const statuses of [[],['pending'],['bounced'],['unresolved'],['delivered','accepted']])assert.equal(nextRampTarget({completed:true,statuses}),10);
  assert.equal(nextRampTarget({completed:false,statuses:['delivered']}),10);
  assert.throws(()=>nextRampTarget({previous:NaN}));
  assert.throws(()=>nextRampTarget({configured:100}));
  assert.throws(()=>campaignLimit({delivered:4,failed:1,rampTarget:10}),/delivery review/);
  assert.equal(remainingCapacity({observed:100,reserved:0}),0);
});

function fakeDb(prior=null,attempts=[]) {
  const days=new Map();
  return {days,async query(sql,args=[]) {
    if(sql.startsWith('CREATE'))return {rows:[]};
    if(sql.startsWith('SELECT target'))return {rows:days.has(args[0])?[days.get(args[0])]:[]};
    if(sql.startsWith('SELECT run_date'))return {rows:prior?[prior]:[]};
    if(sql.startsWith('SELECT a.status'))return {rows:attempts};
    if(sql.startsWith('INSERT')){if(!days.has(args[0]))days.set(args[0],{target:args[1]});return {rows:[days.get(args[0])]};}
    if(sql.startsWith('UPDATE prospecting_ramp_days')){days.set(args[0],{target:args[1]});return {rows:[]};}
    throw Error('Unexpected SQL');
  }};
}
const accepted={status:'accepted',email_message_id:'synthetic',contact_id:'synthetic'};
test('bootstrap is ten and same-day reruns retain the allocated target',async()=>{
  const db=fakeDb();let reads=0;
  const opts={readDelivery:async()=>{reads++;return {status:'delivered'};}};
  assert.equal(await dailyRampLimit(db,'2026-10-14',opts),10);
  assert.equal(await dailyRampLimit(db,'2026-10-14',opts),10);
  assert.equal(reads,0);
  await assert.rejects(dailyRampLimit(db,'2026-10-17',opts),/weekdays only/);
});
test('explicit approved floor raises the daily target without altering overall capacity protection',async()=>{
  const db=fakeDb();const options={floor:50,readDelivery:async()=>({status:'delivered'})};
  assert.equal(await dailyRampLimit(db,'2026-10-19',{...options,floor:0}),10);
  assert.equal(await dailyRampLimit(db,'2026-10-19',options),50);
  assert.equal(db.days.get('2026-10-19').target,50);
  assert.equal(await dailyRampLimit(db,'2026-10-19',options),50);
  await assert.rejects(dailyRampLimit(db,'2026-10-19',{...options,floor:100}),/floor invalid/);
  assert.throws(()=>campaignLimit({delivered:4,failed:1,rampTarget:50}),/delivery review/);
  assert.equal(remainingCapacity({observed:100,reserved:0}),0);
});
test('Friday to Monday grows once, missing delivery proof holds, internal tests do not grow the ramp',async()=>{
  const prior={run_date:'2026-10-16',target:'11',status:'complete'};
  const db=fakeDb(prior,[accepted]);
  const opts={readDelivery:async()=>({status:'delivered'})};
  assert.equal(await dailyRampLimit(db,'2026-10-19',opts),12);
  assert.equal(db.days.get('2026-10-19').target,12.1);
  assert.equal(await dailyRampLimit(db,'2026-10-19',opts),12);
  const missing=fakeDb(prior,[accepted]);
  assert.equal(await dailyRampLimit(missing,'2026-10-19',{readDelivery:async()=>{throw Error('Unavailable');}}),11);
  const empty=fakeDb(prior,[]);
  assert.equal(await dailyRampLimit(empty,'2026-10-19',opts),11);
});
