const BASE = 'https://services.leadconnectorhq.com';
const idPattern = /^[A-Za-z0-9_-]+$/;
export function apiClient({ token, locationId, fetchImpl = fetch, sleep = ms=>new Promise(r=>setTimeout(r,ms)) }) {
  if (!token || /[\r\n]/.test(token) || !idPattern.test(locationId || '')) throw new Error('CRM configuration invalid');
  return async (method, path, { query = {}, body, version = '2021-07-28' } = {}) => {
    const contactRead = /^\/contacts\/[A-Za-z0-9_-]+$/.test(path);
    const tagsWrite = /^\/contacts\/[A-Za-z0-9_-]+\/tags$/.test(path);
    const messageRead = /^\/conversations\/messages\/(?:email\/)?[A-Za-z0-9_-]+$/.test(path);
    const allowed = method === 'GET' ? contactRead || messageRead || ['/conversations/messages/export','/conversations/search','/workflows/'].includes(path)
      : method === 'POST' && (tagsWrite || ['/contacts/search','/contacts/','/email/verify','/conversations/messages'].includes(path));
    if (!allowed) throw new Error('CRM operation not allowed');
    const url = new URL(path, BASE);
    for (const [k,v] of Object.entries({ ...query, locationId })) if (v !== undefined) url.searchParams.set(k, String(v));
    // Contacts create/search require locationId in the body. Other operations
    // use the query/token scope and reject undeclared body fields with HTTP 422.
    const scopedBody = body === undefined ? undefined : ['/contacts/','/contacts/search'].includes(path) ? { ...body, locationId } : body;
    let response;
    const retryable=method==='GET' || path==='/contacts/search';
    for(let attempt=0;attempt<5;attempt++) {
      try {
        response = await fetchImpl(url, { method, redirect:'error', signal:AbortSignal.timeout(25000),
          headers:{ Authorization:'Bearer ' + token, Version:version, Accept:'application/json', 'Content-Type':'application/json' },
          ...(scopedBody && {body:JSON.stringify(scopedBody)}) });
      } catch { throw new Error('CRM request network or timeout failure'); }
      if(response.ok || !retryable || ![429,503].includes(response.status) || attempt===4) break;
      const wait=retryDelay(response.headers?.get('retry-after'),attempt);
      await response.body?.cancel();await sleep(wait);
    }
    if (!response.ok) {
      const operation=path==='/email/verify'?'email-verification':path==='/conversations/messages'?'email-send':tagsWrite?'contact-tag-write':contactRead?'contact-read':path==='/contacts/'?'contact-create':path==='/contacts/search'?'contact-search':'email-history-read';
      throw new Error('CRM ' + operation + ' HTTP ' + response.status);
    }
    let data;try { data=await response.json(); } catch { throw new Error('CRM response invalid JSON'); }
    for(const records of [data.contacts,data.messages]) if(Array.isArray(records) && records.some(r=>r.locationId!==locationId)) throw new Error('CRM collection account mismatch');
    return data;
  };
}
export async function emailDetail(api,message,locationId) {
  const data=await api('GET','/conversations/messages/email/'+message.id);
  // The actual API returns emailMessage, despite the public projection describing
  // a flat object. Accept both shapes and validate account/contact before use.
  const email=data.emailMessage || data;
  if(email.locationId!==locationId || email.contactId!==message.contactId || !email.status || email.direction!==message.direction) throw new Error('Email detail account or message mismatch');
  return {...message,status:email.status,emailFrom:email.from};
}
export async function proxaimEmailDetail(api,message,locationId,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  for(let attempt=0;attempt<4;attempt++) {
    const actual=await emailDetail(api,message,locationId);
    if(/^Proxaim\s*<hello@proxaim\.com>$/i.test(actual.emailFrom))return actual;
    if(attempt===3)throw Error('Actual Proxaim sender could not be confirmed; reconcile before continuing');
    await sleep(1000*(attempt+1));
  }
}
export async function allContacts(api) {
  const contacts = [], seen = new Set();
  let searchAfter;
  for (let page = 0; page < 100; page++) {
    const result = await api('POST','/contacts/search',{body:{pageLimit:100, sort:[{field:'dateAdded',direction:'asc'}], ...(searchAfter && {searchAfter})}});
    if (!Array.isArray(result.contacts) || !Number.isInteger(result.total)) throw new Error('CRM contact pagination invalid');
    for (const c of result.contacts) {
      if (!c.id || seen.has(c.id)) throw new Error('CRM contact pagination repeated or missing ID');
      seen.add(c.id); contacts.push(c);
    }
    if (contacts.length >= result.total) return contacts;
    const next = result.contacts.at(-1)?.searchAfter;
    if (!Array.isArray(next) || !next.length || JSON.stringify(next) === JSON.stringify(searchAfter)) throw new Error('CRM contact pagination incomplete');
    searchAfter = next;
  }
  throw new Error('CRM contact pagination limit exceeded');
}
export async function emailHistory(api, query) {
  const messages = [], seen = new Set(), cursors = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const data = await api('GET','/conversations/messages/export',{query:{...query,channel:'Email',limit:100,...(cursor && {cursor})}});
    if (!Array.isArray(data.messages)) throw new Error('CRM email history invalid');
    for (const m of data.messages) {
      if (!m.id || seen.has(m.id)) throw new Error('CRM history repeated or missing ID');
      seen.add(m.id); messages.push(m);
    }
    if (!data.nextCursor) {
      if (Number.isInteger(data.total) && messages.length < data.total) throw new Error('CRM history incomplete');
      return messages;
    }
    if (cursors.has(data.nextCursor)) throw new Error('CRM history cursor repeated');
    cursors.add(data.nextCursor); cursor = data.nextCursor;
  }
  throw new Error('CRM history pagination limit exceeded');
}
import { retryDelay } from './lead-api.mjs';
