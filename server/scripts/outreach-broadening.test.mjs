import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyWebsite,registeredNumber} from './website-evidence.mjs';
import {compose} from './outreach-policy.mjs';

const metadata='<meta name="description" content="Synthetic business"><meta property="og:image" content="https://example.invalid/a.png">';
const html=metadata+'<body>EXAMPLE CONSULTANCY LIMITED. Consultancy services. Company number SC123456. Chris@example.invalid.</body>';
const registry='<title>EXAMPLE CONSULTANCY LIMITED overview</title><body>SC123456 Company status Active</body>';
const read=async url=>({url,html:url.includes('service.gov.uk')?registry:html,headers:{csp:"default-src self"}});
test('company-context Reg no is valid identity evidence without treating charity or membership numbers as companies',()=>{
  assert.equal(registeredNumber('<p>Synthetic Accountants is a trading name of Synthetic Limited, a company incorporated in Scotland. Reg no: SC123456.</p>'),'SC123456');
  assert.equal(registeredNumber('<p>Charity registration no SC123456</p>'),null);
  assert.equal(registeredNumber('<p>Synthetic Limited. Membership registration no SC123456.</p>'),null);
});
test('a healthy professional website qualifies for an honest service offer without a fault claim',async()=>{
  const q=await qualifyWebsite({website:'https://example.invalid',address:'Stirling FK8 2AA'},'Example Consultancy Ltd',{read});
  assert.equal(q.candidate.route,'visibility-offer');
  assert.equal(q.candidate.email,'chris@example.invalid');
  const copy=compose(q.candidate);
  assert.match(copy.message,/short visibility check/);
  assert.doesNotMatch(copy.message,/vulnerable|AI invisible|missing|broken|already audited|Steven/);
  assert.match(copy.message,/Rae/);
});
test('challenge pages cannot qualify through service words',async()=>{
  const q=await qualifyWebsite({website:'https://example.invalid',address:'Stirling FK8 2AA'},'Example Consultancy Ltd',{read:async url=>({url,html:'<title>Just a moment</title><body>Consultancy SC123456 Chris@example.invalid</body>'})});
  assert.equal(q.hold,'website-content-unverified');
});
test('published legal name links company identity despite a different registered office',async()=>{
  const home=html.replace('Company number SC123456.','');
  const lookup=async url=>({url,html:url.includes('/search/companies')?'<a href="/company/SC123456">EXAMPLE CONSULTANCY LIMITED</a>':url.includes('/company/')?registry.replace('Company status','Registered office address Glasgow G1 1AA Company status'):home,headers:{csp:'self'}});
  const q=await qualifyWebsite({website:'https://example.invalid',address:'Stirling FK8 2AA'},'Example Consultancy Ltd',{read:lookup});
  assert(q.candidate.corporate.verified);
});
