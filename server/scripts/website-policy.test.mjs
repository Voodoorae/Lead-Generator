import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteWindow,websiteSearches,websiteFindings,recipientHold,composeWebsite,retireDecision,websiteSenderVerified,websiteSectorAllowed,advertisedService} from './website-policy.mjs';
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
const candidate={company:'Synthetic Co',website:'https://example.invalid',domain:'example.invalid',email:'info@example.invalid',emailSourceUrl:'https://example.invalid/contact',sector:'commercial electricians',corporate:{verified:true},evidence:{findings:['An observed test finding.'],desktop:true,mobile:true,sourceUrl:'https://example.invalid',checkedAt:'2026-10-13T09:00:00Z'}};
test('accountant exception cannot become permission on another date or for new accountants',()=>{
  assert(websiteSectorAllowed('accountants-existing-build-exception','2026-10-12'));
  assert(!websiteSectorAllowed('accountants-existing-build-exception','2026-10-13'));
  assert(!websiteSectorAllowed('accountants','2026-10-12'));
  assert(websiteSectorAllowed('surveyors','2026-10-13'));
});
test('a clicked internal proof remains valid only with the actual Proxaim sender',()=>{
  assert(websiteSenderVerified({status:'clicked',emailFrom:'Rae @ Proxaim <hello@proxaim.com>'}));
  assert(!websiteSenderVerified({status:'accepted',emailFrom:'Rae @ Proxaim <hello@proxaim.com>'}));
  assert(!websiteSenderVerified({status:'delivered',emailFrom:'Steven Nisbet <hello@proxaim.com>'}));
  assert(!websiteSenderVerified({status:'clicked',emailFrom:'Other <other@example.invalid>'}));
  assert(!websiteSenderVerified({status:'delivered',emailFrom:'Proxaim <hello@proxaim.com>'}));
});
test('one observed issue qualifies; administrative clinical intro makes no credential claim',()=>{
  assert.equal(recipientHold(candidate),null);
  assert.equal(recipientHold({...candidate,sector:'private dentists'}),null);
  assert(!composeWebsite(candidate).message.includes("I've put together"));
  const copy=composeWebsite({...candidate,previewVerified:true});
  assert(copy.message.includes("I've put together"));assert(!copy.message.includes('\u2014'));assert(copy.message.includes('hello@proxaim.com'));
});
test('verified advertised service qualifies without defects, screenshots or a preview',()=>{
  const evidence={...candidate.evidence,findings:[],desktop:false,mobile:false,offerService:'heat pumps',serviceSourceUrl:candidate.evidence.sourceUrl,serviceExcerpt:'We install heat pumps across Scotland.'};
  const prospect={...candidate,sector:'heating installers',evidence};
  assert.equal(recipientHold(prospect),null);
  const copy=composeWebsite(prospect);
  assert(copy.message.includes('advertises heat pumps'));
  assert(!copy.message.includes('I noticed'));
  assert(!copy.message.includes("I've put together"));
  assert.equal(recipientHold({...prospect,evidence:{...evidence,serviceExcerpt:'Welcome'}}),'current-service-or-issue-evidence-required');
  assert.equal(recipientHold({...prospect,corporate:{verified:false}}),'active-company-and-trading-identity-unverified');
  assert.equal(recipientHold({...prospect,emailSourceUrl:null}),'published-email-unverified');
  assert.equal(recipientHold({...prospect,email:'info@elsewhere.invalid'}),'business-domain-email-unverified');
  assert.equal(advertisedService('private dentists','Dental implants available.'),'Dental implants');
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
