import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { apiClient } from './outreach-api.mjs';
import { ensureOutreach } from './outreach-store.mjs';
import { ensureWebsite } from './website-store.mjs';
import { ensureSales } from './website-sales.mjs';
import { syncBusinessSuppression, VERSION } from './business-suppression.mjs';
export async function runSuppressionMaintenance() {
  if(!process.env.DATABASE_URL||!process.env.GHL_API_TOKEN||!process.env.GHL_LOCATION_ID)throw Error('Suppression maintenance configuration missing');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),db=await pool.connect();let locked=false;
  try {
    locked=(await db.query('SELECT pg_try_advisory_lock($1) acquired',[7101027])).rows[0].acquired;
    if(!locked)throw Error('Outreach runner active; suppression maintenance held');
    await ensureOutreach(db);await ensureWebsite(db);await ensureSales(db);
    // This client cannot send even if an environment flag is accidentally enabled.
    const api=apiClient({token:process.env.GHL_API_TOKEN,locationId:process.env.GHL_LOCATION_ID,sendEnabled:()=>false});
    const result=await syncBusinessSuppression(db,api);
    const summary={status:'business-suppression-synchronised',version:VERSION,contacts:result.contacts.length,heldKeys:result.holds.size,sent:0};
    console.log(JSON.stringify(summary));return summary;
  }finally{if(locked)await db.query('SELECT pg_advisory_unlock($1)',[7101027]);db.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runSuppressionMaintenance();
