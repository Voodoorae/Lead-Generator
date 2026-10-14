import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ensureOutreach,reserveAttempt} from './outreach-store.mjs';
export async function testCloudLedger() {
  const schema='prospecting_test_'+randomUUID().replace(/-/g,'');
  if (!/^prospecting_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Readiness schema name invalid');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),a=await pool.connect(),b=await pool.connect();
  let created=false;
  try {
    // All synthetic rows live in this uniquely named test schema. None go into
    // production attempts or contribute to campaign reports or email counts.
    await a.query('CREATE SCHEMA "'+schema+'"'); created=true;
    for(const db of [a,b]) await db.query('SET search_path TO "'+schema+'"');
    await ensureOutreach(a);
    const date='2000-01-03';
    await a.query(`INSERT INTO prospecting_send_attempts(attempt_key,run_date,status)
      SELECT 'synthetic-'||n,$1,'reserved' FROM generate_series(1,49) n`,[date]);
    const common={date,observed:0,externalReserve:50};
    const results=await Promise.all([reserveAttempt(a,{...common,key:'last-slot-a'}),reserveAttempt(b,{...common,key:'last-slot-b'})]);
    assert.equal(results.filter(Boolean).length,1);
    assert.equal((await a.query('SELECT count(*)::integer n FROM prospecting_send_attempts')).rows[0].n,50);
    assert.equal(await reserveAttempt(a,{...common,key:'fifty-first'}),false);
    const winner=results[0]?'last-slot-a':'last-slot-b';
    assert.equal(await reserveAttempt(a,{...common,key:winner}),false);
    await a.query('TRUNCATE prospecting_send_attempts');
    assert.equal(await reserveAttempt(a,{...common,key:'overall-100',observed:99}),true);
    assert.equal(await reserveAttempt(b,{...common,key:'overall-101',observed:99}),false);
    await a.query('TRUNCATE prospecting_send_attempts');
    for(let i=0;i<5;i++) assert.equal(await reserveAttempt(a,{...common,key:'batch-'+i,dailyLimit:5}),true);
    assert.equal(await reserveAttempt(b,{...common,key:'rerun-sixth',dailyLimit:5}),false);
    return {status:'cloud-ledger-tests-passed',concurrentLastSlot:true,replayBlocked:true,overallCeiling:true,dailyBatchRerunBlocked:true,synthetic:true,prospectEmailsSent:0};
  } finally {
    // The exact schema above was created by this invocation and checked before
    // cleanup. DROP has no access to existing application schemas.
    b.release();
    if(created) await a.query('DROP SCHEMA "'+schema+'" CASCADE').catch(()=>{});
    a.release();await pool.end();
  }
}
