import { checkCrm } from './crm-client.mjs';
// Build-time diagnostics run only on the dedicated prospecting cron.
// Ordinary web-service builds without these settings are unaffected.
if (!process.env.GHL_API_TOKEN && !process.env.GHL_LOCATION_ID) {
  console.log(JSON.stringify({ status: 'crm-check-not-configured', sent: 0 }));
} else {
  try {
    const result = await checkCrm({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID, probeContactId: process.env.GHL_PROBE_CONTACT_ID });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: 'crm-read-check-failed', reason: error.message, sent: 0 }));
    process.exitCode = 1;
  }
}
