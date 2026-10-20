import { londonWindow } from './prospecting-policy.mjs';
export const emailKey = value => String(value || '').trim().toLowerCase();
export const companyKey = value => String(value || '').toLowerCase().replace(/\blimited liability partnership\b/g,'llp').replace(/\blimited\b/g,'ltd').replace(/[^a-z0-9]/g,'');
export function domainKey(value) {
  try { return new URL(/^[a-z]+:\/\//i.test(value) ? value : 'https://' + value).hostname.toLowerCase().replace(/^www\./,''); }
  catch { return ''; }
}
export function duplicate(candidate, contacts) {
  const email = emailKey(candidate.email), domain = domainKey(candidate.website), company = companyKey(candidate.company);
  return contacts.some(c => {
    const emails = [c.email, ...(c.additionalEmails || []).map(e => typeof e === 'string' ? e : e.email)];
    const domains = [c.website, ...emails.map(e => emailKey(e).split('@')[1])].map(domainKey).filter(Boolean);
    return email && emails.some(e => emailKey(e) === email) || domain && domains.includes(domain)
      || company && [c.companyName,c.businessName].some(n => companyKey(n) === company);
  });
}
export function suppressionReason(contact, history = []) {
  const tags = (contact.tags || []).map(t => String(t).toLowerCase());
  if (contact.dnd || contact.dndSettings?.Email?.status === 'active' || contact.dndSettings?.email?.status === 'active') return 'do-not-contact';
  if (tags.some(t => /unsubscribe|opt.?out|do.?not.?contact|suppressed|bounced/.test(t))) return 'suppression-tag';
  if (contact.validEmail === false) return 'invalid-email';
  if (history.some(m => m.direction === 'inbound')) return 'reply-received';
  if (history.some(m => ['failed','undelivered','bounced'].includes(m.status))) return 'delivery-failure';
  return null;
}
export function verifiedEmail(result, expected) {
  return result?.result === 'deliverable' && result.risk === 'low'
    && emailKey(result.address) === emailKey(expected) && result.leadConnectorRecommendation?.isEmailValid !== false;
}
export function campaignLimit({configured=50,delivered=0,failed=0,rampTarget=null}) {
  for(const n of [configured,delivered,failed]) if (!Number.isInteger(n) || n<0) throw new Error('Campaign delivery counts invalid');
  if (configured<1 || configured>1000) throw new Error('Campaign ceiling invalid');
  const measured=delivered+failed;
  if (failed && (measured<20 || failed/measured>=0.03)) throw new Error('New campaign paused for delivery review');
  if(rampTarget!==null) {
    if(!Number.isInteger(rampTarget)||rampTarget<1||rampTarget>1000)throw Error('Ramp target invalid');
    return Math.min(configured,rampTarget);
  }
  const ramp=delivered>=100?50:delivered>=50?25:delivered>=20?10:5;
  return Math.min(configured,ramp);
}
export function outboundCount(messages, date) {
  let count = 0;
  for (const m of messages) {
    if (!['inbound','outbound'].includes(m.direction)) throw new Error('Unknown message direction');
    if (!m.dateAdded || !['string','number'].includes(typeof m.dateAdded)) throw new Error('Unknown message date');
    const d = new Date(m.dateAdded);
    if (!Number.isFinite(d.getTime())) throw new Error('Unknown message date');
    if (m.direction === 'outbound' && londonWindow(d).date === date) {
      // Conservatively include failed/pending/scheduled attempts. Never reuse their allowance.
      count += Math.max(1, m.meta?.email?.email?.messageIds?.length || 0);
    }
  }
  return count;
}
export function addWeekdays(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  while (days > 0) { d.setUTCDate(d.getUTCDate()+1); if (![0,6].includes(d.getUTCDay())) days--; }
  return d.toISOString().slice(0,10);
}
export function sendHold(candidate, now = new Date()) {
  if (!candidate.corporate?.verified || !candidate.corporate.sourceUrl) return 'corporate-status-unverified';
  if (!candidate.emailPublished || !candidate.emailSourceUrl) return 'email-provenance-unverified';
  if (!candidate.evidence?.observation || !candidate.evidence.sourceUrl) return 'missing-evidence';
  const checked = new Date(candidate.evidence.checkedAt).getTime();
  if (!Number.isFinite(checked) || checked > now.getTime() || now.getTime()-checked > 7*86400000) return 'stale-evidence';
  if (!verifiedEmail(candidate.validation,candidate.email)) return 'email-not-verified';
  return null;
}
export function isReadinessReply(body) {
  const current=String(body || '').split(/<blockquote|<div\b[^>]*(?:gmail_quote|yahoo_quoted)|\n(?:On .*wrote:|From:|[- ]*Original Message)/i)[0];
  const text=current.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').trim();
  return /^Ready\s+cloud-internal-test-v1\b/i.test(text);
}
const clean = value => String(value).replace(/[\r\n\u0000-\u001f]/g,' ').replace(/\u2014/g,',').slice(0,250);
export function compose(candidate, stage = 0) {
  if (!['visibility','security','visibility-offer'].includes(candidate.route)) throw new Error('Route requires reviewed copy');
  if (!Number.isInteger(stage) || stage < 0 || stage > 2) throw new Error('Invalid sequence stage');
  const company = clean(candidate.company), observation = clean(candidate.evidence.observation);
  const source=new URL(candidate.evidence.sourceUrl);
  if(source.protocol!=='https:' || domainKey(source.href)!==candidate.domain) throw new Error('Copy evidence URL mismatch');
  if(candidate.route==='visibility-offer') {
    if(!candidate.evidence.service)throw Error('Advertised service evidence required');
    const subject='A visibility check for '+company;
    const message='Hello,\n\n'+(stage===0?'I saw that your website describes '+clean(candidate.evidence.service)+'.':'A quick follow-up on my offer of a visibility check for '+company+'.')
      +'\n\nWe help Scottish firms review how clearly their services and business details can be found and understood online. Would a short visibility check be useful?'
      +'\n\nPage reviewed: '+source.href+'\n\nRae\nProxaim\nhello@proxaim.com\n\nIf this is not useful, reply “no thanks” and I’ll stop contacting you.';
    const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return {subject,message,html:'<div>'+escape(message).replace(/\n/g,'<br>')+'</div>'};
  }
  const subject = stage === 0 ? 'A website observation for ' + company : 'Re: A website observation for ' + company;
  const opening = stage === 0 ? 'Hello,\n\nI was looking at ' + company + '’s website and noticed this: ' + observation + '.'
    : stage === 1 ? 'Hello,\n\nA quick follow-up on the website observation I sent for ' + company + ': ' + observation + '.'
    : 'Hello,\n\nI’m closing the loop on my note about ' + company + '’s website: ' + observation + '.';
  const why = candidate.route === 'visibility' ? 'If useful, I can show you what I checked and explain how we could improve this detail.'
    : 'I can show you the public website detail I checked and explain what a practical fix would involve.';
  const text = opening + '\n\nPage checked: ' + source.href + '\n\n' + why + '\n\nWould you like me to send a short explanation and the next step?'
    + '\n\nSteven Nisbet\nProxaim\nhttps://proxaim.com\n\nIf this is not useful, reply “no thanks” and I’ll stop contacting you.';
  const escape = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return {subject,message:text,html:'<div>' + escape(text).replace(/\n/g,'<br>') + '</div>'};
}


