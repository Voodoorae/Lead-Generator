import test from 'node:test';
import assert from 'node:assert/strict';
import { londonWindow, dailySearch, holdReason } from './prospecting-policy.mjs';
test('10am London remains correct across the October clock change', () => {
  assert.equal(londonWindow(new Date('2026-10-12T09:00:00Z')).due, true);
  assert.equal(londonWindow(new Date('2026-10-12T10:00:00Z')).due, false);
  assert.equal(londonWindow(new Date('2026-10-26T10:00:00Z')).due, true);
  assert.equal(londonWindow(new Date('2026-10-26T09:00:00Z')).due, false);
  assert.equal(londonWindow(new Date('2026-10-10T09:00:00Z')).due, false);
});
test('rotation stays in Scotland and spans niches', () => {
  const searches = Array.from({length: 42}, (_,i) => dailySearch(new Date(Date.UTC(2026,9,12+i)).toISOString().slice(0,10)));
  assert.equal(new Set(searches.map(x => x.niche)).size, 6);
  assert.equal(new Set(searches.map(x => x.location)).size, 7);
  assert.ok(searches.every(x => x.location.endsWith(', Scotland')));
});
test('scores and email alone cannot release a candidate', () => {
  assert.match(holdReason({domain:'example.com',website:'https://example.com',status:'scored',email:'info@example.com'}), /awaiting/);
  assert.equal(holdReason({domain:'example.com',website:'https://example.com',status:'unreadable'}), 'unreadable-site');
});

