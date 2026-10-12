import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyReply,salesDraft,recordReply,submitAlert,interestAcknowledgement,submitAcknowledgement,notificationTest} from './website-sales.mjs';
test('interest classification excludes negatives, automated replies and quoted interest',()=>{
  assert.equal(classifyReply('Yes please, send me the details'),'positive');
  assert.equal(classifyReply('How much would it cost?'),'positive');
  assert.equal(classifyReply('Not interested, thanks'),'declined');
  assert.equal(classifyReply('No thanks, remove us'),'opted_out');
  assert.equal(classifyReply('Out of office. Please send enquiries to reception'),'automatic');
  assert.equal(classifyReply('Thanks\nOn Monday wrote:\nYes please'),'review');
  assert.equal(classifyReply('Thanks<blockquote>Yes please</blockquote>'),'review');
  assert.equal(classifyReply('Interested but not this year'),'review');
  assert.equal(classifyReply(undefined),'review');
});
test('drafts claim a preview only after verification and never invent commercial terms',()=>{
  const draft=salesDraft('Example Business');
  assert(draft.message.includes('prepare a concept'));assert(!/guarantee|free|\u2014|£/.test(draft.message));
  assert(salesDraft('Example Business',{previewVerified:true}).message.includes('ready to review'));
});
test('old or wrongly scoped replies cannot generate alerts; duplicate reply is a no-op',async()=>{
  const row={id:'website-test',contact_id:'contact-test',last_sent:'2026-10-12T08:00:00Z',qualification:{company:'Example Business'}};
  const db={async query(sql){return sql.startsWith('INSERT INTO website_reply_events')?{rowCount:0}:{rowCount:1};}};
  const reply={id:'reply-test',contactId:row.contact_id,direction:'inbound',body:'Yes please',dateAdded:'2026-10-12T08:10:00Z'};
  assert.equal(await recordReply(db,row,{...reply,dateAdded:'2026-10-11'},'2026-10-12'),false);
  assert.equal(await recordReply(db,row,reply,'2026-10-12'),false);
  await assert.rejects(recordReply(db,row,{...reply,contactId:'wrong'},'2026-10-12'),/identity mismatch/);
});
test('notification timeout is uncertain and cannot trigger an automatic resend',async()=>{
  let calls=0;const queries=[];
  await assert.rejects(submitAlert({async query(sql){queries.push(sql);}},async()=>{calls++;throw Error('timeout');},{id:'alert-test'},{}),/no automatic retry/);
  assert.equal(calls,1);assert(queries.some(sql=>sql.includes("status='uncertain'")));
});
test('a positive reply records the event, draft and single alert in one transaction',async()=>{
  const calls=[];const db={async query(sql,params){calls.push({sql,params});return {rowCount:1};}};
  const row={id:'website-test',contact_id:'contact-test',last_sent:'2026-10-12T08:00:00Z',qualification:{company:'Example Business'}};
  assert.equal(await recordReply(db,row,{id:'reply-test',contactId:row.contact_id,direction:'inbound',body:'Yes please',dateAdded:'2026-10-12T08:15:00Z'},'2026-10-12'),true);
  assert.equal(calls.filter(c=>c.sql.startsWith('INSERT INTO website_alerts')).length,1);
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert(calls.find(c=>c.sql.startsWith('INSERT INTO website_sales')).params[3].includes('prepare a concept'));
});
test('automatic acknowledgement invites a reply without quoting, claiming a booking or preview',()=>{
  const copy=interestAcknowledgement();
  assert(copy.message.includes('reply with a suitable time'));
  assert(!/£|guarantee|booked|preview|\u2014/.test(copy.message));
});
test('ambiguous acknowledgement is never automatically retried',async()=>{
  let calls=0;const queries=[];
  await assert.rejects(submitAcknowledgement({async query(sql){queries.push(sql);}},async()=>{calls++;throw Error('timeout');},'website-test',{}),/no automatic retry/);
  assert.equal(calls,1);assert(queries.some(sql=>sql.includes("status='uncertain'")));
});
test('dated internal probe sends only once and reconciles the actual provider record',async(t)=>{
  const config={WEBSITE_NOTIFICATION_TEST_DATE:'2026-10-12',WEBSITE_ALERT_CONTACT_ID:'test-contact',WEBSITE_ALERT_EMAIL:'owner@example.invalid',WEBSITE_SENDER_TEST_ID:'proof',WEBSITE_SENDER_TEST_CONTACT_ID:'test-contact',GHL_LOCATION_ID:'test-location'};
  const prior=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);
  t.after(()=>{for(const [k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  let record,sends=0;
  const db={async query(sql,p){if(sql==='SELECT value FROM website_controls WHERE key=$1')return{rows:record?[{value:record}]:[]};if(sql.includes('AS n'))return{rows:[{n:0}]};if(sql.startsWith('INSERT INTO website_controls')||sql.startsWith('UPDATE website_controls'))record=JSON.parse(p[1]);return{rowCount:1};}};
  const api=async(method,path,{body}={})=>{
    if(path.startsWith('/contacts/'))return{contact:{id:'test-contact',locationId:'test-location',email:config.WEBSITE_ALERT_EMAIL}};
    if(path.endsWith('/export'))return{messages:[],total:0};
    if(method==='POST'){sends++;assert(body.html.includes('No prospect has replied'));return{emailMessageId:'test-provider-id'};}
    return{emailMessage:{contactId:'test-contact',locationId:'test-location',direction:'outbound',status:'delivered',from:'Steven Nisbet <hello@proxaim.com>'}};
  };
  assert.equal((await notificationTest(db,api,'2026-10-12')).observedStatus,'delivered');
  await notificationTest(db,api,'2026-10-12');assert.equal(sends,1);
  assert.equal(await notificationTest(db,api,'2026-10-13'),null);
});
