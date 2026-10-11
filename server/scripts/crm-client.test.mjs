import test from 'node:test';
import assert from 'node:assert/strict';
import { crmClient, checkCrm } from './crm-client.mjs';
const locationId = 'testLocation';
const options = { token: 'test-secret', locationId };
const response = data => ({ ok: true, json: async () => data });
test('probe makes bounded reads, scopes location and never returns contact details', async () => {
  const seen = [];
  const result = await checkCrm({ ...options, fetchImpl: async (url, config) => {
    seen.push([url, config]);
    if (url.pathname.startsWith('/contacts/')) return response({ contact: { locationId, email: 'private@example.com' } });
    if (url.pathname === '/conversations/search') return response({ conversations: [] });
    return response({ messages: [{ locationId, body: 'private-body' }] });
  } });
  assert.equal(seen.length, 3);
  for (const [url, config] of seen) {
    assert.equal(url.origin, 'https://services.leadconnectorhq.com');
    assert.equal(url.searchParams.get('locationId'), locationId);
    assert.equal(config.method, 'GET');
    assert.equal(config.redirect, 'error');
  }
  assert.equal(seen[2][0].searchParams.get('limit'), '10');
  assert.equal(result.sent, 0);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('unapproved paths cannot send credentials', async () => {
  const read = crmClient({ ...options, fetchImpl: () => { throw new Error('must not fetch'); } });
  await assert.rejects(read('/conversations/messages'), /not allowed/);
  await assert.rejects(read('https://evil.example/'), /not allowed/);
});
test('API and network errors cannot leak bodies or credentials', async () => {
  await assert.rejects(crmClient({ ...options, fetchImpl: async () => ({
    ok: false, status: 401, text: () => 'test-secret'
  }) })('/conversations/search'), { message: 'CRM read HTTP 401' });
  await assert.rejects(crmClient({ ...options, fetchImpl: async () => {
    throw new Error('test-secret');
  } })('/conversations/search'), { message: 'CRM read network or timeout failure' });
});
test('wrong account fails before reading history', async () => {
  let calls = 0;
  await assert.rejects(checkCrm({ ...options, fetchImpl: async () => {
    calls++; return response({ contact: { locationId: 'wrong' } });
  } }), /location mismatch/);
  assert.equal(calls, 1);
});
test('malformed history fails instead of claiming working access', async () => {
  await assert.rejects(checkCrm({ ...options, fetchImpl: async url => {
    if (url.pathname.startsWith('/contacts/')) return response({ contact: { locationId } });
    if (url.pathname === '/conversations/search') return response({ conversations: [] });
    return response({ error: 'private-details' });
  } }), /history response invalid/);
});
