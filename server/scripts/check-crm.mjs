import { checkCrm } from './crm-client.mjs';
import { londonWindow } from './prospecting-policy.mjs';
import { internalReadiness } from './internal-readiness.mjs';
import { testCloudLedger } from './cloud-ledger-test.mjs';
import { runOutreach } from './run-outreach.mjs';
// Build-time diagnostics run only on the dedicated prospecting cron.
// Ordinary web-service builds without these settings are unaffected.
if (!process.env.GHL_API_TOKEN && !process.env.GHL_LOCATION_ID) {
  console.log(JSON.stringify({ status: 'crm-check-not-configured', sent: 0 }));
} else {
  try {
    const result = await checkCrm({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID, probeContactId: process.env.GHL_PROBE_CONTACT_ID });
    console.log(JSON.stringify(result));
    const today=londonWindow().date;
    if (process.env.OUTREACH_READINESS_CHECK_DATE===today) console.log(JSON.stringify(await testCloudLedger()));
    if (process.env.OUTREACH_INTERNAL_TEST_DATE===today) console.log(JSON.stringify(await internalReadiness({send:true})));
    if (process.env.OUTREACH_PREPARE_DATE===today) {
      if (process.env.OUTREACH_ENABLED==='true') throw new Error('Build-time preparation must not send prospect emails');
      await runOutreach(today);
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'crm-read-check-failed', reason: error.message, sent: 0 }));
    process.exitCode = 1;
  }
}
