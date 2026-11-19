import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSuppressionSnapshot,identityKeys,rootDomain,invalidAddress,isOptOut,installBusinessGuard,syncBusinessSuppression} from './business-suppression.mjs';
import {apiClient} from './outreach-api.mjs';
const info={id:'info',locationId:'L',email:'info@mwclubb.co.uk',website:'https://www.mwclubb.co.uk/'};
const elias={id:'elias',locationId:'L',email:'elias@mwclubb.co.uk'};
const reply={id:'reply',locationId:'L',contactId:'elias',direction:'inbound',from:'Elias <elias@mwclubb.co.uk>',body:'no thanks'};
test('colleague refusal suppresses original inbox, plus alias and future imports',()=>{
  const s=buildSuppressionSnapshot([info,elias],[reply]);
  assert.equal(s.holds.get('email:info@mwclubb.co.uk').reason,'opted-out');
  const later=buildSuppressionSnapshot([{id:'new',email:'info+noreply@mwclubb.co.uk'}],[],[...s.holds.values()]);
  assert.equal(later.holds.get('email:info+noreply@mwclubb.co.uk').reason,'opted-out');
});
test('unrecorded colleague sender and nested inbound direction still hold the business',()=>{
  const s=buildSuppressionSnapshot([info],[{...reply,contactId:'unrecorded',direction:undefined,meta:{email:{direction:'inbound'}},body:'Can you explain?'}]);
  assert.equal(s.holds.get('email:info@mwclubb.co.uk').reason,'reply-review');
});
test('OOO and positive replies hold outreach without being recorded as opt-outs',()=>{
  for(const body of ['Out of office','Yes please'])assert.equal(buildSuppressionSnapshot([info,elias],[{...reply,body}]).holds.get('domain:mwclubb.co.uk').reason,'reply-review');
});
test('quoted opt-out footer is not mistaken for the current answer',()=>{
  assert.equal(isOptOut('Thank you<blockquote>reply no thanks</blockquote>'),false);
  assert.equal(isOptOut('No thank you\nOn Monday wrote:\nWould you like this?'),true);
  assert.equal(isOptOut('Do not reply to info@ or elias@ again!'),true);
  assert.equal(isOptOut('Thanks<div>From: Sender</div><p>You may unsubscribe</p>'),false);
  assert.equal(isOptOut('Thanks. You can unsubscribe from our mailing list here.'),false);
  assert.equal(isOptOut('If this is an emergency, please do not email me.'),false);
  assert.equal(isOptOut('Please unsubscribe me.'),true);
  assert.equal(isOptOut('Unsubscribe'),true);
});
test('public suffixes, case, www, subdomains and hosted sites are handled',()=>{
  assert.equal(rootDomain('https://WWW.Office.Firm.CO.UK/path'),'firm.co.uk');
  assert.notEqual(rootDomain('alice.github.io'),rootDomain('bob.github.io'));
  assert(identityKeys({email:'John@MAIL.Firm.CO.UK'}).includes('domain:firm.co.uk'));
});
test('shared email providers and parent networks never merge different businesses',()=>{
  for(const domain of ['gmail.com','protonmail.com','sjpp.co.uk','clydemunrodental.com']){
    const s=buildSuppressionSnapshot([{id:'a',email:'a@'+domain},{id:'b',email:'b@'+domain}],[{...reply,contactId:'a',from:'a@'+domain}]);
    assert(!s.holds.has('email:b@'+domain));assert(!identityKeys({email:'a@'+domain,website:domain}).includes('domain:'+domain));
  }
});
test('domain aliases on a contact propagate suppression, but a data hold is mailbox-only',()=>{
  const alias={id:'a',email:'info@oldfirm.co.uk',website:'https://newfirm.co.uk'};
  const s=buildSuppressionSnapshot([alias,{id:'b',email:'john@newfirm.co.uk'}],[{...reply,contactId:'a',from:alias.email}]);
  assert(s.holds.has('email:john@newfirm.co.uk'));
  const held=buildSuppressionSnapshot([{...info,dndSettings:{email:{status:'active',code:'DATA_QUALITY_HOLD'}}},elias],[]);
  assert(!held.holds.has('email:elias@mwclubb.co.uk'));assert(!held.holds.has('domain:mwclubb.co.uk'));
});
test('missing sender identity and malformed directions stop processing',()=>{
  assert.throws(()=>buildSuppressionSnapshot([], [{direction:'inbound',id:'x'}]),/identity/);
  assert.throws(()=>buildSuppressionSnapshot([], [{direction:'unknown'}]),/direction/);
});

