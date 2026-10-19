import pg from 'pg';
import {dailyRampLimit} from './outreach-ramp.mjs';
import {apiClient,emailDetail} from './outreach-api.mjs';

// Cloud build verification allocates the same durable limit as the scheduled
// runner. It performs no contact creation or email submission.
if(process.env.OUTREACH_ENABLED!==undefined&&process.env.DATABASE_URL&&process.env.GHL_API_TOKEN&&process.env.GHL_LOCATION_ID) {
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const db=await pool.connect();let owns=false;
  try {
    owns=(await db.query('SELECT pg_try_advisory_lock($1) acquired',[7101027])).rows[0].acquired;
    if(owns) {
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      if([0,6].includes(new Date(date+'T12:00:00Z').getUTCDay())) {
        console.log(JSON.stringify({status:'professional-ramp-check-weekend',sent:0}));
      } else {
      const configured=Number(process.env.OUTREACH_DAILY_LIMIT||5);
      const api=apiClient({token:process.env.GHL_API_TOKEN,locationId:process.env.GHL_LOCATION_ID});
      const dailyLimit=await dailyRampLimit(db,date,{configured,readDelivery:a=>emailDetail(api,
        {id:a.email_message_id,contactId:a.contact_id,direction:'outbound'},process.env.GHL_LOCATION_ID)});
      console.log(JSON.stringify({status:'professional-ramp-verified',date,dailyLimit,configured,
        enabled:process.env.OUTREACH_ENABLED==='true',growthPercent:10,sent:0}));
      }
    } else console.log(JSON.stringify({status:'professional-ramp-check-deferred',reason:'active-runner',sent:0}));
  } finally {
    if(owns)await db.query('SELECT pg_advisory_unlock($1)',[7101027]);
    db.release();await pool.end();
  }
}
