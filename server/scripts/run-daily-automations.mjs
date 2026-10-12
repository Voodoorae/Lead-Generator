import { runWebsiteGenerator } from './run-website-generator.mjs';
import { londonWindow } from './prospecting-policy.mjs';
import { websiteWindow } from './website-policy.mjs';
if(websiteWindow().due||process.env.WEBSITE_TEST_DATE===websiteWindow().date) {
  await runWebsiteGenerator({force:process.env.WEBSITE_TEST_DATE===websiteWindow().date,readinessOnly:process.env.WEBSITE_READINESS_ONLY==='true'});
}
if(londonWindow().due) await import('./collect-prospects.mjs');
