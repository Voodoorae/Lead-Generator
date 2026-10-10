import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay, postLeadJson } from './lead-api.mjs';

test('429 waits for Retry-After then succeeds, without a real delay', async () => {
  let calls = 0;
  const waits = [];
  const result = await postLeadJson('https://example.com/api/leads', {}, {
    fetchImpl: async () => ++calls === 1
      ? new Response('', {status:429,headers:{'Retry-After':'40'}})
      : Response.json({leads:[]}),
    sleep: async ms => waits.push(ms), log: () => {},
  });
  assert.equal(calls,2);
  assert.deepEqual(waits,[40000]);
  assert.deepEqual(result,{leads:[]});
});
test('persistent throttling stops after five attempts', async () => {
  let calls = 0;
  const waits = [];
  await assert.rejects(postLeadJson('https://example.com/api/leads', {}, {
    fetchImpl: async () => { calls++; return new Response('',{status:429}); },
    sleep: async ms => waits.push(ms), log: () => {},
  }), /HTTP 429.*5 attempt/);
  assert.equal(calls,5);
  assert.deepEqual(waits,[30000,60000,120000,240000]);
});
test('ordinary failures do not retry', async () => {
  let calls = 0;
  await assert.rejects(postLeadJson('https://example.com/api/leads', {}, {
    fetchImpl: async () => { calls++; return new Response('',{status:401}); },
    sleep: async () => assert.fail('Must not wait'),
  }), /HTTP 401/);
  assert.equal(calls,1);
});
test('service temporarily unavailable may retry', async () => {
  let calls = 0;
  assert.deepEqual(await postLeadJson('https://example.com/api/leads', {}, {
    fetchImpl: async () => ++calls === 1 ? new Response('',{status:503}) : Response.json({ok:true}),
    sleep: async () => {}, log: () => {},
  }), {ok:true});
});
test('retry dates are respected and excessive waits stop', () => {
  const now = Date.parse('2026-10-10T13:00:00Z');
  assert.equal(retryDelay('Sat, 10 Oct 2026 13:01:00 GMT',0,now),60000);
  assert.throws(() => retryDelay('3600',0,now), /over five minutes/);
  assert.equal(retryDelay('invalid',0,now),30000);
});

