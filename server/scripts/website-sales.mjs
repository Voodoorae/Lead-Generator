import { createHash } from 'node:crypto';
import { addWeekdays, outboundCount, suppressionReason } from './outreach-policy.mjs';
import { apiClient, emailHistory, emailDetail } from './outreach-api.mjs';
import { escapeHtml, WEBSITE_FROM, websiteWindow } from './website-policy.mjs';
import { ensureWebsite } from './website-store.mjs';
import pg from 'pg';

export function classifyReply(body) {
  const current=String(body||'').split(/<blockquote|<div\b[^>]*(?:gmail_quote|yahoo_quoted)|\n(?:On .*wrote:|From:|[- ]*Original Message)/i)[0]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
    .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
  if(/unsubscribe|remove (?:me|us)|stop (?:emailing|contacting)|do not contact|no thanks/i.test(current))return 'opted_out';
  if(/out of (?:the )?office|automatic reply|auto.?reply|on (?:annual )?leave/i.test(current))return 'automatic';
  if(/not interested|no interest|not for (?:me|us)|already (?:have|using)|don.t (?:need|want)|not looking|no thank you/i.test(current))return 'declined';
  if((/^yes[.!\s]*$/i.test(current)||/\b(?:interested|sounds good|yes please|happy to (?:talk|discuss)|please (?:send|share)|send (?:me|us)|show (?:me|us)|book (?:a |the )?call|arrange (?:a |the )?call|how much|pricing|what (?:does|would) it cost)\b/i.test(current))
    && !/\b(?:not|no|never|don.t|cannot|can.t|won.t)\b/i.test(current))return 'positive';
  return 'review';
}

export function salesDraft(company,{previewVerified=false}={}) {
  const name=String(company||'your business').replace(/[\r\n\u0000-\u001f\u2014]/g,' ').slice(0,180);
  const text=`Hello,\n\nThank you for your interest in a website for ${name}. ${previewVerified?'The concept is ready to review together.':'We can prepare a concept around your existing branding and the services you want to prioritise.'}\n\nWhich service would you most like the website to generate enquiries for?\n\nWould a short call be useful to review the next step? If so, please suggest a suitable time.\n\nProxaim\nhello@proxaim.com\n\nIf you would prefer us to stop contacting you, please reply to let us know.`;
  return {subject:`Next steps for ${name}`,message:text,html:text.split('\n\n').map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('')};
}

