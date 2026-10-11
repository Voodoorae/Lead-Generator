import pg from 'pg';
import { apiClient, emailHistory } from './outreach-api.mjs';
import { londonWindow } from './prospecting-policy.mjs';
import { verifiedEmail, emailKey, outboundCount, suppressionReason } from './outreach-policy.mjs';
import { ensureOutreach, reserveAttempt, submitOnce } from './outreach-store.mjs';
const key='cloud-internal-test-v1';
export async function internalReadiness({send=false}={}) {
  const date=londonWindow().date;
  if (send && process.env.OUTREACH_INTERNAL_TEST_DATE!==date) throw new Error('Internal test requires current UK date');
  const api=apiClient({token:process.env.GHL_API_TOKEN,locationId:process.env.GHL_LOCATION_ID});
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),db=await pool.connect();
  try {
    await ensureOutreach(db);
    let attempt=(await db.query('SELECT * FROM prospecting_send_attempts WHERE attempt_key=$1',[key])).rows[0];
    const prior=(await db.query('SELECT * FROM prospecting_readiness WHERE test_key=$1',[key])).rows[0];
    // Recovery is explicitly dated and only allowed for a recorded failure
    // BEFORE submitOnce was invoked. An unknown send is never retried.
    const oldPreflight=prior?.status==='failed' && prior.detail?.reason==='CRM request HTTP 422';
    const resumePreflight=send && process.env.OUTREACH_INTERNAL_RECOVER_PRE_SEND_DATE===date && attempt?.status==='reserved'
      && (oldPreflight || prior?.status==='failed' && prior.detail?.emailSubmitted===false);
    if(resumePreflight) attempt=null;
    if (!attempt && send) {
      const contact=(await api('GET','/contacts/'+process.env.GHL_PROBE_CONTACT_ID)).contact;
      if (!contact || contact.locationId!==process.env.GHL_LOCATION_ID || !process.env.GHL_INTERNAL_TEST_EMAIL || emailKey(contact.email)!==emailKey(process.env.GHL_INTERNAL_TEST_EMAIL)) throw new Error('Internal recipient account or address mismatch');
      if (suppressionReason(contact)) throw new Error('Internal test contact is suppressed');
      if (!process.env.GHL_EMAIL_FROM) throw new Error('Internal sender missing');
      const history=await emailHistory(api,{startDate:new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString()});
      if (!resumePreflight && !await reserveAttempt(db,{key,sequenceId:null,date,observed:outboundCount(history,date),externalReserve:50,dailyLimit:5})) throw new Error('Internal test capacity unavailable');
      let emailSubmitted=false;
      try {
        const validation=await api('POST','/email/verify',{body:{type:'email',verify:contact.email},version:'v3'});
        if (!verifiedEmail(validation,contact.email)) throw new Error('Internal email validation failed');
        await api('POST','/contacts/'+contact.id+'/tags',{body:{tags:['proxaim-cloud-internal-test']}});
        const copy='Hello Rachael,\n\nThis is the cloud sending readiness test from Steven. It was submitted from the Render deployment using the CRM connection.\n\nPlease reply with: Ready cloud-internal-test-v1\n\nThat lets us verify reply handling before prospect sending is enabled.\n\nThe funnel link to check is https://proxaim.com/check\n\nSteven Nisbet\nProxaim';
        emailSubmitted=true;
        const result=await submitOnce(db,api,key,{type:'Email',contactId:contact.id,emailFrom:process.env.GHL_EMAIL_FROM,
          subject:'Proxaim cloud readiness test',message:copy,html:copy.replace(/\n/g,'<br>')});
        await db.query(`INSERT INTO prospecting_readiness(test_key,status,detail) VALUES($1,'accepted',$2)
          ON CONFLICT(test_key) DO UPDATE SET status='accepted',detail=EXCLUDED.detail,updated_at=now()`,[key,JSON.stringify({validation:'deliverable-low-risk',contactWrite:'tag-added',messageId:result.messageId,emailMessageId:result.emailMessageId})]);
      } catch(error) {
        await db.query(`INSERT INTO prospecting_readiness(test_key,status,detail) VALUES($1,'failed',$2)
          ON CONFLICT(test_key) DO UPDATE SET status='failed',detail=EXCLUDED.detail,updated_at=now()`,[key,JSON.stringify({reason:error.message,emailSubmitted})]);
        throw error;
      }
      attempt=(await db.query('SELECT * FROM prospecting_send_attempts WHERE attempt_key=$1',[key])).rows[0];
    }
    if (!attempt) return {status:'internal-test-not-run',sent:0};
    if (attempt.status!=='accepted') return {status:'internal-test-requires-reconciliation',sent:0};
    const history=await emailHistory(api,{contactId:process.env.GHL_PROBE_CONTACT_ID});
    const sent=history.find(m=>[m.id,m.altId,...(m.meta?.email?.email?.messageIds || [])].some(id=>id && [attempt.message_id,attempt.email_message_id].includes(id)));
    const replies=history.filter(m=>m.direction==='inbound' && new Date(m.dateAdded)>=new Date(attempt.created_at) && /Ready\s+cloud-internal-test-v1/i.test(m.body || ''));
    const stopped=suppressionReason({},replies)==='reply-received';
    const status=stopped?'delivered-and-reply-verified':sent?.status==='delivered' || sent?.status==='opened' || sent?.status==='read'?'delivered-awaiting-reply':'accepted-awaiting-delivery';
    await db.query('UPDATE prospecting_readiness SET status=$2,detail=detail || $3::jsonb,updated_at=now() WHERE test_key=$1',
      [key,status,JSON.stringify({deliveryStatus:sent?.status || 'not-yet-observed',replyStopVerified:stopped})]);
    return {status,contactWriteTested:true,emailValidationTested:true,replyStopVerified:stopped,sent:0};
  } finally { db.release(); await pool.end(); }
}
