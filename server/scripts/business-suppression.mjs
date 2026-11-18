import { getDomain } from 'tldts';
import { allContacts, emailHistory } from './outreach-api.mjs';

export const VERSION = 'business-suppression-2026-11-18';
const providers = new Set('gmail.com googlemail.com hotmail.com hotmail.co.uk outlook.com outlook.co.uk live.com live.co.uk msn.com yahoo.com yahoo.co.uk aol.com icloud.com me.com btinternet.com btopenworld.com virginmedia.com ntlworld.com talktalk.net sky.com protonmail.com proton.me mail.com gmx.com gmx.co.uk'.split(' '));
// Shared franchises/networks must be reviewed, never automatically merged.
const networks = new Set('sjpp.co.uk clydemunrodental.com taxassist.co.uk rettie.co.uk sutherlandblack.co.uk'.split(' '));
const reserved = new Set(['example.com','example.org','example.net']);
export const normalEmail = v => String(v || '').trim().toLowerCase();
export function rootDomain(v) {
  try { const host = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v).hostname;
    return getDomain(host, {allowPrivateDomains:true}) || ''; } catch { return ''; }
}
export function invalidAddress(v) {
  const email=normalEmail(v), host=email.split('@')[1];
  return !/^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i.test(email) || reserved.has(host) || /\.(?:png|avif|jpg|jpeg|webp|svg)$/i.test(host || '');
}
export function identityKeys(contact) {
  const keys=new Set();
  for(const value of [contact.email,...(contact.additionalEmails || []).map(e=>typeof e==='string'?e:e.email)]) {
    const email=normalEmail(value); if(!email)continue;
    keys.add('email:'+email);
    const root=rootDomain(email.split('@')[1]);
    if(root&&!providers.has(root)&&!networks.has(root)&&!reserved.has(root))keys.add('domain:'+root);
  }
  const root=rootDomain(contact.website);
  if(root&&!providers.has(root)&&!networks.has(root)&&!reserved.has(root))keys.add('domain:'+root);
  return [...keys];
}
export function currentReply(body) {
  return String(body || '').split(/<blockquote|<div\b[^>]*(?:gmail_quote|yahoo_quoted|divRplyFwdMsg|appendonsend)/i)[0]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
    .replace(/<br\s*\/?\s*>|<\/div>|<\/p>/gi,'\n').replace(/<[^>]*>/g,' ')
    .split(/\n\s*(?:On .*wrote:|From:|[- ]*Original Message)/i)[0]
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
}
export function isOptOut(body) {
  // Only classify clear requests near the beginning. Long/conditional replies and
  // quoted/footer language remain reply-review holds, so nothing is sent anyway.
  const text=currentReply(body).slice(0,400);
  if(/\bif\b.*\b(?:emergency|no thank|do not email|unsubscribe)\b/i.test(text))return false;
  return /\b(?:no thank(?:s| you)|unsubscribe (?:me|us)|remove (?:me|us)|stop (?:emailing|contacting)|do not (?:contact|email|reply)|don['’]t (?:contact|email)|not interested)\b/i.test(text)
    || /^(?:please\s+)?unsubscribe[.!\s]*$/i.test(text);
}
function emailDnd(contact) {
  return contact.dnd || ['active','permanent'].includes((contact.dndSettings?.email || contact.dndSettings?.Email)?.status);
}
export function buildSuppressionSnapshot(contacts,messages,previous=[]) {
  const byId=new Map(contacts.map(c=>[c.id,c])), holds=new Map(previous.map(h=>[h.identity_key,h]));
  const priority={'contact-review':1,'reply-review':2,'opted-out':3};
  const put=(keys,reason,evidence)=>{for(const key of keys){const old=holds.get(key);if(old&&priority[old.reason]>priority[reason])continue;holds.set(key,{identity_key:key,reason,evidence});}};
  for(const c of contacts) {
    const settings=c.dndSettings?.email || c.dndSettings?.Email;
    const tags=(c.tags || []).join(' ');
    if(emailDnd(c))put(settings?.code==='DATA_QUALITY_HOLD'?identityKeys(c).filter(k=>k.startsWith('email:')):identityKeys(c),settings?.code==='DATA_QUALITY_HOLD'?'contact-review':'opted-out','crm-dnd:'+c.id);
    if(/unsubscribe|opt.?out|do.?not.?contact/i.test(tags))put(identityKeys(c),'opted-out','crm-tag:'+c.id);
    if(c.validEmail===false||/suppressed|bounced|php-alert-followup-only|data-quality-person-review|research-only/i.test(tags))put(identityKeys(c).filter(k=>k.startsWith('email:')),'contact-review','crm-review:'+c.id);
  }
  for(const m of messages) {
    const direction=m.direction || m.meta?.email?.direction;
    if(!['inbound','outbound'].includes(direction))throw Error('Suppression history direction invalid');
    if(direction!=='inbound')continue;
    const sender=String(m.from || '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
    const contact=byId.get(m.contactId);
    if(!sender&&!contact)throw Error('Inbound identity cannot be resolved');
    const keys=new Set([...(contact?identityKeys(contact):[]),...(sender?identityKeys({email:sender}):[])]);
    if(!keys.size)throw Error('Inbound identity missing');
    put([...keys],isOptOut(m.body)?'opted-out':'reply-review',m.id);
  }
  // Propagate through known aliases on the same CRM record, including changed domains.
  let changed=true;
  while(changed){changed=false;for(const c of contacts){const keys=identityKeys(c);const found=keys.map(k=>holds.get(k)).filter(Boolean).sort((a,b)=>priority[b.reason]-priority[a.reason])[0];
    if(!found||found.reason==='contact-review')continue;
    for(const key of keys)if(!holds.has(key)||priority[found.reason]>priority[holds.get(key).reason]){holds.set(key,{...found,identity_key:key});changed=true;}
  }}
  return {contacts,holds};
}
export async function ensureBusinessSuppression(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS outreach_business_suppression(identity_key text PRIMARY KEY,reason text NOT NULL,evidence text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS outreach_suppression_audits(id bigserial PRIMARY KEY,version text NOT NULL,contacts integer NOT NULL,messages integer NOT NULL,held_keys integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
}
export async function syncBusinessSuppression(db,api,{locationId=process.env.GHL_LOCATION_ID}={}) {
  await ensureBusinessSuppression(db);
  const contacts=await allContacts(api),messages=await emailHistory(api,{limit:1000});
  if(contacts.some(c=>c.locationId!==locationId)||messages.some(m=>m.locationId!==locationId))throw Error('Suppression account mismatch');
  const prior=(await db.query('SELECT identity_key,reason,evidence FROM outreach_business_suppression')).rows;
  const snapshot=buildSuppressionSnapshot(contacts,messages,prior);
  // Durable holds are written before CRM updates. Failed synchronization blocks sends.
  for(const h of snapshot.holds.values())await db.query(`INSERT INTO outreach_business_suppression(identity_key,reason,evidence) VALUES($1,$2,$3)
    ON CONFLICT(identity_key) DO UPDATE SET reason=EXCLUDED.reason,evidence=EXCLUDED.evidence,updated_at=now()`,[h.identity_key,h.reason,h.evidence]);
  for(const c of contacts){const hold=identityKeys(c).map(k=>snapshot.holds.get(k)).find(h=>h?.reason==='opted-out');
    if(hold&&!emailDnd(c)){const updated=await api('PUT','/contacts/'+c.id,{body:{dndSettings:{email:{status:'active',code:'OPTED_OUT',message:'Business suppression: '+hold.evidence}}}});
      if(updated.contact?.id!==c.id||!emailDnd(updated.contact))throw Error('CRM suppression update not verified');}
  }
  const rows=(await db.query("SELECT id,domain,email,contact_id FROM prospecting_sequences WHERE status IN ('active','qualified')")).rows;
  for(const row of rows){const c=contacts.find(c=>c.id===row.contact_id)||{email:row.email,website:row.domain};const hold=identityKeys(c).map(k=>snapshot.holds.get(k)).find(Boolean);
    if(hold)await db.query("UPDATE prospecting_sequences SET status='stopped',stopped_reason=$2,updated_at=now() WHERE id=$1",[row.id,'business-'+hold.reason]);}
  // Website drafts/acknowledgements remain recorded, but cannot be submitted after a hold.
  const websites=(await db.query("SELECT id,domain,email,contact_id FROM website_prospects WHERE status<>'retired'")).rows;
  for(const row of websites){const c=contacts.find(c=>c.id===row.contact_id)||{email:row.email,website:row.domain};const hold=identityKeys(c).map(k=>snapshot.holds.get(k)).find(Boolean);
    if(hold){await db.query("UPDATE website_prospects SET status='reply_received',hold_reason=$2,updated_at=now() WHERE id=$1",[row.id,'business-'+hold.reason]);
      await db.query("UPDATE website_acknowledgements SET status='cancelled',updated_at=now() WHERE prospect_id=$1 AND status='pending'",[row.id]);}}
  await db.query('INSERT INTO outreach_suppression_audits(version,contacts,messages,held_keys) VALUES($1,$2,$3,$4)',[VERSION,contacts.length,messages.length,snapshot.holds.size]);
  return snapshot;
}
export function installBusinessGuard(api,db) {
  api.setEmailGuard(async body=>{
    if(!body?.contactId)throw Error('Send recipient missing');
    if(body.cc?.length||body.bcc?.length)throw Error('Additional recipients require separate suppression checks');
    const snapshot=await syncBusinessSuppression(db,api);
    const contact=snapshot.contacts.find(c=>c.id===body.contactId);
    if(!contact||invalidAddress(contact.email))throw Error('Send address invalid');
    if(body.emailTo&&normalEmail(body.emailTo)!==normalEmail(contact.email))throw Error('Send address differs from checked contact');
    if(networks.has(rootDomain(contact.email.split('@')[1]))||networks.has(rootDomain(contact.website)))throw Error('Shared business network requires review');
    if(identityKeys(contact).some(k=>snapshot.holds.has(k)))throw Error('Business suppressed or reply awaiting review');
    // Re-read the recipient after the full-history synchronization.
    const fresh=(await api('GET','/contacts/'+contact.id)).contact;
    if(!fresh||fresh.locationId!==contact.locationId||normalEmail(fresh.email)!==normalEmail(contact.email)||emailDnd(fresh))throw Error('Recipient changed or suppressed');
  });
}
