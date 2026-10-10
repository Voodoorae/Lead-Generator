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
} = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(240_000),
    });
    if (response.ok) return response.json();
    if (![429, 503].includes(response.status) || attempt === 4) {
      await response.body?.cancel();
      throw new Error(`Lead Generator HTTP ${response.status}; collection stopped after ${attempt + 1} attempt(s)`);
    }
    const waitMs = retryDelay(response.headers.get('retry-after'), attempt);
    await response.body?.cancel();
    // Only status and timing are logged, never credentials or contact data.
    log({ status: 'lead-api-retry', httpStatus: response.status, attempt: attempt + 1, waitMs });
    await sleep(waitMs);
  }
}

