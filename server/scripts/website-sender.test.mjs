import test from 'node:test';
import assert from 'node:assert/strict';
import {proxaimEmailDetail} from './outreach-api.mjs';
const message={id:'test-message',contactId:'test-contact',direction:'outbound'};
test('incomplete sender headers are rechecked with reads only',async()=>{
  let calls=0;
  const actual=await proxaimEmailDetail(async(method)=>{assert.equal(method,'GET');calls++;return {emailMessage:{locationId:'test-location',contactId:message.contactId,direction:'outbound',status:'pending',from:calls<3?'hello@proxaim.com':'Rae @ Proxaim <hello@proxaim.com>'}};},message,'test-location',{sleep:async()=>{}});
  assert.equal(calls,3);assert.equal(actual.emailFrom,'Rae @ Proxaim <hello@proxaim.com>');
});
test('a persistently wrong sender is blocked after four reads',async()=>{
  let calls=0;
  await assert.rejects(proxaimEmailDetail(async()=>{calls++;return {emailMessage:{locationId:'test-location',contactId:message.contactId,direction:'outbound',status:'delivered',from:'Other <other@example.invalid>'}};},message,'test-location',{sleep:async()=>{}}),/could not be confirmed/);
  assert.equal(calls,4);
});
