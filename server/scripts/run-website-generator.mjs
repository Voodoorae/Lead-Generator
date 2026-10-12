import pg from 'pg';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { apiClient,allContacts,emailHistory,emailDetail,proxaimEmailDetail } from './outreach-api.mjs';
import { companyKey,domainKey,duplicate,suppressionReason,verifiedEmail,outboundCount } from './outreach-policy.mjs';
import { postLeadJson } from './lead-api.mjs';
import { ensureWebsite,reserveWebsite,submitWebsite,retireWebsite } from './website-store.mjs';
import { ensureOutreach } from './outreach-store.mjs';
import { websiteWindow,websiteSearches,recipientHold,composeWebsite,retireDecision,WEBSITE_FROM,websiteSenderVerified } from './website-policy.mjs';
import { openWebsiteBrowser,inspectWebsite,corporateWebsite,buildWebsite,verifyPreview,publicResource } from './website-browser.mjs';
import { pageText } from './website-evidence.mjs';
import { ensureSales } from './website-sales.mjs';

export const workflowSignature = workflows => createHash('sha256').update(JSON.stringify(workflows.filter(w=>w.status==='published').map(w=>({id:w.id,updatedAt:w.updatedAt,version:w.version})).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
export async function runWebsiteGenerator({force=false,readinessOnly=false}={}) {
  const window=websiteWindow();
  if(!window.due&&!force) return {status:'outside-website-window',sent:0};
  if(force&&process.env.WEBSITE_TEST_DATE!==window.date)throw Error('Manual cloud verification must be dated');
  if(!process.env.DATABASE_URL)throw Error('Persistent database required');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const db=await pool.connect();
  const summary={date:window.date,status:'running',found:0,qualified:0,previewed:0,accepted:0,confirmedDelivered:0,held:0,skipped:0,retired:0,errors:[]};
  let browser,owns=false;
  const enabled=process.env.WEBSITE_OUTREACH_ENABLED==='true';
  try {
    owns=(await db.query('SELECT pg_try_advisory_lock($1) acquired',[7101027])).rows[0].acquired;
    if(!owns)return {status:'other-outreach-running',sent:0};
    await ensureOutreach(db);await ensureWebsite(db);await ensureSales(db);
    // Private migration data is an environment setting, never committed to a public repo.
    if(process.env.WEBSITE_MIGRATION_SEED) {
      const seeds=JSON.parse(gunzipSync(Buffer.from(process.env.WEBSITE_MIGRATION_SEED,'base64')).toString());
      if(!Array.isArray(seeds)||seeds.length>30)throw Error('Migration seed invalid');
      for(const seed of seeds) {
        if(!seed.id||!seed.company||!domainKey(seed.website))throw Error('Migration identity invalid');
        await db.query(`INSERT INTO website_prospects(id,domain,email,company_key,sector,qualification,hold_reason) VALUES($1,$2,$3,$4,$5,$6,'fresh-cloud-review-required') ON CONFLICT DO NOTHING`,[seed.id,domainKey(seed.website),seed.email||null,companyKey(seed.company),seed.sector,JSON.stringify(seed)]);
        if(seed.previewHtml)await db.query(`INSERT INTO website_previews(prospect_id,html,manifest) SELECT id,$2,$3 FROM website_prospects WHERE id=$1 ON CONFLICT DO NOTHING`,[seed.id,Buffer.from(seed.previewHtml),JSON.stringify({...seed.previewManifest,migrated:true,cloudQaRefreshed:false})]);
      }
    }
    const prior=(await db.query('SELECT status FROM website_runs WHERE run_date=$1',[window.date])).rows[0];
    if(['complete','complete-with-holds'].includes(prior?.status)&&!readinessOnly)return {status:'already-completed',sent:0};
    await db.query(`INSERT INTO website_runs(run_date,status) VALUES($1,'running') ON CONFLICT(run_date) DO UPDATE SET status='running',updated_at=now()`,[window.date]);
    if(!process.env.GHL_API_TOKEN||!process.env.GHL_LOCATION_ID)throw Error('CRM API credentials required');
    const api=apiClient({token:process.env.GHL_API_TOKEN,locationId:process.env.GHL_LOCATION_ID});
    const contacts=await allContacts(api);
    if(contacts.some(c=>c.locationId!==process.env.GHL_LOCATION_ID))throw Error('CRM account mismatch');
    let workflowClear=false;
    try {
      const result=await api('GET','/workflows/');
      if(!Array.isArray(result.workflows))throw Error('Workflow inventory unavailable');
      if(result.workflows.some(w=>w.locationId!==process.env.GHL_LOCATION_ID))throw Error('Workflow account mismatch');
      const signature=workflowSignature(result.workflows);
      workflowClear=signature===process.env.WEBSITE_WORKFLOW_SIGNATURE;
      await db.query(`INSERT INTO website_controls(key,value) VALUES('workflow-inventory',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[JSON.stringify({signature,reviewed:workflowClear,published:result.workflows.filter(w=>w.status==='published').length})]);
    }catch{summary.errors.push('workflow-inventory-or-reviewed-trigger-signature-unavailable');}
    if(!workflowClear)summary.errors.push('contact-created-workflow-clearance-required');
    const history=await emailHistory(api,{startDate:new Date(Date.parse(window.date+'T00:00:00Z')-86400000).toISOString()});
    // Check a previously delivered internal test by actual sender. No repeated probe mail.
    let senderClear=false;
    const senderContact=process.env.WEBSITE_SENDER_TEST_CONTACT_ID||process.env.GHL_PROBE_CONTACT_ID;
    if(process.env.WEBSITE_SENDER_TEST_ID&&senderContact) {
      try {const test=await emailDetail(api,{id:process.env.WEBSITE_SENDER_TEST_ID,contactId:senderContact,direction:'outbound'},process.env.GHL_LOCATION_ID);
        senderClear=websiteSenderVerified(test);
      }catch{summary.errors.push('actual-sender-test-unavailable');}
    }
    if(!senderClear)summary.errors.push('verified-proxaim-sender-required');
    // Reconcile replies and delivery before new introductions or retirement.
    const active=(await db.query("SELECT * FROM website_prospects WHERE contact_id IS NOT NULL AND status<>'retired'")).rows;
    for(const row of active) {
      const contact=(await api('GET','/contacts/'+row.contact_id)).contact;
      if(!contact||contact.locationId!==process.env.GHL_LOCATION_ID)throw Error('Prospect contact mismatch');
      const messages=await emailHistory(api,{contactId:row.contact_id});
      const stop=suppressionReason(contact,messages);
      const replies=messages.filter(m=>m.direction==='inbound');
      if(replies.length) await db.query("UPDATE website_prospects SET status='reply_received',hold_reason='reply-review',updated_at=now() WHERE id=$1",[row.id]);
      const attempt=(await db.query('SELECT * FROM website_attempts WHERE prospect_id=$1',[row.id])).rows[0];
      if(attempt?.status==='accepted') {
        const sent=messages.find(m=>[m.id,m.altId,...(m.meta?.email?.email?.messageIds||[])].some(id=>id&&[attempt.message_id,attempt.email_message_id].includes(id)));
        if(sent) {const detail=await emailDetail(api,sent,process.env.GHL_LOCATION_ID);if(['delivered','opened','read'].includes(detail.status))summary.confirmedDelivered++;}
      }
      const tags=(contact.tags||[]).map(t=>String(t).toLowerCase());
      const outcome=row.outcome||(['do-not-contact','suppression-tag'].includes(stop)?'opted_out':tags.includes('website-prospect-lost')?'lost':tags.includes('website-handoff-complete')?'won':null);
      const retirement=retireDecision({outcome,lastSent:row.last_sent,hasReply:replies.length>0});
      if(retirement&&await retireWebsite(db,row.id,retirement))summary.retired++;
    }
    browser=await openWebsiteBrowser();
    await verifyPreview(browser,'<!doctype html><meta name="viewport" content="width=device-width"><a href="mailto:hello@proxaim.com">Synthetic browser readiness</a>','hello@proxaim.com');
    if(readinessOnly) {summary.status='readiness-checked';return summary;}
    const leadApi=new URL(process.env.LEAD_GENERATOR_URL||'https://lead-generator-1-vx3v.onrender.com');
    if(leadApi.protocol!=='https:')throw Error('Discovery API must use HTTPS');
    // Resume imported/persisted research first. CRM identities stay immutable.
    const queue=(await db.query("SELECT * FROM website_prospects WHERE status='held' ORDER BY updated_at LIMIT 30")).rows;
    const candidates=queue.map(row=>({...row.qualification,id:row.id,sector:row.sector,company:row.qualification.company,website:row.qualification.website}));
    for(const search of websiteSearches(window.date)) {
      try {
        const result=await postLeadJson(new URL('/api/leads',leadApi),search);
        if(!Array.isArray(result.leads))throw Error('Discovery response invalid');
        summary.found+=result.leads.length;
        for(const place of result.leads.slice(0,8)) {
          if(!place.placeId||!place.name)continue;
          const raw=await postLeadJson(new URL('/api/score-lead',leadApi),{placeId:place.placeId,name:place.name,location:search.location});
          if(raw.placeId!==place.placeId)throw Error('Discovery identity mismatch');
          if(!raw.website){summary.held++;continue;}
          candidates.push({id:'website-'+createHash('sha256').update(domainKey(raw.website)).digest('hex').slice(0,24),company:place.name,website:raw.website,address:place.address,sector:search.niche,discoverySource:leadApi.href,valueRationale:'Inference from advertised property, installation or private practice service; no revenue estimate.'});
        }
      }catch(error){summary.errors.push('discovery-read-failed');}
    }
    const seen=new Set();
    for(const input of candidates.slice(0,35)) {
      const domain=domainKey(input.website);if(!domain||seen.has(domain)){summary.skipped++;continue;}seen.add(domain);
      const existing=(await db.query('SELECT status FROM website_prospects WHERE domain=$1',[domain])).rows[0];
      if(existing&&existing.status!=='held'){summary.skipped++;continue;}
      if((await db.query('SELECT 1 FROM prospecting_sequences WHERE domain=$1 OR company_key=$2',[domain,companyKey(input.company)])).rowCount){summary.skipped++;continue;}
      try {
        if(!/\b(?:Edinburgh|Glasgow|Aberdeen|Dundee|Stirling|Inverness|Perth|Scotland|Fife|Lothian|Ayr|Kilmarnock|Bathgate|Broxburn|Blackford|Lochgelly|West Calder)\b/i.test(input.address||''))throw Error('Scottish business address unverified');
        const clinical=/dent|medical|clinic/i.test(input.sector);
        const inspection=await inspectWebsite(browser,input.website,{clinical});
        const services=pageText(inspection.source.html);
        const sectorPattern=/accountant/i.test(input.sector)?/account|bookkeep|payroll/i:/survey/i.test(input.sector)?/survey|dilapidation|quantity|valuation/i:/roof/i.test(input.sector)?/roof|re-roof|reroof/i:/heating/i.test(input.sector)?/boiler|heat pump|heating installation/i:/dent/i.test(input.sector)?/dental|dentist|implant|orthodont/i:/medical|clinic/i.test(input.sector)?/private gp|medical|consultation|diagnostic/i:/electrical|electrician/i;
        if(!sectorPattern.test(services))throw Error('Advertised services do not verify the selected sector');
        const corporate=await corporateWebsite(inspection.source,input.company);
        const candidate={...input,...corporate,domain,website:inspection.source.url,evidence:{findings:inspection.findings,desktop:true,mobile:true,sourceUrl:inspection.source.url,checkedAt:new Date().toISOString(),sha256:createHash('sha256').update(inspection.source.html).digest('hex')},previewVerified:false};
        if(duplicate(candidate,contacts)||duplicate({...candidate,company:candidate.corporate.legalName},contacts)){summary.skipped++;continue;}
        const hold=recipientHold(candidate);
        await db.query(`INSERT INTO website_prospects(id,domain,email,company_key,sector,qualification,status,hold_reason) VALUES($1,$2,$3,$4,$5,$6,'held',$7) ON CONFLICT(domain) DO UPDATE SET qualification=EXCLUDED.qualification,email=EXCLUDED.email,hold_reason=EXCLUDED.hold_reason,updated_at=now()`,[candidate.id,domain,candidate.email,companyKey(candidate.company),candidate.sector,JSON.stringify(candidate),hold]);
        if(hold){summary.held++;continue;}
        summary.qualified++;
        if(!inspection.desktop.logo&&!inspection.desktop.accent)throw Error('Original branding not verified; concept held');
        for(const asset of [inspection.desktop.logo,inspection.desktop.photo].filter(Boolean)) {const result=await publicResource(asset);if(!result.contentType.startsWith('image/'))throw Error('Original image unavailable; concept held');}
        const preview=buildWebsite(candidate,inspection);
        await verifyPreview(browser,preview.html,candidate.email);candidate.previewVerified=true;
        await db.query(`INSERT INTO website_previews(prospect_id,html,desktop,mobile,manifest) VALUES($1,$2,$3,$4,$5) ON CONFLICT(prospect_id) DO UPDATE SET html=EXCLUDED.html,desktop=EXCLUDED.desktop,mobile=EXCLUDED.mobile,manifest=EXCLUDED.manifest`,[candidate.id,Buffer.from(preview.html),inspection.desktop.screenshot,inspection.mobile.screenshot,JSON.stringify(preview.manifest)]);
        summary.previewed++;
        const copy=composeWebsite(candidate);
        await db.query("UPDATE website_prospects SET qualification=$2,hold_reason=$3 WHERE id=$1",[candidate.id,JSON.stringify({...candidate,draft:copy}),!enabled?'outreach-disabled':!workflowClear?'workflow-clearance-required':!senderClear?'sender-verification-required':'ready-for-final-checks']);
        if(!enabled||!workflowClear||!senderClear){summary.held++;continue;}
        // Refresh complete identities immediately before any new contact is created.
        const freshContacts=await allContacts(api);
        if(duplicate(candidate,freshContacts)||duplicate({...candidate,company:candidate.corporate.legalName},freshContacts)){summary.skipped++;continue;}
        const validation=await api('POST','/email/verify',{body:{type:'email',verify:candidate.email},version:'v3'});
        if(!verifiedEmail(validation,candidate.email)){summary.held++;continue;}
        const refreshed=await emailHistory(api,{startDate:new Date(Date.parse(window.date+'T00:00:00Z')-86400000).toISOString()});
        const ownIds=new Set((await db.query('SELECT message_id,email_message_id FROM website_attempts WHERE run_date=$1',[window.date])).rows.flatMap(r=>[r.message_id,r.email_message_id]).filter(Boolean));
        const foreign=refreshed.filter(m=>![m.id,m.altId,...(m.meta?.email?.email?.messageIds||[])].some(id=>ownIds.has(id)));
        const key='website-intro-'+createHash('sha256').update(candidate.email).digest('hex').slice(0,24);
        if(!await reserveWebsite(db,{id:key,prospectId:candidate.id,date:window.date,observedForeign:outboundCount(foreign,window.date),message:copy})){summary.held++;continue;}
        // A reserved attempt is permanent even if contact creation becomes ambiguous.
        const created=await api('POST','/contacts/',{body:{email:candidate.email,name:candidate.company,companyName:candidate.company,website:candidate.website,source:'Proxaim website generator'}});
        const contact=created.contact;
        if(!contact?.id||contact.locationId!==process.env.GHL_LOCATION_ID||contact.email?.toLowerCase()!==candidate.email)throw Error('Created contact mismatch; reconcile reservation');
        await db.query('UPDATE website_prospects SET contact_id=$2 WHERE id=$1',[candidate.id,contact.id]);
        if(suppressionReason(contact,await emailHistory(api,{contactId:contact.id})))throw Error('New contact suppressed; reservation held');
        const sent=await submitWebsite(db,api,key,{type:'Email',contactId:contact.id,emailFrom:WEBSITE_FROM,emailTo:candidate.email,subject:copy.subject,html:copy.html});
        await db.query("UPDATE website_prospects SET status='awaiting_reply',last_sent=now(),hold_reason=NULL,updated_at=now() WHERE id=$1",[candidate.id]);summary.accepted++;
        try {
          const actual=await proxaimEmailDetail(api,{id:sent.emailMessageId||sent.messageId,contactId:contact.id,direction:'outbound'},process.env.GHL_LOCATION_ID);
          if(!/^Proxaim\s*<hello@proxaim\.com>$/i.test(actual.emailFrom))throw Error('Actual sender differs from Proxaim');
          if(['delivered','opened','read'].includes(actual.status))summary.confirmedDelivered++;
        }catch{senderClear=false;summary.errors.push('accepted-email-sender-or-delivery-check-needs-reconciliation');}
      }catch(error){summary.held++;summary.errors.push(error.message.replace(/https?:\/\/\S+/g,'[website]').slice(0,160));}
    }
    summary.status=summary.errors.length?'complete-with-holds':'complete';
    return summary;
  }catch(error){summary.status='failed';summary.errors.push(error.message);throw error;}
  finally {
    if(browser)await browser.close().catch(()=>{});
    if(owns){await db.query('UPDATE website_runs SET status=$2,summary=$3,updated_at=now() WHERE run_date=$1',[window.date,summary.status,JSON.stringify(summary)]).catch(()=>{});await db.query('SELECT pg_advisory_unlock($1)',[7101027]).catch(()=>{});}
    db.release();await pool.end();console.log(JSON.stringify({campaign:'website-generator',...summary}));
  }
}
