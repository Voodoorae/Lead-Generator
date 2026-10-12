import { runWebsiteGenerator } from './run-website-generator.mjs';
import { londonWindow } from './prospecting-policy.mjs';
import { websiteWindow } from './website-policy.mjs';
import { runWebsiteReplies } from './website-sales.mjs';
const replies=await runWebsiteReplies();
if(replies.newReplies||replies.alertsAccepted||replies.alertsHeld||replies.acknowledgementsAccepted||replies.notificationTest)console.log(JSON.stringify({campaign:'website-replies',...replies}));
const onHour=new Date().getUTCMinutes()===0;
if((onHour&&websiteWindow().due)||process.env.WEBSITE_TEST_DATE===websiteWindow().date) {
  await runWebsiteGenerator({force:process.env.WEBSITE_TEST_DATE===websiteWindow().date,readinessOnly:process.env.WEBSITE_READINESS_ONLY==='true'});
}
if(onHour&&londonWindow().due) await import('./collect-prospects.mjs');
