const ORIGIN = 'https://services.leadconnectorhq.com';
export function crmClient({ token, locationId, probeContactId, fetchImpl = fetch }) {
  if (!token || /[\r\n]/.test(token)) throw new Error('CRM token missing or invalid');
  if (!locationId || !/^[A-Za-z0-9]+$/.test(locationId)) throw new Error('CRM location ID missing or invalid');
  if (!probeContactId || !/^[A-Za-z0-9]+$/.test(probeContactId)) throw new Error('CRM probe contact ID missing or invalid');
  return async function read(path, query = {}) {
    // This client deliberately exposes no writes and accepts only these reads.
    if (!['/contacts/' + probeContactId, '/conversations/search', '/conversations/messages/export'].includes(path)) {
      throw new Error('CRM read endpoint not allowed');
    }
    const url = new URL(path, ORIGIN);
    for (const [key, value] of Object.entries({ ...query, locationId })) url.searchParams.set(key, value);
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + token, Version: '2021-04-15', Accept: 'application/json' } });
    } catch {
      // Never include raw exception text or API bodies, which may contain secrets or PII.
      throw new Error('CRM read network or timeout failure');
    }
    if (!response.ok) throw new Error('CRM read HTTP ' + response.status);
    let data;
    try { data = await response.json(); } catch { throw new Error('CRM read returned invalid JSON'); }
    return data;
  };
}
export async function checkCrm(options) {
  const read = crmClient(options);
  const contact = await read('/contacts/' + options.probeContactId);
  if (contact.contact?.locationId !== options.locationId) throw new Error('CRM contact location mismatch');
  const conversations = await read('/conversations/search', { limit: 1 });
  if (!Array.isArray(conversations.conversations)) throw new Error('CRM conversations response invalid');
  const history = await read('/conversations/messages/export', { channel: 'Email', limit: 10 });
  if (!Array.isArray(history.messages)) throw new Error('CRM email history response invalid');
  if (history.messages.some(m => m.locationId !== options.locationId)) throw new Error('CRM message location mismatch');
  return { status: 'crm-read-access-verified', contacts: true, conversations: true,
    emailHistory: true, writeAccessTested: false, emailValidationTested: false, sent: 0 };
}
