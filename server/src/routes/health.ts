import { Router, type IRouter } from "express";

// Self-reporting health.
//
// WHY THIS SERVICE ESPECIALLY NEEDS IT: the live Render service has been serving
// a pre-Triptique build while looking superficially correct, because the old
// classifier renders similarly. That build fabricates outreach hooks for sites
// it failed to fetch, so real prospecting copy could carry false claims, and
// nobody could tell which build was live without the Render dashboard. The
// `branch` and `commit` fields below answer that with a curl.
//
// TWO HARD RULES:
//
// 1. NEVER return a secret, or any prefix, suffix or length of one. Booleans
//    and states only.
//
// 2. THIS MUST NEVER THROW AND MUST NEVER RETURN NON-200, so it stays safe to
//    use as a platform health check. Config problems are states in the body.
//
// MOUNTING ORDER MATTERS: this must be registered BEFORE the express.static and
// the app.get("*") SPA fallback in index.ts. Otherwise the fallback serves
// index.html and the endpoint silently returns the React page instead of JSON,
// which is exactly what /api/healthz did before this existed.

const router: IRouter = Router();

/** Captured at module load, so it reports process start, not request time. */
const STARTED_AT = new Date().toISOString();

// Confirmed live on found-score and stackscanner-api, 19 Jul 2026: Render
// injects RENDER_GIT_COMMIT, RENDER_GIT_BRANCH and RENDER_GIT_REPO_SLUG. Still
// probed rather than assumed, so gitEnvKeys reports what this process sees.
const GIT_COMMIT_KEYS = ["RENDER_GIT_COMMIT", "SOURCE_VERSION", "GIT_COMMIT", "COMMIT_SHA"];
const GIT_BRANCH_KEYS = ["RENDER_GIT_BRANCH", "GIT_BRANCH", "BRANCH"];
const REPO_KEYS = ["RENDER_GIT_REPO_SLUG", "RENDER_SERVICE_NAME", "GIT_REPO"];

function firstPresent(keys: string[]): { key: string; value: string } | null {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return { key: k, value: v.trim() };
  }
  return null;
}

router.get("/healthz", (_req, res) => {
  const commit = firstPresent(GIT_COMMIT_KEYS);
  const branch = firstPresent(GIT_BRANCH_KEYS);
  const repo = firstPresent(REPO_KEYS);

  let config: Record<string, string | boolean | null>;
  try {
    config = {
      googlePlacesKey: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    };
  } catch (err) {
    config = { error: `config lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  res.json({
    ok: true,
    service: "lead-generator",
    commit: commit?.value.slice(0, 7) ?? null,
    branch: branch?.value ?? null,
    repo: repo?.value ?? null,
    gitEnvKeys: {
      commit: commit?.key ?? null,
      branch: branch?.key ?? null,
      repo: repo?.key ?? null,
    },
    startedAt: STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    config,
  });
});

export default router;
