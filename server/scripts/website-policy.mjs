import { domainKey, companyKey } from './outreach-policy.mjs';

export const WEBSITE_LIMIT = 20;
export const SHARED_LIMIT = 100;
export const WEBSITE_FROM = 'hello@proxaim.com';
export function websiteWindow(now = new Date()) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,due:['Mon','Tue','Wed','Thu','Fri'].includes(p.weekday)&&p.hour==='09'};
}
export function websiteSearches(date) {
  const n=Math.floor(Date.parse(date+'T12:00:00Z')/86400000);
  if(!Number.isFinite(n)) throw Error('Invalid date');
  const niches=['chartered surveyors','roofing contractors','heating installers','private dentists','private medical clinics','commercial electricians'];
  const cities=['Edinburgh','Glasgow','Aberdeen','Dundee','Stirling','Inverness','Perth'];
  return [0,1].map(offset=>({niche:niches[(n+offset)%niches.length],location:cities[Math.floor(n/niches.length)%cities.length]+', Scotland'}));
}
export const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function websiteFindings(desktop,mobile) {
  const findings=[];
  if(mobile.scrollWidth-mobile.width>40) findings.push(`At a ${mobile.width}px mobile viewport, the page measured ${mobile.scrollWidth}px wide, requiring horizontal scrolling.`);
  for(const link of desktop.links) {
    if(link.href==='tel:undefined' || link.href==='tel:null') findings.push('A displayed telephone link has an invalid destination: '+link.href+'.');
    if(link.href.startsWith('mailto:')&&/live-website\.com/i.test(link.href)&&desktop.emails.some(e=>!e.endsWith('live-website.com'))) findings.push('An email link points to a temporary website address rather than the published business email.');
    if(/^\s*(book (?:your |a )?(?:health check|appointment)|request (?:a )?quote|contact us)\s*$/i.test(link.text)&&link.href.endsWith('#')) findings.push('The '+link.text+' link points to the current page fragment rather than a booking or contact destination.');
  }
  if(/beginner classes.*yoga|yoga journey/i.test(desktop.text)&&/accounting|bookkeeping/i.test(desktop.text)) findings.push('The accounting services introduction includes unrelated beginner-yoga copy.');
  return [...new Set(findings)].slice(0,4);
}
export function recipientHold(candidate) {
  if(!candidate.corporate?.verified) return 'active-company-and-trading-identity-unverified';
  if(!candidate.email || domainKey(candidate.email.split('@')[1])!==domainKey(candidate.website)) return 'business-domain-email-unverified';
  if(!candidate.emailSourceUrl) return 'published-email-unverified';
  if(/survey|dent|medical|clinic/i.test(candidate.sector)&&!candidate.professional?.verified) return 'professional-identity-unverified';
  if(!candidate.evidence?.findings || candidate.evidence.findings.length<2) return 'two-current-website-findings-required';
  if(!candidate.evidence.desktop || !candidate.evidence.mobile) return 'desktop-and-mobile-evidence-required';
  return null;
}
export function composeWebsite(candidate) {
  if(recipientHold(candidate)) throw Error('Candidate not qualified');
  const name=String(candidate.company).replace(/[\r\n\u2014]/g,' ').slice(0,150);
  const clinical=/dent|medical|clinic/i.test(candidate.sector);
  const action=clinical?'appointment requests':'quote visits or callbacks';
  const opening=candidate.previewVerified?`I've put together a website preview for ${name}, using your existing branding and public business details.`:`I noticed ${candidate.evidence.findings[0]} I could prepare a website concept for ${name}.`;
  const invitation=candidate.previewVerified?'It shows a clearer route to your services and contact information. Would you like me to show you?':'Would a clearer route to your service enquiries be useful?';
  const message=`Hello ${name} team,\n\n${opening} ${invitation}\n\nWe could also explore a voice or booking agent to help capture phone enquiries and arrange ${action} when your team is busy, subject to checking how it would fit your current systems.${clinical?' This would cover administrative enquiries and staff handoff only.':''}\n\nBest,\nProxaim\n${WEBSITE_FROM}\n\nIf this is not relevant, reply to let me know and I won't contact you again.`;
  return {subject:(candidate.previewVerified?'A website preview for ':'Website and enquiry handling for ')+name,message,html:'<div>'+escapeHtml(message).replace(/\n/g,'<br>')+'</div>'};
}
export function sameBusiness(a,b) {
  return domainKey(a.website)===domainKey(b.website) || Boolean(a.corporate?.companyNumber&&a.corporate.companyNumber===b.corporate?.companyNumber) || companyKey(a.company)===companyKey(b.company);
}
export function retireDecision({outcome,lastSent,hasReply,now=new Date()}) {
  if(['won','lost','opted_out','disqualified','closed'].includes(outcome)) return outcome;
  // One introduction, no follow-ups. Close only after a final reply check.
  if(lastSent&&!hasReply&&Number.isFinite(Date.parse(lastSent))&&now-Date.parse(lastSent)>=30*86400000) return 'closed_no_reply';
  return null;
}
