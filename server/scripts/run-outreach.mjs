import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { apiClient, allContacts, emailHistory } from './outreach-api.mjs';
import { qualifyWebsite } from './website-evidence.mjs';
import { duplicate, companyKey, suppressionReason, verifiedEmail, sendHold, compose, addWeekdays, outboundCount, campaignLimit } from './outreach-policy.mjs';
import { ensureOutreach, reserveAttempt, submitOnce } from './outreach-store.mjs';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
export async function runOutreach(date) {
  if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
    console.log(JSON.stringify({date,status:'outreach-blocked',reason:'crm-not-configured',sent:0})); return;
  }
  const enabled = process.env.OUTREACH_ENABLED === 'true';
  let limit = Number(process.env.OUTREACH_DAILY_LIMIT || 5);
  if (!Number.isInteger(limit) || limit<1 || limit>50) throw new Error('Outreach daily limit must be 1 to 50');
  if (enabled && !process.env.GHL_EMAIL_FROM) throw new Error('Outreach sender missing');
  const api = apiClient({token:process.env.GHL_API_TOKEN,locationId:process.env.GHL_LOCATION_ID});
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL}), db=await pool.connect();
  let ownsLock=false, accepted=0, held=0, qualified=0;
  try {
    const lock=await db.query('SELECT pg_try_advisory_lock($1) AS acquired',[7101027]);
    if (!lock.rows[0].acquired) throw new Error('Another cloud outreach runner is active');
    ownsLock=true; await ensureOutreach(db);
    const contacts = await allContacts(api);
    if (contacts.some(c=>c.locationId!==process.env.GHL_LOCATION_ID)) throw new Error('CRM contact account mismatch');
    const readiness=await db.query("SELECT status FROM prospecting_readiness WHERE test_key='cloud-internal-test-v1'");
    if (enabled && readiness.rows[0]?.status!=='delivered-and-reply-verified') throw new Error('Internal delivery and reply test must pass before prospect sending');
    if(enabled) {
      const since=new Date(Date.parse(date+'T00:00:00Z')-14*86400000).toISOString();
      const history=await emailHistory(api,{startDate:since});
      const sequenceContacts=new Set((await db.query('SELECT contact_id FROM prospecting_sequences WHERE contact_id IS NOT NULL')).rows.map(r=>r.contact_id));
      const campaignMessages=history.filter(m=>m.direction==='outbound' && sequenceContacts.has(m.contactId));
      const delivered=campaignMessages.filter(m=>['delivered','opened','read'].includes(m.status)).length;
      const failed=campaignMessages.filter(m=>['failed','undelivered','bounced'].includes(m.status)).length;
      limit=campaignLimit({configured:limit,delivered,failed});
      console.log(JSON.stringify({date,status:'new-campaign-delivery-check',delivered,failed,dailyLimit:limit}));
    }
    // Existing sequences are checked every weekday, including days on which no
    // follow-up is due. Any inbound email stops the sequence without interpretation.
    const active=await db.query("SELECT * FROM prospecting_sequences WHERE status IN ('active','qualified') ORDER BY next_date LIMIT 200");
    for (const sequence of active.rows) {
      if(sequence.status==='qualified') {
        if(!enabled || accepted>=limit) continue;
        const q=sequence.qualification;
        if(duplicate(q,contacts)) { await db.query("UPDATE prospecting_sequences SET status='stopped',stopped_reason='existing-crm-contact' WHERE id=$1",[sequence.id]); continue; }
        const fresh=await qualifyWebsite({website:q.website,email:q.email},q.company).catch(()=>({hold:'website-evidence-unavailable'}));
        if(!fresh.candidate) { held++; continue; }
        fresh.candidate.validation=await api('POST','/email/verify',{body:{type:'email',verify:q.email},version:'v3'});
        if(sendHold(fresh.candidate)) { held++; continue; }
        if(await dispatch(sequence,fresh.candidate,0)) accepted++;
        contacts.push({email:q.email,website:q.website,companyName:q.company});
        continue;
      }
      const contactResult=await api('GET','/contacts/'+sequence.contact_id);
      const contact=contactResult.contact;
      if (!contact || contact.locationId!==process.env.GHL_LOCATION_ID) throw new Error('Sequence contact account mismatch');
      const history=await emailHistory(api,{contactId:sequence.contact_id});
      const stop=suppressionReason(contact,history);
      if (stop) { await db.query("UPDATE prospecting_sequences SET status='stopped',stopped_reason=$2,updated_at=now() WHERE id=$1",[sequence.id,stop]); continue; }
      if (!enabled || String(sequence.next_date?.toISOString?.().slice(0,10) || sequence.next_date)>date) continue;
      if (accepted>=limit) continue;
      const q=sequence.qualification;
      const refreshed=await qualifyWebsite({website:q.website,email:q.email},q.company).catch(()=>({hold:'website-evidence-unavailable'}));
      if (!refreshed.candidate || refreshed.candidate.route!==q.route) {
        await db.query("UPDATE prospecting_sequences SET status='stopped',stopped_reason=$2 WHERE id=$1",[sequence.id,refreshed.hold || 'route-changed']); continue;
      }
      refreshed.candidate.validation=await api('POST','/email/verify',{body:{type:'email',verify:q.email},version:'v3'});
      if (sendHold(refreshed.candidate)) { await db.query("UPDATE prospecting_sequences SET status='stopped',stopped_reason='revalidation-failed' WHERE id=$1",[sequence.id]); continue; }
      if (await dispatch(sequence,refreshed.candidate,sequence.stage)) accepted++;
    }
    // Resume recent research without processing the same place repeatedly today.
    const candidates=await db.query(`SELECT c.* FROM (SELECT DISTINCT ON (place_id) * FROM prospecting_candidates
      WHERE run_date >= $1::date - interval '14 days' ORDER BY place_id,run_date DESC) c
      LEFT JOIN prospecting_qualifications q USING(place_id)
      WHERE q.place_id IS NULL OR q.updated_at < now()-interval '3 days' OR ($2 AND q.status='evidence-qualified')
      ORDER BY c.run_date DESC LIMIT 30`,[date,enabled]);
    for (const record of candidates.rows) {
      const score=record.score, identity={company:record.company,website:score.website,email:score.email};
      let result;
      if (duplicate(identity,contacts)) result={hold:'existing-crm-email-domain-or-company'};
      else result=await qualifyWebsite(score,record.company).catch(()=>({hold:'website-evidence-unavailable'}));
      const candidate=result.candidate;
      if (candidate && enabled && accepted<limit) {
        candidate.validation=await api('POST','/email/verify',{body:{type:'email',verify:candidate.email},version:'v3'});
        if (!verifiedEmail(candidate.validation,candidate.email)) { result.hold='email-not-verified'; delete result.candidate; }
      }
      await db.query(`INSERT INTO prospecting_qualifications(place_id,status,reason,result) VALUES($1,$2,$3,$4)
        ON CONFLICT(place_id) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,result=EXCLUDED.result,updated_at=now()`,
        [record.place_id,result.candidate?'evidence-qualified':'held',result.hold || (enabled?null:'sending-disabled'),JSON.stringify(result.candidate || null)]);
      if (!result.candidate) { held++; continue; }
      qualified++;
      if (!enabled || accepted>=limit) continue;
      const hold=sendHold(candidate); if (hold) { held++; continue; }
      const id=randomUUID();
      const inserted=await db.query(`INSERT INTO prospecting_sequences(id,domain,email,company_key,qualification)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,[id,candidate.domain,candidate.email,companyKey(candidate.company),JSON.stringify(candidate)]);
      if (!inserted.rowCount) { held++; continue; }
      if (await dispatch({id,contact_id:null},candidate,0)) accepted++;
      // Prevent a second prospect at the same firm within this run.
      contacts.push({email:candidate.email,website:candidate.website,companyName:candidate.company});
    }
    console.log(JSON.stringify({date,status:enabled?'outreach-run-complete':'outreach-held',reason:enabled?undefined:'sending-disabled-pending-readiness',qualified,held,accepted,sent:accepted}));
    async function dispatch(sequence,candidate,stage) {
      // Refresh account-wide observations before EACH reservation, not once per batch.
      // Fetch from the previous UTC midnight, then filter by London calendar
      // date. This remains correct in both GMT and BST.
      const startDate=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString();
      const history=await emailHistory(api,{startDate});
      const own=await db.query('SELECT message_id,email_message_id FROM prospecting_send_attempts WHERE run_date=$1',[date]);
      const ownIds=new Set(own.rows.flatMap(r=>[r.message_id,r.email_message_id]).filter(Boolean));
      const foreign=history.filter(m=>![m.id,m.altId,...(m.meta?.email?.email?.messageIds || [])].some(id=>ownIds.has(id)));
      const observed=outboundCount(foreign,date);
      const key=sequence.id+':'+stage;
      if (!await reserveAttempt(db,{key,sequenceId:sequence.id,date,observed,externalReserve:50,dailyLimit:limit})) return false;
      let contactId=sequence.contact_id;
      if (!contactId) {
        // Durable state BEFORE creation makes a timeout/crash a reconciliation
        // case instead of an automatic second create or a second send.
        await db.query("UPDATE prospecting_sequences SET status='creating-contact' WHERE id=$1",[sequence.id]);
        const created=await api('POST','/contacts/',{body:{email:candidate.email,companyName:candidate.company,website:candidate.website,
          country:'GB',source:'Proxaim cloud website evidence',tags:['scotland-professional-services','website-visibility-prospect','proxaim-cloud-sequence-'+sequence.id]}});
        if (!created.contact?.id || created.contact.locationId!==process.env.GHL_LOCATION_ID) throw new Error('Created contact account mismatch');
        contactId=created.contact.id;
        await db.query("UPDATE prospecting_sequences SET contact_id=$2,status='sending' WHERE id=$1",[sequence.id,contactId]);
      }
      // Check current suppression immediately before submitting the email.
      const current=await api('GET','/contacts/'+contactId);
      if (!current.contact || current.contact.locationId!==process.env.GHL_LOCATION_ID || current.contact.email?.toLowerCase()!==candidate.email) throw new Error('Send contact mismatch');
      const contactHistory=await emailHistory(api,{contactId});
      const stopped=suppressionReason(current.contact || {},contactHistory);
      if (stopped) { await db.query("UPDATE prospecting_sequences SET status='stopped',stopped_reason=$2 WHERE id=$1",[sequence.id,stopped]); return false; }
      const copy=compose(candidate,stage);
      let result;
      try { result=await submitOnce(db,api,key,{type:'Email',contactId,emailFrom:process.env.GHL_EMAIL_FROM,...copy}); }
      catch(error) { await db.query("UPDATE prospecting_sequences SET status='requires-reconciliation' WHERE id=$1",[sequence.id]).catch(()=>{}); throw error; }
      await db.query(`UPDATE prospecting_sequences SET status=$2,stage=$3,next_date=$4,qualification=$5,updated_at=now() WHERE id=$1`,
        [sequence.id,stage>=2?'complete':'active',stage+1,stage>=2?null:addWeekdays(date,stage===0?3:4),JSON.stringify(candidate)]);
      await sleep(2000); return Boolean(result);
    }
  } finally {
    if (ownsLock) await db.query('SELECT pg_advisory_unlock($1)',[7101027]).catch(()=>{});
    db.release(); await pool.end();
  }
}
