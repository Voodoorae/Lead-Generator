import { outboundCount } from './outreach-policy.mjs';

// Call inside the shared 7101050 transaction lock, immediately before reserving.
// All attempts consume capacity, including uncertain submissions and internal mail.
export async function sharedCapacity(db,date,history) {
  if(!Array.isArray(history))throw Error('Complete account email history required');
  const limit=(await db.query('SELECT target FROM shared_outreach_ramp_days WHERE run_date=$1',[date])).rows[0];
  if(!limit)return 0;
  const rows=(await db.query(`SELECT message_id,email_message_id FROM prospecting_send_attempts WHERE run_date=$1::date
    UNION ALL SELECT message_id,email_message_id FROM website_attempts WHERE run_date=$1::date
    UNION ALL SELECT message_id,email_message_id FROM website_alerts WHERE run_date=$1::date AND status IN ('reserved','accepted','uncertain')
    UNION ALL SELECT message_id,email_message_id FROM website_acknowledgements WHERE run_date=$1::date AND status IN ('reserved','accepted','uncertain')
    UNION ALL SELECT value->>'messageId',value->>'emailMessageId' FROM website_controls WHERE key LIKE 'notification-test-%' AND value->>'date'=$1::text`,[date])).rows;
  const ids=new Set(rows.flatMap(r=>[r.message_id,r.email_message_id]).filter(Boolean));
  const external=history.filter(m=>![m.id,m.altId,...(m.meta?.email?.email?.messageIds||[])].some(id=>ids.has(id)));
  return Math.max(0,Math.floor(Number(limit.target))-rows.length-outboundCount(external,date));
}

