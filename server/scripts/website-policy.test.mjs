import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteWindow,websiteSearches,websiteFindings,recipientHold,composeWebsite,retireDecision,websiteSenderVerified} from './website-policy.mjs';
import {reserveWebsite,submitWebsite} from './website-store.mjs';
test('9am UK stays correct across DST and excludes weekends',()=>{
  assert.equal(websiteWindow(new Date('2026-10-23T08:00:00Z')).due,true);
  assert.equal(websiteWindow(new Date('2026-10-26T09:00:00Z')).due,true);
  assert.equal(websiteWindow(new Date('2026-10-26T08:00:00Z')).due,false);
  assert.equal(websiteWindow(new Date('2026-10-25T09:00:00Z')).due,false);
  for(let i=1;i<29;i++)assert(websiteSearches('2026-10-'+String(i).padStart(2,'0')).every(s=>s.location.endsWith('Scotland')&&!/accountant/i.test(s.niche)));
});
test('findings reflect actual links/measurements; complete good pages do not qualify',()=>{
  const desktop={links:[{href:'tel:undefined',text:'Call'}],emails:[],text:''};
  assert.equal(websiteFindings(desktop,{width:390,scrollWidth:970}).length,2);
  assert.deepEqual(websiteFindings({...desktop,links:[]},{width:390,scrollWidth:390}),[]);
});
const candidate={company:'Synthetic Co',website:'https://example.invalid',domain:'example.invalid',email:'info@example.invalid',emailSourceUrl:'https://example.invalid/contact',sector:'commercial electricians',corporate:{verified:true},evidence:{findings:['An observed test finding.','Another observed test finding.'],desktop:true,mobile:true}};
test('a clicked internal proof remains valid only with the actual Proxaim sender',()=>{
  assert(websiteSenderVerified({status:'clicked',emailFrom:'Proxaim <hello@proxaim.com>'}));
  assert(!websiteSenderVerified({status:'accepted',emailFrom:'Proxaim <hello@proxaim.com>'}));
  assert(!websiteSenderVerified({status:'clicked',emailFrom:'Other <other@example.invalid>'}));
});
test('no claimed preview before QA; no clinical email without professional identity',()=>{
  assert.equal(recipientHold(candidate),null);
  assert.equal(recipientHold({...candidate,sector:'private dentists'}),'professional-identity-unverified');
  assert(!composeWebsite(candidate).message.includes("I've put together"));
  const copy=composeWebsite({...candidate,previewVerified:true});
  assert(copy.message.includes("I've put together"));assert(!copy.message.includes('\u2014'));assert(copy.message.includes('hello@proxaim.com'));
});
test('twentieth attempt is allowed, twenty-first and exhausted shared capacity are blocked',async()=>{
  function dbWith(n){const log=[];return{log,async query(sql){log.push(sql);if(sql.startsWith('SELECT 1'))return{rowCount:0};if(sql.includes('count(*)'))return{rows:[{n:/website_alerts|website_acknowledgements|website_controls/.test(sql)?0:n}]};return{rows:[],rowCount:1};}};}
  const args={id:'key',prospectId:'id',date:'2026-10-12',observedForeign:0,message:{}};
  assert.equal(await reserveWebsite(dbWith(19),args),true);
  assert.equal(await reserveWebsite(dbWith(20),args),false);
  assert.equal(await reserveWebsite(dbWith(19),{...args,observedForeign:81}),false);
  await assert.rejects(reserveWebsite(dbWith(0),{...args,observedForeign:NaN}));
});
test('ambiguous email send is called once and marked uncertain',async()=>{
  let calls=0;const queries=[];const db={async query(sql){queries.push(sql);}};
  await assert.rejects(submitWebsite(db,async()=>{calls++;throw Error('Timeout');},'key',{}),/no automatic retry/);
  assert.equal(calls,1);assert(queries.some(s=>s.includes("status='uncertain'")));
});
test('active replies never age out; unanswered preview closes only after 30 days',()=>{
  assert.equal(retireDecision({lastSent:'2026-10-01',hasReply:true,now:new Date('2026-12-01')}),null);
  assert.equal(retireDecision({lastSent:'2026-10-01',hasReply:false,now:new Date('2026-10-20')}),null);
  assert.equal(retireDecision({lastSent:'2026-10-01',hasReply:false,now:new Date('2026-11-01')}),'closed_no_reply');
});
