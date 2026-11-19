import test from 'node:test';
import assert from 'node:assert/strict';
import {runProspectingStages} from './prospecting-stages.mjs';

test('saved outreach runs before discovery, including a 502 failure',async()=>{
  const calls=[];
  await assert.rejects(runProspectingStages({outreach:async()=>calls.push('saved-queue'),collect:async()=>{calls.push('discovery');throw Error('HTTP 502');}}),AggregateError);
  assert.deepEqual(calls,['saved-queue','discovery']);
});
test('failed sending does not prevent research; both failures stay visible',async()=>{
  const calls=[];
  await assert.rejects(runProspectingStages({outreach:async()=>{calls.push('outreach');throw Error('CRM unavailable');},collect:async()=>{calls.push('research');throw Error('HTTP 502');}}),error=>error.errors.length===2);
  assert.deepEqual(calls,['outreach','research']);
});
