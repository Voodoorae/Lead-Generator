import pg from 'pg';
import { londonWindow, dailySearch, holdReason } from './prospecting-policy.mjs';
import { postLeadJson } from './lead-api.mjs';
import { internalReadiness } from './internal-readiness.mjs';
import { runOutreach } from './run-outreach.mjs';

const window = londonWindow();
// A test override must name today's UK date, so a forgotten flag cannot
// override weekday/time guards indefinitely.
const manualTest = process.env.PROSPECTING_MANUAL_RUN === 'true'
  && process.env.PROSPECTING_TEST_DATE === window.date;
if (!window.due && !manualTest) {
  console.log(JSON.stringify({ status: 'outside-london-window', sent: 0 }));
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for durable cloud collection');
const api = new URL(process.env.LEAD_GENERATOR_URL || 'https://lead-generator-1-vx3v.onrender.com');
if (api.protocol !== 'https:') throw new Error('Lead Generator URL must use HTTPS');
const limit = Number(process.env.PROSPECTING_SCAN_LIMIT || 30);
if (!Number.isInteger(limit) || limit < 1 || limit > 60) throw new Error('Scan limit must be 1 to 60');

// Driver defaults retain TLS validation. If the database requires a CA, supply
// its certificate through the deployment configuration, never disable checking.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
const search = dailySearch(window.date);
let ownsLock = false;
async function post(path, body) {
  return postLeadJson(new URL(path, api), body);
}
try {
  const lock = await db.query('SELECT pg_try_advisory_lock($1) AS acquired', [7101026]);
  if (!lock.rows[0].acquired) throw new Error('Another prospecting collector is running');
  ownsLock = true;
  await db.query(`CREATE TABLE IF NOT EXISTS prospecting_collection_runs (
    run_date DATE PRIMARY KEY, status TEXT NOT NULL, niche TEXT NOT NULL,
    location TEXT NOT NULL, found INTEGER DEFAULT 0, held INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  ); CREATE TABLE IF NOT EXISTS prospecting_candidates (
    run_date DATE NOT NULL, place_id TEXT NOT NULL, company TEXT NOT NULL,
    score JSONB NOT NULL, hold_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(run_date, place_id)
  )`);
  const prior = await db.query('SELECT status FROM prospecting_collection_runs WHERE run_date=$1', [window.date]);
  if (prior.rows[0]?.status === 'complete') {
    console.log(JSON.stringify({ date: window.date, status: 'already-collected', sent: 0 }));
  } else {
    await db.query(`INSERT INTO prospecting_collection_runs(run_date,status,niche,location)
      VALUES($1,'running',$2,$3) ON CONFLICT(run_date) DO UPDATE SET status='running',updated_at=now()`,
    [window.date, search.niche, search.location]);
    const result = await post('/api/leads', search);
    if (!Array.isArray(result.leads)) throw new Error('Malformed lead search response');
    const places = result.leads.filter(p => p.placeId && p.name).slice(0, limit);
    for (const place of places) {
      const existing = await db.query('SELECT 1 FROM prospecting_candidates WHERE run_date=$1 AND place_id=$2', [window.date, place.placeId]);
      if (existing.rowCount) continue;
      const raw = await post('/api/score-lead', { placeId: place.placeId, name: place.name, location: search.location });
      if (raw.placeId !== place.placeId) throw new Error('Score returned wrong place ID');
      // Do not persist generated hooks that may contain unsupported assertions.
      const { emailHook, ...score } = raw;
      await db.query(`INSERT INTO prospecting_candidates(run_date,place_id,company,score,hold_reason)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [window.date, place.placeId, place.name, JSON.stringify({ ...score, address: place.address }), holdReason(score)]);
    }
    const counts = await db.query('SELECT count(*)::integer AS n FROM prospecting_candidates WHERE run_date=$1', [window.date]);
    await db.query(`UPDATE prospecting_collection_runs SET status='complete',found=$2,held=$3,updated_at=now() WHERE run_date=$1`,
      [window.date, result.leads.length, counts.rows[0].n]);
    console.log(JSON.stringify({ date: window.date, status: 'collected-and-held', ...search,
      found: result.leads.length, held: counts.rows[0].n, sent: 0 }));
  }
} catch (error) {
  if (ownsLock) await db.query("UPDATE prospecting_collection_runs SET status='failed',updated_at=now() WHERE run_date=$1", [window.date]).catch(() => {});
  throw error;
} finally {
  if (ownsLock) await db.query('SELECT pg_advisory_unlock($1)', [7101026]).catch(() => {});
  db.release();
  await pool.end();
}
if (process.env.GHL_API_TOKEN && process.env.GHL_LOCATION_ID) console.log(JSON.stringify(await internalReadiness()));
await runOutreach(window.date);
