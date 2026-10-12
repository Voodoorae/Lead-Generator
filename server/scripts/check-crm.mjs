import { checkCrm } from './crm-client.mjs';
import { londonWindow } from './prospecting-policy.mjs';
import { internalReadiness } from './internal-readiness.mjs';
import { testCloudLedger } from './cloud-ledger-test.mjs';
import { runOutreach } from './run-outreach.mjs';
// An empty search exercises cloud HTTP routing without a paid Places request.
if (process.env.LEAD_HTTP_DIAGNOSTIC_DATE === londonWindow().date) {
  const url = new URL('/api/leads', process.env.LEAD_GENERATOR_URL);
  if (url.protocol !== 'https:') throw new Error('Diagnostic requires HTTPS');
  const response = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body:'{}', signal:AbortSignal.timeout(120_000) });
  const headers = Object.fromEntries(['server','content-type','retry-after','rndr-id','x-render-origin-server','cf-ray','x-powered-by'].map(name => [name,response.headers.get(name)]));
  const body = (await response.text()).slice(0,2000);
  console.log(JSON.stringify({status:'lead-http-diagnostic',httpStatus:response.status,headers,body,sent:0}));
}
// Build-time diagnostics run only on the dedicated prospecting cron.
// Ordinary web-service builds without these settings are unaffected.
if (!process.env.GHL_API_TOKEN && !process.env.GHL_LOCATION_ID) {
  console.log(JSON.stringify({ status: 'crm-check-not-configured', sent: 0 }));
} else {
  try {
    const result = await checkCrm({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID, probeContactId: process.env.GHL_PROBE_CONTACT_ID });
    console.log(JSON.stringify(result));
    const sender=String(process.env.GHL_EMAIL_FROM || '').trim();
    console.log(JSON.stringify({status:'cloud-sender-configuration',configuredAsSteven:/^(?:Steven Nisbet\s*<)?steve\.nisbet@becomefoundbyai\.com>?$/i.test(sender),configuredAsProxaim:sender.includes('hello@proxaim.com'),hasDisplayName:sender.startsWith('Steven Nisbet <'),sendingEnabled:process.env.OUTREACH_ENABLED==='true'}));
    const today=londonWindow().date;
    if (process.env.OUTREACH_READINESS_CHECK_DATE===today) console.log(JSON.stringify(await testCloudLedger()));
    if (process.env.OUTREACH_INTERNAL_TEST_DATE===today) console.log(JSON.stringify(await internalReadiness({send:true})));
    // Explicit, date-limited manual sending retains the ordinary ledger and gates.
    if(process.env.OUTREACH_MANUAL_SEND_DATE===today) {
      const reviewDomain=process.env.OUTREACH_MANUAL_REVIEW_DOMAIN;
      if(!reviewDomain || process.env.OUTREACH_DAILY_LIMIT!=='1' || process.env.OUTREACH_ENABLED!=='true') throw new Error('Manual send requires a target domain, enabled sending and a one-email limit');
      const reviewedCandidate=process.env.OUTREACH_MANUAL_EVIDENCE ? JSON.parse(process.env.OUTREACH_MANUAL_EVIDENCE) : null;
      await runOutreach(today,{reviewDomain,reviewedCandidate});
    }
    if (process.env.OUTREACH_PREPARE_DATE===today) {
      if (process.env.OUTREACH_ENABLED==='true') throw new Error('Build-time preparation must not send prospect emails');
      await runOutreach(today);
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'crm-read-check-failed', reason: error.message, sent: 0 }));
    process.exitCode = 1;
  }
}

