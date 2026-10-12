import { WEBSITE_LIMIT,SHARED_LIMIT } from './website-policy.mjs';
export async function ensureWebsite(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS website_runs(run_date date PRIMARY KEY,status text NOT NULL,summary jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS website_prospects(id text PRIMARY KEY,domain text UNIQUE NOT NULL,email text,company_key text NOT NULL,sector text NOT NULL,qualification jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'held',hold_reason text,contact_id text,outcome text,last_sent timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS website_email_unique ON website_prospects(lower(email)) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS website_company_unique ON website_prospects(company_key);
    CREATE UNIQUE INDEX IF NOT EXISTS website_company_number_unique ON website_prospects((qualification->'corporate'->>'companyNumber')) WHERE qualification->'corporate'->>'companyNumber' IS NOT NULL;
    CREATE TABLE IF NOT EXISTS website_previews(prospect_id text PRIMARY KEY REFERENCES website_prospects(id),html bytea,desktop bytea,mobile bytea,manifest jsonb NOT NULL,retired_at timestamptz);
    CREATE TABLE IF NOT EXISTS website_attempts(id text PRIMARY KEY,prospect_id text UNIQUE NOT NULL REFERENCES website_prospects(id),run_date date NOT NULL,status text NOT NULL,message_id text,email_message_id text,message jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS website_controls(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`);
}
export async function reserveWebsite(db,{id,prospectId,date,observedForeign,foreignReserve=80,message}) {
  if(!Number.isInteger(observedForeign)||observedForeign<0||!Number.isInteger(foreignReserve)||foreignReserve<0||foreignReserve>SHARED_LIMIT) throw Error('Capacity evidence invalid');
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock($1)',[7101050]);
    if((await db.query('SELECT 1 FROM website_attempts WHERE id=$1 OR prospect_id=$2',[id,prospectId])).rowCount) {await db.query('ROLLBACK');return false;}
    const count=(await db.query('SELECT count(*)::integer n FROM website_attempts WHERE run_date=$1',[date])).rows[0].n;
    const alerts=(await db.query("SELECT count(*)::integer n FROM website_alerts WHERE run_date=$1 AND status IN ('reserved','accepted','uncertain')",[date])).rows[0].n;
    const acknowledgements=(await db.query("SELECT count(*)::integer n FROM website_acknowledgements WHERE run_date=$1 AND status IN ('reserved','accepted','uncertain')",[date])).rows[0].n;
    if(count>=WEBSITE_LIMIT||count+alerts+acknowledgements+Math.max(foreignReserve,observedForeign)>=SHARED_LIMIT) {await db.query('ROLLBACK');return false;}
    await db.query("INSERT INTO website_attempts(id,prospect_id,run_date,status,message) VALUES($1,$2,$3,'reserved',$4)",[id,prospectId,date,JSON.stringify(message)]);
    await db.query('COMMIT');return true;
  } catch(error) {await db.query('ROLLBACK');throw error;}
}
export async function submitWebsite(db,api,id,body) {
  try {
    const sent=await api('POST','/conversations/messages',{body});
    if(!sent.messageId&&!sent.emailMessageId) throw Error('No provider message ID');
    await db.query("UPDATE website_attempts SET status='accepted',message_id=$2,email_message_id=$3,updated_at=now() WHERE id=$1 AND status='reserved'",[id,sent.messageId||null,sent.emailMessageId||null]);
    return sent;
  } catch(error) {await db.query("UPDATE website_attempts SET status='uncertain',updated_at=now() WHERE id=$1 AND status='reserved'",[id]).catch(()=>{});throw Error('Uncertain send; no automatic retry');}
}
export async function retireWebsite(db,id,outcome) {
  if(!['won','lost','opted_out','disqualified','closed','closed_no_reply'].includes(outcome)) throw Error('Concluded outcome required');
  await db.query('BEGIN');
  try {
    const pending=await db.query("SELECT 1 FROM website_attempts WHERE prospect_id=$1 AND status IN ('reserved','uncertain') UNION ALL SELECT 1 FROM website_acknowledgements WHERE prospect_id=$1 AND status IN ('reserved','uncertain')",[id]);
    if(pending.rowCount) throw Error('Unresolved send prevents retirement');
    const row=await db.query('SELECT status,outcome FROM website_prospects WHERE id=$1 FOR UPDATE',[id]);
    if(!row.rowCount) throw Error('Unknown prospect');
    if(row.rows[0].status==='retired') {await db.query('ROLLBACK');return false;}
    // Drop the speculative build payload, retaining a small manifest and all identities/history.
    await db.query('UPDATE website_previews SET html=NULL,desktop=NULL,mobile=NULL,retired_at=now() WHERE prospect_id=$1',[id]);
    await db.query("UPDATE website_prospects SET status='retired',outcome=$2,updated_at=now() WHERE id=$1",[id,outcome]);
    await db.query('COMMIT');return true;
  } catch(error) {await db.query('ROLLBACK');throw error;}
}
