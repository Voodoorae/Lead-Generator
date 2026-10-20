import { sharedCapacity } from './shared-budget.mjs';
export async function ensureOutreach(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS prospecting_sequences (
    id TEXT PRIMARY KEY, domain TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, company_key TEXT NOT NULL UNIQUE,
    qualification JSONB NOT NULL, contact_id TEXT, stage INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'qualified', next_date DATE, stopped_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  ); CREATE TABLE IF NOT EXISTS prospecting_send_attempts (
    attempt_key TEXT PRIMARY KEY, sequence_id TEXT, run_date DATE NOT NULL,
    status TEXT NOT NULL, message_id TEXT, email_message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  ); CREATE TABLE IF NOT EXISTS prospecting_readiness (
    test_key TEXT PRIMARY KEY, status TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  ); CREATE TABLE IF NOT EXISTS prospecting_qualifications (
    place_id TEXT PRIMARY KEY, status TEXT NOT NULL, reason TEXT, result JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}
export async function reserveAttempt(db, {key,sequenceId,date,history,dailyLimit=100}) {
  // Every integrated writer takes this lock and counts both ledgers.
  // Other CRM emails consume allowance through the refreshed account history.
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock($1)', [7101050]);
    const existing = await db.query('SELECT status FROM prospecting_send_attempts WHERE attempt_key=$1',[key]);
    if (existing.rowCount) { await db.query('ROLLBACK'); return false; }
    const local = await db.query('SELECT count(*)::integer AS n FROM prospecting_send_attempts WHERE run_date=$1',[date]);
    if (!Number.isInteger(dailyLimit) || dailyLimit<1 || dailyLimit>1000) throw new Error('Daily campaign limit invalid');
    if (local.rows[0].n>=dailyLimit || !await sharedCapacity(db,date,history)) { await db.query('ROLLBACK'); return false; }
    await db.query(`INSERT INTO prospecting_send_attempts(attempt_key,sequence_id,run_date,status) VALUES($1,$2,$3,'reserved')`,[key,sequenceId,date]);
    await db.query('COMMIT'); return true;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
export async function submitOnce(db, api, attemptKey, body) {
  // The durable reservation exists BEFORE the API call. Ambiguous failures are
  // held permanently for reconciliation; we never retry an uncertain send.
  try {
    const result = await api('POST','/conversations/messages',{body});
    if (!result.messageId && !result.emailMessageId) throw new Error('Send response missing message ID');
    await db.query(`UPDATE prospecting_send_attempts SET status='accepted',message_id=$2,email_message_id=$3 WHERE attempt_key=$1`,
      [attemptKey,result.messageId || null,result.emailMessageId || null]);
    return result;
  } catch (error) {
    await db.query("UPDATE prospecting_send_attempts SET status='unknown' WHERE attempt_key=$1",[attemptKey]).catch(()=>{});
    throw new Error('Send outcome requires reconciliation; automatic retry blocked');
  }
}


