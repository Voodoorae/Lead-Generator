import pg from "pg";

const { Pool } = pg;

// DATABASE_URL unset in dev — leads simply aren't persisted (client-side CSV
// export still works standalone). Same pattern proxaim-web uses for entitlements.
export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

let schemaReady: Promise<void> | null = null;

/** Self-creating schema, called lazily on first query rather than at boot. */
export function ensureSchema(): Promise<void> {
  if (!pool) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        verdict TEXT,
        exposure INTEGER,
        pillars JSONB,
        cms TEXT,
        cve_risk BOOLEAN,
        signals JSONB,
        email_hook TEXT,
        address TEXT,
        rating REAL,
        reviews INTEGER,
        niche TEXT NOT NULL,
        location TEXT NOT NULL,
        scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (domain, niche, location)
      )
    `).then(() => undefined);
  }
  return schemaReady;
}
