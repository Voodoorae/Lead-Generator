import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicate,suppressionReason,verifiedEmail,remainingCapacity,outboundCount,addWeekdays,sendHold,compose,campaignLimit,isReadinessReply} from './outreach-policy.mjs';
import {apiClient,allContacts,emailHistory,emailDetail} from './outreach-api.mjs';
import {homepageObservation,registeredNumber,publicAddress,qualifyWebsite} from './website-evidence.mjs';
import {submitOnce} from './outreach-store.mjs';
test('duplicate company with no email and same domain with another mailbox both block',()=>{
  const c={company:'Example Limited',website:'https://www.example.com',email:'info@example.com'};
  assert.equal(duplicate(c,[{companyName:'Example Ltd',email:null}]),true);
  assert.equal(duplicate(c,[{email:'other@example.com'}]),true);
  assert.equal(duplicate(c,[{email:'info@example.com'}]),true);
  assert.equal(duplicate(c,[{companyName:'Unrelated Ltd',email:'info@unrelated.com'}]),false);
});
test('suppression, replies and bounces stop all follow-ups',()=>{
  assert.equal(suppressionReason({dnd:true}),'do-not-contact');
  assert.equal(suppressionReason({dndSettings:{email:{status:'active'}}}),'do-not-contact');
  assert.equal(suppressionReason({tags:['opt-out']}),'suppression-tag');
  assert.equal(suppressionReason({},[{direction:'inbound',body:'Interested'}]),'reply-received');
  assert.equal(suppressionReason({},[{direction:'outbound',status:'failed'}]),'delivery-failure');
  assert.equal(suppressionReason({},[{direction:'outbound',status:'delivered'}]),null);
});
test('only the exact deliverable low-risk email is accepted',()=>{
  const good={result:'deliverable',risk:'low',address:'info@example.com'};
  assert.equal(verifiedEmail(good,'INFO@example.com'),true);
  for(const change of [{result:'catch_all'},{risk:'medium'},{address:'someone@example.com'},{leadConnectorRecommendation:{isEmailValid:false}}]) assert.equal(verifiedEmail({...good,...change},good.address),false);
});
test('new 50 and overall 100 ceilings both hold',()=>{
  assert.equal(remainingCapacity({observed:0,reserved:49}),1);
  assert.equal(remainingCapacity({observed:0,reserved:50}),0);
  assert.equal(remainingCapacity({observed:99,reserved:0}),1);
  assert.equal(remainingCapacity({observed:100,reserved:0}),0);
  assert.equal(remainingCapacity({observed:50,reserved:49}),1);
  assert.throws(()=>remainingCapacity({observed:NaN,reserved:0}));
});
test('live batches grow only with measured delivery and stop on early failures',()=>{
  assert.equal(campaignLimit({configured:50}),5);
  assert.equal(campaignLimit({configured:50,delivered:20}),10);
  assert.equal(campaignLimit({configured:50,delivered:50}),25);
  assert.equal(campaignLimit({configured:50,delivered:100}),50);
  assert.throws(()=>campaignLimit({configured:50,delivered:4,failed:1}),/delivery review/);
  assert.throws(()=>campaignLimit({configured:50,delivered:96,failed:4}),/delivery review/);
});
test('outbound failed attempts count, inbound does not, GMT/BST dates are correct',()=>{
  const m={id:'1',direction:'outbound',status:'failed',dateAdded:'2026-10-11T00:00:00+01:00'};
  assert.equal(outboundCount([m,{...m,id:'2',direction:'inbound'}],'2026-10-11'),1);
  assert.equal(outboundCount([m],'2026-10-10'),0);
  assert.equal(outboundCount([{...m,dateAdded:'2026-10-26T00:01:00Z'}],'2026-10-26'),1);
  assert.throws(()=>outboundCount([{...m,dateAdded:null}],'2026-10-11'));
});
test('follow-up waits count weekdays across the clock change',()=>{
  assert.equal(addWeekdays('2026-10-23',3),'2026-10-28');
  assert.equal(addWeekdays('2026-10-12',3),'2026-10-15');
});
test('HTTP or ambiguous send is never retried',async()=>{
  let calls=0;const queries=[];
  await assert.rejects(submitOnce({query:async(...args)=>queries.push(args)},async()=>{calls++;throw new Error('secret');},'test-key',{}),/reconciliation/);
  assert.equal(calls,1);assert.match(queries[0][0],/unknown/);
});
test('API client scopes location, rejects redirects and never leaks errors',async()=>{
  let seen;
  const api=apiClient({token:'private',locationId:'allowed',fetchImpl:async(url,options)=>{seen={url,options};return {ok:true,json:async()=>({})};}});
  await api('POST','/contacts/search',{body:{locationId:'wrong',pageLimit:1}});
  assert.equal(JSON.parse(seen.options.body).locationId,'allowed');
  assert.equal(seen.url.origin,'https://services.leadconnectorhq.com');
  assert.equal(seen.options.redirect,'error');
  await api('POST','/email/verify',{body:{type:'email',verify:'info@example.com'},version:'v3'});
  assert.deepEqual(JSON.parse(seen.options.body),{type:'email',verify:'info@example.com'});
  assert.equal(seen.url.searchParams.get('locationId'),'allowed');
  await assert.rejects(api('POST','https://evil.example'),/not allowed/);
  const fail=apiClient({token:'private',locationId:'allowed',fetchImpl:async()=>{throw new Error('private');}});
  await assert.rejects(fail('POST','/contacts/'),{message:'CRM request network or timeout failure'});
});
test('CRM pagination uses last contact cursor and refuses incomplete lists',async()=>{
  let calls=0;
  const contacts=await allContacts(async(_method,_path,{body})=>{
    calls++;if(calls===1)return {total:2,contacts:[{id:'1',searchAfter:['cursor']}]};
    assert.deepEqual(body.searchAfter,['cursor']);return {total:2,contacts:[{id:'2'}]};
  });assert.equal(contacts.length,2);
  await assert.rejects(allContacts(async()=>({total:2,contacts:[{id:'1'}]})),/incomplete/);
  await assert.rejects(emailHistory(async()=>({messages:[{id:'1'}],total:2})),/incomplete/);
});
test('email details override stale summary status and reject the wrong account',async()=>{
  const summary={id:'testMessage',contactId:'testContact',direction:'outbound',status:'sent'};
  const api=async()=>({emailMessage:{...summary,locationId:'testLocation',status:'delivered',from:'Sender'}});
  assert.equal((await emailDetail(api,summary,'testLocation')).status,'delivered');
  await assert.rejects(emailDetail(api,summary,'wrong'),/mismatch/);
});
test('read-only throttling retries, sends and paid verification do not',async()=>{
  let calls=0;let waited=0;
  const fetchImpl=async()=>++calls===1?{ok:false,status:429,headers:{get:()=> '1'}}:{ok:true,json:async()=>({})};
  const api=apiClient({token:'private',locationId:'test',fetchImpl,sleep:async ms=>{waited=ms;}});
  await api('GET','/contacts/test');assert.equal(calls,2);assert.equal(waited,1000);
  calls=0;await assert.rejects(api('POST','/conversations/messages',{body:{}}),/HTTP 429/);assert.equal(calls,1);
  calls=0;await assert.rejects(api('POST','/email/verify',{body:{}}),/HTTP 429/);assert.equal(calls,1);
});
test('private, loopback, metadata and mapped addresses are blocked',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('description finding is bounded to complete HTML and excludes comments and script content',()=>{
  assert.equal(homepageObservation('<html>truncated'),null);
  assert.equal(homepageObservation('<meta content="Useful description" name="description"><meta property="og:image" content="https://example.com/image.png"></body>'),null);
  assert.ok(homepageObservation('<body><!-- <meta name="description" content="fake"> --></body>'));
  assert.ok(homepageObservation('<body><script>"<meta name=description content=fake>"</script></body>'));
  assert.equal(registeredNumber('<p>Charity number SC123456</p>'),null);
  assert.equal(registeredNumber('<p>Company number SC123456</p>'),'SC123456');
});
test('corporate, published email and active registry must all match',async()=>{
  const html='<html><body>Example Limited. Company number SC123456. Contact info@example.com.</body></html>';
  const registry='<title>EXAMPLE LIMITED overview - Find and update company information</title><body>Company number SC123456 Company status Active</body>';
  const read=async url=>({url,html:url.includes('service.gov.uk')?registry:html});
  const result=await qualifyWebsite({website:'https://example.com',email:'info@example.com',address:'Stirling FK8 2AA'},'Example Ltd',{read});
  assert.equal(result.candidate.corporate.verified,true);
  assert.equal(result.candidate.route,'visibility');
  assert.equal((await qualifyWebsite({website:'https://example.com',email:'person@example.com',address:'Stirling'},'Example',{read})).candidate.email,'info@example.com');
  const wrong=async url=>({url,html:url.includes('service.gov.uk')?registry.replace('EXAMPLE LIMITED','UNRELATED LIMITED'):html});
  assert.equal((await qualifyWebsite({website:'https://example.com',email:'info@example.com',address:'Stirling FK8 2AA'},'Example',{read:wrong})).hold,'registered-company-website-match-unverified');
  assert.equal((await qualifyWebsite({website:'https://example.com',email:'info@example.com',address:'London'},'Example',{read})).hold,'scottish-business-address-unverified');
});
test('missing OG image and CSP use actual HTML and observed headers only',()=>{
  const html='<meta name="description" content="Useful description"><meta property="og:image" content="https://example.com/image.png"></body>';
  assert.equal(homepageObservation(html),null);
  assert.equal(homepageObservation(html,{csp:null}).route,'security');
  assert.equal(homepageObservation(html,{csp:"default-src 'self'"}),null);
  assert.equal(homepageObservation(html.replace(/<meta property="og:image"[^>]*>/,''),{csp:null}).route,'visibility');
});
test('valid unquoted metadata and image URL aliases cannot become false missing-tag claims',()=>{
  const html='<meta name=description content="Useful > description"><meta property=og:image:url content=https://example.com/image.png><meta http-equiv=content-security-policy content="default-src self"></body>';
  assert.equal(homepageObservation(html,{csp:null}),null);
});
test('copy cannot turn scanner scores into vulnerability or AI claims',()=>{
  const c={company:'Example <script>\r\nInjection',domain:'example.com',route:'visibility',evidence:{observation:'A checked detail',sourceUrl:'https://example.com/checked-page'}};
  const copy=compose(c);assert.ok(!copy.subject.includes('\n'));assert.ok(!copy.html.includes('<script>'));
  assert.ok(copy.message.includes('reply “no thanks”'));assert.ok(!/AI invisible|vulnerable|GDPR exposure/.test(copy.message));
  assert.throws(()=>compose({...c,route:'eu-ai-act'}),/reviewed copy/);
});
test('quoted test instructions cannot masquerade as a human readiness reply',()=>{
  assert.equal(isReadinessReply('<p>Ready cloud-internal-test-v1</p>'),true);
  assert.equal(isReadinessReply('No thanks\n<blockquote>Ready cloud-internal-test-v1</blockquote>'),false);
  assert.equal(isReadinessReply('Out of office\nOn Sunday someone wrote: Ready cloud-internal-test-v1'),false);
});
test('missing or stale qualification cannot pass a send gate',()=>{
  assert.equal(sendHold({}),'corporate-status-unverified');
  const c={corporate:{verified:true,sourceUrl:'https://registry.example'},emailPublished:true,emailSourceUrl:'https://example.com',email:'info@example.com',
    evidence:{sourceUrl:'https://example.com',observation:'Checked detail',checkedAt:'2026-10-01T00:00:00Z'},validation:{result:'deliverable',risk:'low',address:'info@example.com'}};
  assert.equal(sendHold(c,new Date('2026-10-11T00:00:00Z')),'stale-evidence');
});