test('an existing data hold cannot hide a business reply across domain aliases',()=>{
  const contacts=[{id:'a',email:'info@oldfirm.co.uk',website:'newfirm.co.uk',tags:['outreach-suppressed-duplicate']},{id:'b',email:'john@newfirm.co.uk'}];
  const prior=[{identity_key:'domain:oldfirm.co.uk',reason:'reply-review',evidence:'prior-reply'}];
  const s=buildSuppressionSnapshot(contacts,[],prior);
  assert.equal(s.holds.get('email:john@newfirm.co.uk').reason,'reply-review');
  assert.equal(s.holds.get('email:info@oldfirm.co.uk').reason,'reply-review');
});
test('invalid scraped filenames and example addresses cannot be emailed',()=>{
  for(const e of ['group-66@2x.png.avif','mask%20group%2031@2x.webp','john@example.com','wrong'])assert(invalidAddress(e));
  assert(!invalidAddress('info@mwclubb.co.uk'));
});
test('central send API refuses paused, unguarded and failed-check messages without a POST',async()=>{
  let sent=0;
  const fetchImpl=async()=>{sent++;return {ok:true,json:async()=>({})};};
  const paused=apiClient({token:'test',locationId:'L',fetchImpl,sendEnabled:()=>false});
  await assert.rejects(paused('POST','/conversations/messages',{body:{contactId:'info'}}),/pause/);
  const active=apiClient({token:'test',locationId:'L',fetchImpl,sendEnabled:()=>true});
  await assert.rejects(active('POST','/conversations/messages',{body:{contactId:'info'}}),/guard missing/);
  active.setEmailGuard(async()=>{throw Error('history incomplete');});
  await assert.rejects(active('POST','/conversations/messages',{body:{contactId:'info'}}),/history incomplete/);
  assert.equal(sent,0);
});
function fixture({messages=[reply],contacts=[info,elias],incomplete=false}={}) {
  const state={holds:[],updates:[],sends:0,stopped:0};
  const db={async query(sql,params){
    if(sql==='SELECT identity_key,reason,evidence FROM outreach_business_suppression')return {rows:state.holds};
    if(sql.startsWith('INSERT INTO outreach_business_suppression(')){state.holds.push({identity_key:params[0],reason:params[1],evidence:params[2]});}
    if(sql.startsWith('SELECT id,domain,email,contact_id FROM prospecting_sequences'))return {rows:[{id:'sequence',contact_id:'info',domain:'mwclubb.co.uk',email:info.email}]};
    if(sql.startsWith('SELECT id,domain,email,contact_id FROM website_prospects'))return {rows:[]};
    if(sql.startsWith('UPDATE prospecting_sequences'))state.stopped++;
    return {rows:[],rowCount:1};
  }};
  const api=apiClient({token:'test',locationId:'L',sendEnabled:()=>true,fetchImpl:async(url,options)=>{
    let data;
    if(url.pathname==='/contacts/search')data={contacts,total:contacts.length};
    else if(url.pathname==='/conversations/messages/export')data={messages,total:messages.length+(incomplete?1:0)};
    else if(options.method==='PUT'){const id=url.pathname.split('/').at(-1);state.updates.push(id);data={contact:{...contacts.find(c=>c.id===id),...JSON.parse(options.body)}};}
    else if(options.method==='GET'&&url.pathname.startsWith('/contacts/'))data={contact:contacts.find(c=>c.id===url.pathname.split('/').at(-1))};
    else if(url.pathname==='/conversations/messages'){state.sends++;data={messageId:'sent'};}
    else throw Error('Unexpected mocked operation '+url.pathname);
    return {ok:true,json:async()=>data};
  }});
  return {api,db,state};
}
test('actual central send path stops colleague opt-out and saves holds',async()=>{
  const old=process.env.GHL_LOCATION_ID;process.env.GHL_LOCATION_ID='L';
  try{const f=fixture();installBusinessGuard(f.api,f.db);
    await assert.rejects(f.api('POST','/conversations/messages',{body:{contactId:'info'}}),/suppressed/);
    assert.equal(f.state.sends,0);assert.deepEqual(f.state.updates,[]);assert.equal(f.state.stopped,1);
  }finally{if(old===undefined)delete process.env.GHL_LOCATION_ID;else process.env.GHL_LOCATION_ID=old;}
});
test('incomplete account history cannot produce an email or partial suppression changes',async()=>{
  const f=fixture({incomplete:true});await assert.rejects(syncBusinessSuppression(f.db,f.api,{locationId:'L'}),/incomplete/);
  assert.equal(f.state.sends,0);assert.equal(f.state.holds.length,0);
});
test('an unrelated valid recipient passes a complete check',async()=>{
  const old=process.env.GHL_LOCATION_ID;process.env.GHL_LOCATION_ID='L';
  try{const f=fixture({contacts:[{id:'good',email:'info@unrelated.co.uk',locationId:'L'}],messages:[]});installBusinessGuard(f.api,f.db);
    await f.api('POST','/conversations/messages',{body:{contactId:'good'}});assert.equal(f.state.sends,1);
  }finally{if(old===undefined)delete process.env.GHL_LOCATION_ID;else process.env.GHL_LOCATION_ID=old;}
});
