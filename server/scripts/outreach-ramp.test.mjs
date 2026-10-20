import test from 'node:test';
import assert from 'node:assert/strict';
import {nextRampTarget,dailyRampLimit} from './outreach-ramp.mjs';
import {campaignLimit} from './outreach-policy.mjs';
import {sharedCapacity} from './shared-budget.mjs';
test('100 grows by 10% on healthy sending days, fractions retained, maximum 1000',()=>{
  assert.equal(nextRampTarget({completed:true,statuses:['delivered']}),110);
  assert.equal(nextRampTarget({previous:110,completed:true,statuses:['clicked','opened']}),121);
  assert.equal(nextRampTarget({previous:121,completed:true,statuses:['read']}),133.1);
  assert.equal(nextRampTarget({previous:999,completed:true,statuses:['read']}),1000);
  for(const statuses of [[],['pending'],['bounced'],['unresolved'],['delivered','accepted']])assert.equal(nextRampTarget({completed:true,statuses}),100);
  assert.equal(nextRampTarget({completed:false,statuses:['delivered']}),100);
  assert.throws(()=>nextRampTarget({previous:NaN}));
  assert.throws(()=>nextRampTarget({configured:1001}));
  assert.throws(()=>campaignLimit({configured:1000,delivered:4,failed:1,rampTarget:100}),/delivery review/);
});
function fakeDb(prior=null,attempts=[]) {
  const days=new Map();
  return {days,async query(sql,args=[]) {
    if(sql.startsWith('CREATE'))return {rows:[]};
    if(sql.startsWith('SELECT target'))return {rows:days.has(args[0])?[days.get(args[0])]:[]};
    if(sql.startsWith('SELECT run_date'))return {rows:prior?[prior]:[]};
    if(sql.startsWith('SELECT a.status')){assert(sql.includes('website_attempts'));return {rows:attempts};}
    if(sql.startsWith('INSERT')){if(!days.has(args[0]))days.set(args[0],{target:args[1]});return {rows:[days.get(args[0])]};}
    if(sql.startsWith('UPDATE shared_outreach_ramp_days')){days.set(args[0],{target:args[1]});return {rows:[]};}
    throw Error('Unexpected SQL');
  }};
}
const accepted={status:'accepted',email_message_id:'synthetic',contact_id:'synthetic'};
test('start at100; same-day reruns do not grow; weekends rejected',async()=>{
  const db=fakeDb();let reads=0;const opts={readDelivery:async()=>{reads++;return {status:'delivered'};}};
  assert.equal(await dailyRampLimit(db,'2026-10-20',opts),100);
  assert.equal(await dailyRampLimit(db,'2026-10-20',opts),100);assert.equal(reads,0);
  await assert.rejects(dailyRampLimit(db,'2026-10-24',opts),/weekdays only/);
});
test('Friday to Monday grows once; unavailable proof and zero sends hold',async()=>{
  const prior={run_date:'2026-10-23',target:'121',status:'complete'};
  const opts={readDelivery:async()=>({status:'delivered'})};const db=fakeDb(prior,[accepted]);
  assert.equal(await dailyRampLimit(db,'2026-10-26',opts),133);assert.equal(db.days.get('2026-10-26').target,133.1);
  assert.equal(await dailyRampLimit(db,'2026-10-26',opts),133);
  assert.equal(await dailyRampLimit(fakeDb(prior,[accepted]),'2026-10-26',{readDelivery:async()=>{throw Error('Unavailable');}}),121);
  assert.equal(await dailyRampLimit(fakeDb(prior,[]),'2026-10-26',opts),121);
});
test('shared capacity includes pending attempts and unknown external mail without counting known mail twice',async()=>{
  const rows=[{message_id:'known'},{}];const queries=[];
  const db={async query(sql){queries.push(sql);return{rows:sql.startsWith('SELECT target')?[{target:100}]:rows};}};
  const history=[{id:'known',direction:'outbound',dateAdded:'2026-10-20T09:00:00Z'},{id:'outside',direction:'outbound',dateAdded:'2026-10-20T09:00:00Z'}];
  assert.equal(await sharedCapacity(db,'2026-10-20',history),97);
  assert(queries[1].includes('website_acknowledgements'));assert(queries[1].includes('prospecting_send_attempts'));
  rows.push(...Array.from({length:97},()=>({})));assert.equal(await sharedCapacity(db,'2026-10-20',history),0);
  await assert.rejects(sharedCapacity(db,'2026-10-20',null));
});

