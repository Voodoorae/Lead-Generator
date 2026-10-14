import test from 'node:test';
import assert from 'node:assert/strict';
import {corporateWebsite} from './website-browser.mjs';

const source={url:'https://example.invalid/',headers:{csp:null},html:'<html><body><h1>Example Surveying Limited</h1><a href="mailto:chris@example.invalid">Chris</a><a href="mailto:privacy@example.invalid">Privacy</a></body></html>'};
const read=async url=>({url,html:url.includes('/search/companies')?'<a href="/company/SC111111">Example Surveying Limited</a>':'<title>EXAMPLE SURVEYING LIMITED overview</title><body>Company number SC111111 Registered office address Edinburgh EH1 2AB Company status Active</body>'});

test('generator reuses published named work email and independent matching company evidence',async()=>{
  const result=await corporateWebsite(source,'Example Surveying Limited','Edinburgh EH1 2AB',{read});
  assert.equal(result.email,'chris@example.invalid');
  assert.equal(result.emailSourceUrl,source.url);
  assert.equal(result.corporate.verified,true);
  assert.equal(result.corporate.verificationMethod,'registry-name-and-address');
});

test('same company name at another address cannot clear generator identity',async()=>{
  const result=await corporateWebsite(source,'Example Surveying Limited','Edinburgh EH9 9ZZ',{read});
  assert.equal(result.corporate.verified,false);
});

test('privacy-only mailbox is never selected for generator outreach',async()=>{
  const result=await corporateWebsite({...source,html:source.html.replace('<a href="mailto:chris@example.invalid">Chris</a>','')},'Example Surveying Limited','Edinburgh EH1 2AB',{read});
  assert.equal(result.email,null);
});
