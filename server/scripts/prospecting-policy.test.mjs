import test from 'node:test';
import assert from 'node:assert/strict';
import { londonWindow, dailySearch, dailySearches, holdReason } from './prospecting-policy.mjs';
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
test('discovery covers six professions across three Scottish cities and retries afternoon windows',()=>{
  const searches=dailySearches('2026-10-19');
  assert.equal(searches.length,18);assert.equal(new Set(searches.map(s=>s.location)).size,3);
  assert.equal(new Set(searches.map(s=>s.niche)).size,6);
  assert(searches.every(s=>s.location.endsWith(', Scotland')));
  assert(londonWindow(new Date('2026-10-19T12:15:00Z')).due);
  assert(londonWindow(new Date('2026-10-19T14:45:00Z')).due);
  assert(!londonWindow(new Date('2026-10-18T12:15:00Z')).due);
});
test('saved queue runs through weekday business hours and excludes evenings and weekends',()=>{
  assert(londonWindow(new Date('2026-10-14T09:15:00Z')).outreachDue);
  assert(londonWindow(new Date('2026-10-14T15:45:00Z')).outreachDue);
  assert(!londonWindow(new Date('2026-10-14T16:00:00Z')).outreachDue);
  assert(!londonWindow(new Date('2026-10-14T08:45:00Z')).outreachDue);
  assert(!londonWindow(new Date('2026-10-17T12:00:00Z')).outreachDue);
  assert(londonWindow(new Date('2026-10-26T16:45:00Z')).outreachDue);
});
test('scores and email alone cannot release a candidate', () => {
  assert.match(holdReason({domain:'example.com',website:'https://example.com',status:'scored',email:'info@example.com'}), /awaiting/);
  assert.equal(holdReason({domain:'example.com',website:'https://example.com',status:'unreadable'}), 'unreadable-site');
});

