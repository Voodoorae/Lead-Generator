import { createHash } from 'node:crypto';
const MAX_WAIT_MS = 300_000;

export function retryDelay(retryAfter, attempt, now = Date.now()) {
  if (retryAfter !== null && retryAfter !== undefined) {
    const value = retryAfter.trim();
    const milliseconds = /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value) * 1000 : Date.parse(value) - now;
    if (Number.isFinite(milliseconds)) {
      if (milliseconds > MAX_WAIT_MS) throw new Error('Lead Generator requests a wait over five minutes; retry the run later');
      return Math.max(1000, milliseconds);
    }
  }
  return Math.min(MAX_WAIT_MS, 30_000 * 2 ** attempt);
}

// These POST endpoints only search/score. Never reuse these retries for email
// sends, CRM writes or any operation whose outcome could be ambiguous.
export async function postLeadJson(url, body, {
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = message => console.log(JSON.stringify(message)),
  maxAttempts = 5,
} = {}) {
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw Error('Invalid discovery attempt limit');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(240_000),
    });
    if (response.ok) return response.json();
    if ([429,502,503,504].includes(response.status)) {
      const body = await response.text();
      log({status:'lead-api-error-response',httpStatus:response.status,attempt:attempt+1,
        headers:Object.fromEntries(['server','content-type','retry-after','rndr-id','x-render-origin-server','cf-ray','cf-mitigated','x-powered-by'].map(name=>[name,response.headers.get(name)])),
        bodySha256:createHash('sha256').update(body).digest('hex'),
        bodyLooksHtml:/<html|<!doctype/i.test(body),bodyMentionsRender:/\brender\b/i.test(body),
        bodyMentionsRateLimit:/too many requests|rate.?limit/i.test(body),
        bodyMentionsStartup:/spin.?up|starting|waking|loading/i.test(body)});
    }
    if (![429,502,503,504].includes(response.status) || attempt === maxAttempts-1) {
      if (!response.bodyUsed) await response.body?.cancel();
      throw new Error(`Lead Generator HTTP ${response.status}; collection stopped after ${attempt + 1} attempt(s)`);
    }
    const waitMs = retryDelay(response.headers.get('retry-after'), attempt);
    if (!response.bodyUsed) await response.body?.cancel();
    // Raw response bodies, credentials and contact data are never logged.
    log({ status: 'lead-api-retry', httpStatus: response.status, attempt: attempt + 1, waitMs });
    await sleep(waitMs);
  }
}