export async function ensureSales(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS website_reply_events(message_id text PRIMARY KEY,prospect_id text NOT NULL REFERENCES website_prospects(id),classification text NOT NULL,received_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS website_sales(prospect_id text PRIMARY KEY REFERENCES website_prospects(id),stage text NOT NULL,last_reply_id text NOT NULL,draft jsonb NOT NULL,next_action text NOT NULL,due_date date NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS website_alerts(id text PRIMARY KEY,reply_id text UNIQUE NOT NULL REFERENCES website_reply_events(message_id),status text NOT NULL DEFAULT 'pending',run_date date,message_id text,email_message_id text,updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS website_sales_history(id bigserial PRIMARY KEY,prospect_id text NOT NULL REFERENCES website_prospects(id),stage text NOT NULL,evidence text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
}

export async function recordReply(db,row,message,date) {
  if(message.direction!=='inbound'||message.contactId!==row.contact_id||!message.id)throw Error('Reply identity mismatch');
  const received=new Date(message.dateAdded),sent=new Date(row.last_sent);
  if(!row.last_sent||!Number.isFinite(received.getTime())||!Number.isFinite(sent.getTime())||received<=sent)return false;
  const classification=classifyReply(message.body);
  await db.query('BEGIN');
  try {
    const saved=await db.query('INSERT INTO website_reply_events(message_id,prospect_id,classification,received_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[message.id,row.id,classification,received]);
    if(!saved.rowCount){await db.query('ROLLBACK');return false;}
    const stage=classification==='positive'?'engaged':classification==='opted_out'?'opted_out':classification==='declined'?'lost':classification==='automatic'?'awaiting_reply':'needs_review';
    const draft=classification==='positive'?salesDraft(row.qualification.company,{previewVerified:row.qualification.previewVerified===true}):{};
    const action=classification==='positive'?'Review interested reply and tailored draft; arrange discovery call':classification==='automatic'?'Check the original reply for a return date; no automatic sales reply':classification==='review'?'Review reply in CRM before responding':'Stop outreach; record closure';
    // Only the latest observed reply controls the current next step.
    await db.query(`INSERT INTO website_sales(prospect_id,stage,last_reply_id,draft,next_action,due_date) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(prospect_id) DO UPDATE SET stage=CASE WHEN EXCLUDED.stage='engaged' AND website_sales.stage IN ('qualified','preview_review','meeting_booked','proposal_sent','won','onboarding_complete') THEN website_sales.stage ELSE EXCLUDED.stage END,last_reply_id=EXCLUDED.last_reply_id,draft=EXCLUDED.draft,next_action=EXCLUDED.next_action,due_date=EXCLUDED.due_date,updated_at=now()`,[row.id,stage,message.id,JSON.stringify(draft),action,classification==='automatic'?addWeekdays(date,2):date]);
    await db.query("UPDATE website_prospects SET status='reply_received',hold_reason=$2,updated_at=now() WHERE id=$1",[row.id,classification]);
    if(classification==='positive')await db.query('INSERT INTO website_alerts(id,reply_id) VALUES($1,$2) ON CONFLICT DO NOTHING',['alert-'+createHash('sha256').update(message.id).digest('hex').slice(0,24),message.id]);
    // Later negative/unclear replies cancel earlier unsubmitted interest alerts.
    if(classification!=='positive')await db.query("UPDATE website_alerts SET status='cancelled',updated_at=now() WHERE status='pending' AND reply_id IN (SELECT message_id FROM website_reply_events WHERE prospect_id=$1)",[row.id]);
    await db.query('COMMIT');return true;
  }catch(error){await db.query('ROLLBACK');throw error;}
}

export async function submitAlert(db,api,alert,body) {
  try {
    const result=await api('POST','/conversations/messages',{body});
    if(!result.messageId&&!result.emailMessageId)throw Error('Provider ID missing');
    await db.query("UPDATE website_alerts SET status='accepted',message_id=$2,email_message_id=$3,updated_at=now() WHERE id=$1 AND status='reserved'",[alert.id,result.messageId||null,result.emailMessageId||null]);
    return result;
  }catch{await db.query("UPDATE website_alerts SET status='uncertain',updated_at=now() WHERE id=$1 AND status='reserved'").catch(()=>{});throw Error('Uncertain notification; no automatic retry');}
}

export async function runWebsiteReplies() {
  if(!process.env.DATABASE_URL||!process.env.GHL_API_TOKEN||!process.env.GHL_LOCATION_ID)return {status:'reply-monitor-not-configured'};
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),db=await pool.connect();let owns=false;
  const summary={status:'reply-check-complete',newReplies:0,alertsAccepted:0,alertsHeld:0};
  try {
    owns=(await db.query('SELECT pg_try_advisory_lock($1) acquired',[7101027])).rows[0].acquired;
    if(!owns)return {status:'outreach-running'};
    await ensureWebsite(db);await ensureSales(db);
    const api=apiClient({token:process.env.GHL_API_TOKEN,locationId:process.env.GHL_LOCATION_ID}),date=websiteWindow().date;
    const rows=(await db.query("SELECT * FROM website_prospects WHERE contact_id IS NOT NULL AND last_sent IS NOT NULL AND status<>'retired'")).rows;
    for(const row of rows) {
      const messages=await emailHistory(api,{contactId:row.contact_id});
      const stopped=(await api('GET','/contacts/'+row.contact_id)).contact;
      if(stopped?.locationId!==process.env.GHL_LOCATION_ID)throw Error('Reply contact account mismatch');
      if(['do-not-contact','suppression-tag','invalid-email'].includes(suppressionReason(stopped))) {
        await db.query("UPDATE website_alerts SET status='cancelled',updated_at=now() WHERE status='pending' AND reply_id IN (SELECT message_id FROM website_reply_events WHERE prospect_id=$1)",[row.id]);
        continue;
      }
      for(const message of messages.filter(m=>m.direction==='inbound').sort((a,b)=>new Date(a.dateAdded)-new Date(b.dateAdded))) {
        if(message.locationId!==process.env.GHL_LOCATION_ID)throw Error('Reply account mismatch');
        if(await recordReply(db,row,message,date))summary.newReplies++;
      }
    }
    const alerts=(await db.query("SELECT a.*,p.qualification,p.contact_id FROM website_alerts a JOIN website_reply_events e ON e.message_id=a.reply_id JOIN website_prospects p ON p.id=e.prospect_id JOIN website_sales s ON s.prospect_id=p.id AND s.last_reply_id=e.message_id WHERE a.status='pending' AND s.stage NOT IN ('lost','opted_out','needs_review','awaiting_reply','onboarding_complete') ORDER BY a.updated_at LIMIT 20")).rows;
    if(!alerts.length)return summary;
    const recipient=process.env.WEBSITE_ALERT_EMAIL,contactId=process.env.WEBSITE_ALERT_CONTACT_ID;
    if(process.env.WEBSITE_ALERTS_ENABLED!=='true'||!recipient||!contactId){summary.alertsHeld=alerts.length;return summary;}
    const contact=(await api('GET','/contacts/'+contactId)).contact;
    if(contact?.locationId!==process.env.GHL_LOCATION_ID||contact.email?.toLowerCase()!==recipient.toLowerCase()||suppressionReason(contact))throw Error('Notification recipient not cleared');
    const test=await emailDetail(api,{id:process.env.WEBSITE_SENDER_TEST_ID,contactId:process.env.WEBSITE_SENDER_TEST_CONTACT_ID,direction:'outbound'},process.env.GHL_LOCATION_ID);
    if(!['delivered','opened','read'].includes(test.status)||!/^Proxaim\s*<hello@proxaim\.com>$/i.test(test.emailFrom))throw Error('Notification sender not verified');
    for(const alert of alerts) {
      const history=await emailHistory(api,{startDate:new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString()});
      const observed=outboundCount(history,date);
      await db.query('BEGIN');
      let reserved=false;
      try {
        await db.query('SELECT pg_advisory_xact_lock($1)',[7101050]);
        const n=(await db.query(`SELECT (SELECT count(*) FROM website_attempts WHERE run_date=$1)+(SELECT count(*) FROM website_alerts WHERE run_date=$1 AND status IN ('reserved','accepted','uncertain')) AS n`,[date])).rows[0].n;
        if(observed<100&&80+Number(n)<100)reserved=(await db.query("UPDATE website_alerts SET status='reserved',run_date=$2,updated_at=now() WHERE id=$1 AND status='pending' RETURNING id",[alert.id,date])).rowCount===1;
        await db.query('COMMIT');
      }catch(error){await db.query('ROLLBACK');throw error;}
      if(!reserved){summary.alertsHeld++;continue;}
      const company=String(alert.qualification.company||'A website prospect').replace(/[\r\n\u2014]/g,' ').slice(0,180);
      const crm='https://app.gohighlevel.com/v2/location/'+encodeURIComponent(process.env.GHL_LOCATION_ID)+'/contacts/detail/'+encodeURIComponent(alert.contact_id);
      const html=`<p>${escapeHtml(company)} has sent a reply matching an interest signal. Please review the actual reply before making a commitment.</p><p><a href="${escapeHtml(crm)}">Open the contact in CRM</a></p><p>A tailored reply draft is saved in the private generator dashboard. Suggested next step: confirm their priority service and arrange a short discovery call.</p><p>Proxaim</p>`;
      const sent=await submitAlert(db,api,alert,{type:'Email',contactId,emailTo:recipient,emailFrom:WEBSITE_FROM,subject:'Website enquiry: '+company,html});summary.alertsAccepted++;
      const actual=await emailDetail(api,{id:sent.emailMessageId||sent.messageId,contactId,direction:'outbound'},process.env.GHL_LOCATION_ID);
      if(!/^Proxaim\s*<hello@proxaim\.com>$/i.test(actual.emailFrom))throw Error('Accepted notification sender mismatch; reconcile before continuing');
    }
    return summary;
  }finally{if(owns)await db.query('SELECT pg_advisory_unlock($1)',[7101027]).catch(()=>{});db.release();await pool.end();}
}
